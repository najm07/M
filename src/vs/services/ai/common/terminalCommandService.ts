/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';

export const ITerminalCommandService = createDecorator<ITerminalCommandService>('terminalCommandService');

export interface TerminalCommandContext {
	readonly command: string;
	readonly cwd: URI;
	readonly workspaceRoot?: URI;
	readonly terminalId: string;
}

export interface TerminalCommandResult {
	readonly success: boolean;
	readonly output?: string;
	readonly error?: string;
	readonly executedCommand?: string;
}

export interface ITerminalCommandService {
	readonly _serviceBrand: undefined;

	readonly onDidExecuteCommand: Event<{ context: TerminalCommandContext; result: TerminalCommandResult }>;

	/**
	 * Process a terminal command, handling @workspace and @git prefixes
	 */
	processCommand(
		command: string,
		context: TerminalCommandContext,
		token?: CancellationToken
	): Promise<TerminalCommandResult | null>; // Returns null if command should be executed normally

	/**
	 * Check if a command should be intercepted
	 */
	shouldIntercept(command: string): boolean;
}

