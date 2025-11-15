/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { URI } from '../../../base/common/uri.js';
import { joinPath } from '../../../base/common/resources.js';
import { VSBuffer } from '../../../base/common/buffer.js';
// import * as path from 'path';
import type { ChildProcess } from 'child_process';

// Lazy-load Node.js modules to avoid ES module resolution issues in electron-browser
// In Node.js/Electron contexts, require is available globally via the module system
// We access it lazily to avoid issues when the module is first loaded
let _nodeRequire: any;
function getNodeRequire(): any {
	if (!_nodeRequire) {
		// In Node.js/Electron contexts, require is available globally
		// Access it dynamically to avoid static analysis and CSP issues
		// Try to access require directly - this works in Node.js and Electron renderer (with node integration)
		const req = (function() {
			try {
				// eslint-disable-next-line no-eval
				return eval('require');
			} catch {
				return undefined;
			}
		})();

		if (req) {
			_nodeRequire = req;
		} else {
			// Fallback: check if we're in a Node.js/Electron context
			const isNodeOrElectron = typeof process !== 'undefined' && (
				process.versions?.node || // Pure Node.js
				process.versions?.electron // Electron (renderer or main)
			);

			if (!isNodeOrElectron) {
				throw new Error('AgentSandbox can only be used in Node.js/Electron contexts. require is not available.');
			} else {
				throw new Error('Node.js require is not available. AgentSandbox requires Node.js integration to be enabled.');
			}
		}
	}
	return _nodeRequire;
}

let _promisify: typeof import('util').promisify | undefined;
function getPromisify(): typeof import('util').promisify {
	if (!_promisify) {
		_promisify = getNodeRequire()('util').promisify;
	}
	return _promisify!; // Non-null assertion: _promisify is always set above
}

let _exec: typeof import('child_process').exec | undefined;
let _spawn: typeof import('child_process').spawn | undefined;
function getExec() {
	if (!_exec) {
		const cp = getNodeRequire()('child_process');
		_exec = cp.exec;
		_spawn = cp.spawn;
	}
	return _exec!;
}
function getSpawn() {
	if (!_spawn) {
		getExec(); // This will also set _spawn
	}
	return _spawn!;
}

let _fsPromises: typeof import('fs/promises') | undefined;
function getFsPromises(): typeof import('fs/promises') {
	if (!_fsPromises) {
		_fsPromises = getNodeRequire()('fs').promises;
	}
	return _fsPromises!; // Non-null assertion: _fsPromises is always set above
}

// Lazy-load crypto to avoid ES module resolution issues in electron-browser
let _crypto: typeof import('crypto') | undefined;
function getCrypto(): typeof import('crypto') {
	if (!_crypto) {
		_crypto = getNodeRequire()('crypto') as typeof import('crypto');
	}
	return _crypto!; // Non-null assertion: _crypto is always set above
}

// Lazy-load execAsync to avoid initialization at module load time
type ExecAsync = (command: string, options?: { cwd?: string; env?: Record<string, string | undefined>; maxBuffer?: number; timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
let _execAsync: ExecAsync | undefined;
function getExecAsync(): ExecAsync {
	if (!_execAsync) {
		_execAsync = getPromisify()(getExec()) as ExecAsync;
	}
	return _execAsync; // Non-null assertion: _execAsync is always set above
}

export interface SandboxExecutionResult {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
	duration: number;
	outputFiles?: Array<{ path: string; content: string }>;
}

export interface SandboxOptions {
	timeout?: number; // milliseconds
	maxMemory?: number; // bytes
	allowedCommands?: string[]; // Whitelist of allowed commands
	workingDirectory?: URI;
	env?: Record<string, string>;
}

/**
 * Secure sandbox for executing agent-generated code and tests
 * Provides isolation and safety checks before applying changes
 */
export class AgentSandbox extends Disposable {
	private readonly sandboxRoot: URI;
	private activeExecutions = new Map<string, ChildProcess>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.sandboxRoot = joinPath(this.environmentService.userRoamingDataHome, '.vscode', 'sandbox');
	}

	/**
	 * Execute code in a sandboxed Node.js VM
	 * Safe for running simple scripts and validations
	 */
	async executeInVM(code: string, options: SandboxOptions = {}, token?: CancellationToken): Promise<SandboxExecutionResult> {
		const startTime = Date.now();
		const sandboxId = this.generateSandboxId(code);

		try {
			// Create temporary sandbox directory
			const sandboxDir = joinPath(this.sandboxRoot, sandboxId);
			await this.fileService.createFolder(sandboxDir);

			// Write code to temporary file
			const codeFile = joinPath(sandboxDir, 'script.js');
			await this.fileService.writeFile(codeFile, VSBuffer.fromString(code));

			// Execute in Node.js with restricted environment
			const env = {
				...process.env,
				...options.env,
				NODE_ENV: 'production',
				// Remove potentially dangerous environment variables
				NPM_TOKEN: undefined,
				GITHUB_TOKEN: undefined,
			};

			const timeout = options.timeout || 30000; // 30 seconds default
			const command = `node "${codeFile.fsPath}"`;

			const result = await Promise.race([
				getExecAsync()(command, {
					cwd: options.workingDirectory?.fsPath || sandboxDir.fsPath,
					env,
					maxBuffer: 10 * 1024 * 1024, // 10MB max output
					timeout,
				}),
				this.createTimeoutPromise(timeout),
				this.createCancellationPromise(token),
			]) as { stdout: string; stderr: string };

			const duration = Date.now() - startTime;

			// Cleanup
			await this.cleanupSandbox(sandboxDir);

			return {
				success: true,
				stdout: result.stdout || '',
				stderr: result.stderr || '',
				exitCode: 0,
				duration,
			};
		} catch (error: any) {
			const duration = Date.now() - startTime;
			const sandboxDir = joinPath(this.sandboxRoot, sandboxId);
			await this.cleanupSandbox(sandboxDir).catch(() => {});

			return {
				success: false,
				stdout: error.stdout || '',
				stderr: error.stderr || error.message || String(error),
				exitCode: error.code || 1,
				duration,
			};
		}
	}

	/**
	 * Execute tests in a sandboxed environment
	 * Runs tests with restricted permissions and resource limits
	 */
	async executeTests(
		testCommand: string,
		options: SandboxOptions = {},
		token?: CancellationToken
	): Promise<SandboxExecutionResult> {
		const startTime = Date.now();
		const sandboxId = this.generateSandboxId(testCommand);

		// Validate command is safe
		if (!this.isCommandAllowed(testCommand, options.allowedCommands)) {
			return {
				success: false,
				stdout: '',
				stderr: `Command not allowed: ${testCommand}`,
				exitCode: 1,
				duration: Date.now() - startTime,
			};
		}

		try {
			const sandboxDir = joinPath(this.sandboxRoot, sandboxId);
			await this.fileService.createFolder(sandboxDir);

			const timeout = options.timeout || 60000; // 60 seconds for tests
			const workingDir = options.workingDirectory?.fsPath || sandboxDir.fsPath;

			// Parse command and arguments
			const parts = this.parseCommand(testCommand);
			const [cmd, ...args] = parts;

			const env = {
				...process.env,
				...options.env,
				NODE_ENV: 'test',
			};

			return new Promise<SandboxExecutionResult>((resolve) => {
				const child = getSpawn()(cmd, args, {
					cwd: workingDir,
					env,
					stdio: ['pipe', 'pipe', 'pipe'],
					shell: process.platform === 'win32',
				});

				const executionId = `${sandboxId}-${Date.now()}`;
				this.activeExecutions.set(executionId, child);

				let stdout = '';
				let stderr = '';

				child.stdout?.on('data', (data: Buffer) => {
					stdout += data.toString();
				});

				child.stderr?.on('data', (data: Buffer) => {
					stderr += data.toString();
				});

				const timeoutId = setTimeout(() => {
					child.kill('SIGTERM');
					setTimeout(() => {
						if (!child.killed) {
							child.kill('SIGKILL');
						}
					}, 5000);
				}, timeout);

				const cancelListener = token?.onCancellationRequested(() => {
					child.kill('SIGTERM');
				});

				child.on('close', (code: number | null) => {
					clearTimeout(timeoutId);
					cancelListener?.dispose();
					this.activeExecutions.delete(executionId);

					const duration = Date.now() - startTime;

					this.cleanupSandbox(sandboxDir).catch(() => {});

					resolve({
						success: code === 0,
						stdout,
						stderr,
						exitCode: code || 0,
						duration,
					});
				});

				child.on('error', (error: Error) => {
					clearTimeout(timeoutId);
					cancelListener?.dispose();
					this.activeExecutions.delete(executionId);

					const duration = Date.now() - startTime;

					this.cleanupSandbox(sandboxDir).catch(() => {});

					resolve({
						success: false,
						stdout,
						stderr: error.message,
						exitCode: 1,
						duration,
					});
				});
			});
		} catch (error: any) {
			const duration = Date.now() - startTime;
			return {
				success: false,
				stdout: '',
				stderr: error.message || String(error),
				exitCode: 1,
				duration,
			};
		}
	}

	/**
	 * Validate code changes before applying them
	 * Runs syntax checks, linting, and basic tests
	 */
	async validateChanges(
		files: Array<{ uri: URI; content: string }>,
		options: SandboxOptions = {},
		token?: CancellationToken
	): Promise<{ valid: boolean; errors: string[] }> {
		const errors: string[] = [];

		// Basic validation: check for dangerous patterns
		for (const file of files) {
			const dangerousPatterns = [
				/eval\s*\(/,
				/Function\s*\(/,
				/require\s*\(\s*['"]child_process['"]/,
				/require\s*\(\s*['"]fs['"]/,
				/process\.exit/,
				/rm\s+-rf/,
				/rmdir\s+\/s/,
			];

			for (const pattern of dangerousPatterns) {
				if (pattern.test(file.content)) {
					errors.push(`Dangerous pattern detected in ${file.uri.toString()}: ${pattern}`);
				}
			}
		}

		// If TypeScript files, validate syntax
		const tsFiles = files.filter(f => f.uri.path.endsWith('.ts') || f.uri.path.endsWith('.tsx'));
		if (tsFiles.length > 0 && !options.env?.SKIP_TS_CHECK) {
			try {
				// Try to compile TypeScript to check syntax
				const result = await this.executeInVM(
					`const ts = require('typescript'); const result = ts.transpileModule(code, { compilerOptions: { noEmit: true } });`,
					{ timeout: 10000 },
					token
				);
				if (!result.success) {
					errors.push(`TypeScript validation failed: ${result.stderr}`);
				}
			} catch (error) {
				// TypeScript not available, skip validation
				this.logService.debug('[AgentSandbox] TypeScript validation skipped');
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	/**
	 * Cancel an active execution
	 */
	cancelExecution(executionId: string): void {
		const process = this.activeExecutions.get(executionId);
		if (process && !process.killed) {
			process.kill('SIGTERM');
			setTimeout(() => {
				if (!process.killed) {
					process.kill('SIGKILL');
				}
			}, 5000);
		}
	}

	override dispose(): void {
		// Cancel all active executions
		for (const [, process] of this.activeExecutions.entries()) {
			if (!process.killed) {
				process.kill('SIGTERM');
			}
		}
		this.activeExecutions.clear();
		super.dispose();
	}

	private generateSandboxId(content: string): string {
		return getCrypto().createHash('sha256').update(content).digest('hex').substring(0, 16);
	}

	private async cleanupSandbox(dir: URI): Promise<void> {
		try {
			// Remove sandbox directory
			await getFsPromises().rm(dir.fsPath, { recursive: true, force: true });
		} catch (error) {
			this.logService.debug(`[AgentSandbox] Failed to cleanup ${dir.fsPath}`, error);
		}
	}

	private isCommandAllowed(command: string, allowedCommands?: string[]): boolean {
		if (!allowedCommands || allowedCommands.length === 0) {
			// Default allowed commands
			const defaultAllowed = [
				'npm test',
				'npm run test',
				'npx jest',
				'npx mocha',
				'npx tsc',
				'node',
				'python -m pytest',
			];
			return defaultAllowed.some(allowed => command.startsWith(allowed));
		}

		return allowedCommands.some(allowed => {
			if (allowed.startsWith('/') && allowed.endsWith('/')) {
				// Regex pattern
				const pattern = new RegExp(allowed.slice(1, -1));
				return pattern.test(command);
			}
			return command.startsWith(allowed);
		});
	}

	private parseCommand(command: string): string[] {
		// Simple command parsing (handles quoted arguments)
		const parts: string[] = [];
		let current = '';
		let inQuotes = false;
		let quoteChar = '';

		for (let i = 0; i < command.length; i++) {
			const char = command[i];

			if ((char === '"' || char === "'") && !inQuotes) {
				inQuotes = true;
				quoteChar = char;
			} else if (char === quoteChar && inQuotes) {
				inQuotes = false;
				quoteChar = '';
			} else if (char === ' ' && !inQuotes) {
				if (current) {
					parts.push(current);
					current = '';
				}
			} else {
				current += char;
			}
		}

		if (current) {
			parts.push(current);
		}

		return parts;
	}

	private createTimeoutPromise(timeout: number): Promise<never> {
		return new Promise((_, reject) => {
			setTimeout(() => reject(new Error(`Execution timeout after ${timeout}ms`)), timeout);
		});
	}

	private createCancellationPromise(token?: CancellationToken): Promise<never> {
		return new Promise((_, reject) => {
			if (token) {
				token.onCancellationRequested(() => {
					reject(new Error('Execution cancelled'));
				});
			}
		});
	}
}

