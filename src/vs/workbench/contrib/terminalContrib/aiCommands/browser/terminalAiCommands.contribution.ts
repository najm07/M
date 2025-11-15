/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { registerWorkbenchContribution2, WorkbenchPhase, type IWorkbenchContribution } from '../../../../common/contributions.js';
import { ITerminalService, ITerminalInstance } from '../../../../../workbench/contrib/terminal/browser/terminal.js';
import { ITerminalCommandService } from '../../../../../services/ai/common/terminalCommandService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import type { ITerminalCommand } from '../../../../../platform/terminal/common/capabilities/capabilities.js';

export class TerminalAICommandsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.terminalAiCommands';

	private readonly _listeners = new Map<string, IDisposable>();

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@ITerminalCommandService private readonly terminalCommandService: ITerminalCommandService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();

		// Listen to terminal instances
		this._register(this.terminalService.onDidCreateInstance(instance => {
			this.attachToTerminal(instance);
		}));

		// Attach to existing instances
		for (const instance of this.terminalService.instances) {
			this.attachToTerminal(instance);
		}
	}

	private attachToTerminal(instance: ITerminalInstance): void {
		const instanceId = String(instance.instanceId);
		if (this._listeners.has(instanceId)) {
			return;
		}

		// Listen to command execution events
		const commandDetection = instance.capabilities.get(TerminalCapability.CommandDetection);
		if (commandDetection) {
			const disposable = commandDetection.onCommandExecuted(async (command: ITerminalCommand) => {
				const commandLine = command.extractCommandLine()?.trim();
				if (!commandLine || !this.terminalCommandService.shouldIntercept(commandLine)) {
					return;
				}

				this.logService.info(`[TerminalAICommands] Intercepting command: ${commandLine}`);

				// Get workspace context
				const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
				const cwd = await instance.getCwdResource() || workspaceRoot || URI.file(process.cwd());

				// Process command
				const result = await this.terminalCommandService.processCommand(
					commandLine,
					{
						command: commandLine,
						cwd,
						workspaceRoot,
						terminalId: instanceId,
					},
					CancellationToken.None
				);

				if (result) {
					// Display result in terminal
					if (result.success && result.output) {
						instance.sendText(`\n${result.output}\n`, false);
					} else if (result.error) {
						instance.sendText(`\nError: ${result.error}\n`, false);
					}
				}
			});

			this._listeners.set(instanceId, disposable);
			this._register(disposable);
		}
	}
}

registerWorkbenchContribution2(TerminalAICommandsContribution.ID, TerminalAICommandsContribution, WorkbenchPhase.AfterRestored);

