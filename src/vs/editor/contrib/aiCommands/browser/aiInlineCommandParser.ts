/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../common/model.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';

export interface AIInlineCommand {
	readonly command: string;
	readonly range: Range;
	readonly prompt?: string;
}

export const AI_COMMAND_PATTERNS = [
	{ pattern: /\/\/\s*\/fix\s*(.*)/i, command: 'fix' },
	{ pattern: /\/\/\s*\/refactor\s*(.*)/i, command: 'refactor' },
	{ pattern: /\/\/\s*\/explain\s*(.*)/i, command: 'explain' },
	{ pattern: /\/\/\s*\/doc\s*(.*)/i, command: 'doc' },
	{ pattern: /\/\/\s*\/test\s*(.*)/i, command: 'test' },
	{ pattern: /\/\/\s*\/optimize\s*(.*)/i, command: 'optimize' },
];

export class AIInlineCommandParser {
	static parseCommands(model: ITextModel): AIInlineCommand[] {
		const commands: AIInlineCommand[] = [];
		const lines = model.getLinesContent();

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNumber = i + 1;

			for (const { pattern, command } of AI_COMMAND_PATTERNS) {
				const match = line.match(pattern);
				if (match) {
					const prompt = match[1]?.trim() || '';
					const range = new Range(lineNumber, 1, lineNumber, line.length + 1);
					commands.push({
						command,
						range,
						prompt,
					});
				}
			}
		}

		return commands;
	}

	static findCommandAtPosition(model: ITextModel, position: Position): AIInlineCommand | undefined {
		const lineNumber = position.lineNumber;
		const line = model.getLineContent(lineNumber);

		for (const { pattern, command } of AI_COMMAND_PATTERNS) {
			const match = line.match(pattern);
			if (match) {
				const prompt = match[1]?.trim() || '';
				const range = new Range(lineNumber, 1, lineNumber, line.length + 1);
				return {
					command,
					range,
					prompt,
				};
			}
		}

		return undefined;
	}
}

