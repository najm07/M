/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { ITerminalCommandService, TerminalCommandContext, TerminalCommandResult } from '../common/terminalCommandService.js';
import { IAIService } from '../common/aiService.js';
import { IContextService } from '../common/contextService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class TerminalCommandService extends Disposable implements ITerminalCommandService {
	declare _serviceBrand: undefined;

	private readonly _onDidExecuteCommand = new Emitter<{ context: TerminalCommandContext; result: TerminalCommandResult }>();
	public readonly onDidExecuteCommand: Event<{ context: TerminalCommandContext; result: TerminalCommandResult }> = this._onDidExecuteCommand.event;

	constructor(
		@IAIService private readonly aiService: IAIService,
		@IContextService private readonly contextService: IContextService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	shouldIntercept(command: string): boolean {
		const trimmed = command.trim();
		return trimmed.startsWith('@workspace') || trimmed.startsWith('@git');
	}

	async processCommand(
		command: string,
		context: TerminalCommandContext,
		token?: CancellationToken
	): Promise<TerminalCommandResult | null> {
		if (!this.shouldIntercept(command)) {
			return null; // Let terminal execute normally
		}

		const trimmed = command.trim();
		let result: TerminalCommandResult;

		try {
			if (trimmed.startsWith('@workspace')) {
				result = await this.processWorkspaceCommand(trimmed, context, token);
			} else if (trimmed.startsWith('@git')) {
				result = await this.processGitCommand(trimmed, context, token);
			} else {
				return null;
			}

			this._onDidExecuteCommand.fire({ context, result });
			return result;
		} catch (error) {
			this.logService.error('[TerminalCommandService] Failed to process command', error);
			result = {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
			this._onDidExecuteCommand.fire({ context, result });
			return result;
		}
	}

	private async processWorkspaceCommand(
		command: string,
		context: TerminalCommandContext,
		token?: CancellationToken
	): Promise<TerminalCommandResult> {
		// Extract the query after @workspace
		const query = command.substring('@workspace'.length).trim();

		if (!query) {
			return {
				success: false,
				error: 'No query provided. Usage: @workspace <your question>',
			};
		}

		this.logService.info(`[TerminalCommandService] Processing @workspace command: ${query}`);

		// Get context from workspace
		const contextResults = await this.contextService.search(query, 5, token);
		const workspaceRoot = context.workspaceRoot || this.workspaceContextService.getWorkspace().folders[0]?.uri;

		// Build prompt with context
		const contextText = contextResults.map(r => `File: ${r.uri.path}\n${r.snippet}`).join('\n\n');

		const prompt = `Based on the workspace context, answer this question: ${query}\n\nContext:\n${contextText}`;

		// Get AI response
		const activeModelId = this.aiService.getActiveModel();
		if (!activeModelId) {
			return {
				success: false,
				error: 'No AI model configured. Please configure a model in ~/.void/config.json',
			};
		}

		try {
			const response = await this.aiService.requestCompletion({
				context: {
					uri: workspaceRoot || context.cwd,
					languageId: '',
					version: 0,
				},
				modelId: activeModelId,
				prompt,
			}, token || CancellationToken.None);

			return {
				success: true,
				output: response.text,
				executedCommand: command,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async processGitCommand(
		command: string,
		context: TerminalCommandContext,
		token?: CancellationToken
	): Promise<TerminalCommandResult> {
		// Extract the git command after @git
		const gitCommand = command.substring('@git'.length).trim();

		if (!gitCommand) {
			return {
				success: false,
				error: 'No git command provided. Usage: @git <git command>',
			};
		}

		this.logService.info(`[TerminalCommandService] Processing @git command: ${gitCommand}`);

		// Get git status and context
		const workspaceRoot = context.workspaceRoot || this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return {
				success: false,
				error: 'No workspace root found',
			};
		}

		try {
			// Get git status
			const { stdout: gitStatus } = await execAsync('git status --porcelain', {
				cwd: workspaceRoot.fsPath,
			});

			// Get recent commits
			const { stdout: recentCommits } = await execAsync('git log --oneline -5', {
				cwd: workspaceRoot.fsPath,
			}).catch(() => ({ stdout: '' }));

			// Build context-aware prompt
			const prompt = `You are a git assistant. The user wants to execute: git ${gitCommand}

Current git status:
${gitStatus || 'No changes'}

Recent commits:
${recentCommits || 'No commits'}

Provide:
1. The actual git command to execute (if safe)
2. Explanation of what it will do
3. Any warnings or suggestions

If the command is destructive (like force push, hard reset), provide a warning.`;

			const activeModelId = this.aiService.getActiveModel();
			if (!activeModelId) {
				// Fallback: execute git command directly if no AI model
				return await this.executeGitCommand(gitCommand, workspaceRoot.fsPath);
			}

			const response = await this.aiService.requestCompletion({
				context: {
					uri: workspaceRoot,
					languageId: '',
					version: 0,
				},
				modelId: activeModelId,
				prompt,
			}, token || CancellationToken.None);

			// Extract command from response if it looks safe
			const responseText = response.text;
			const commandMatch = responseText.match(/git\s+([^\n]+)/);

			if (commandMatch && this.isSafeGitCommand(commandMatch[1])) {
				// Execute the suggested command
				return await this.executeGitCommand(commandMatch[1], workspaceRoot.fsPath);
			}

			// Otherwise, just return the AI explanation
			return {
				success: true,
				output: responseText,
				executedCommand: `git ${gitCommand}`,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async executeGitCommand(gitCommand: string, cwd: string): Promise<TerminalCommandResult> {
		try {
			const { stdout, stderr } = await execAsync(`git ${gitCommand}`, {
				cwd,
				maxBuffer: 10 * 1024 * 1024, // 10MB
			});

			return {
				success: true,
				output: stdout || stderr,
				executedCommand: `git ${gitCommand}`,
			};
		} catch (error: any) {
			return {
				success: false,
				error: error.stderr || error.message,
				executedCommand: `git ${gitCommand}`,
			};
		}
	}

	private isSafeGitCommand(command: string): boolean {
		const unsafePatterns = [
			/--force/,
			/--hard/,
			/reset\s+--hard/,
			/clean\s+-fd/,
			/push\s+--force/,
			/checkout\s+-f/,
		];

		return !unsafePatterns.some(pattern => pattern.test(command));
	}
}

