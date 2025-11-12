/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { ITextModel } from '../../../common/model.js';
import { CodeLens, CodeLensList, CodeLensProvider } from '../../../common/languages.js';
import { Range } from '../../../common/core/range.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { IAIService } from '../../../../services/ai/common/aiService.js';

export class AICommandsCodeLensProvider extends Disposable implements CodeLensProvider {
	private readonly _onDidChangeCodeLensesEmitter = this._register(new Emitter<void>());
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLensesEmitter.event;

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IAIService private readonly aiService: IAIService,
	) {
		super();

		// Register this provider for all languages
		this._register(this.languageFeaturesService.codeLensProvider.register('*', this));

		// Refresh code lenses when AI service changes
		this._register(this.aiService.onDidChangeActiveModel(() => {
			this._onDidChangeCodeLensesEmitter.fire();
		}));
	}

	async provideCodeLenses(model: ITextModel, token: CancellationToken): Promise<CodeLensList | undefined> {
		// Only show AI commands if AI service is configured
		const models = this.aiService.getModels();
		if (models.length === 0) {
			return undefined;
		}

		const lenses: CodeLens[] = [];
		const lines = model.getLinesContent();

		// Look for function definitions and add AI command lenses
		for (let i = 0; i < lines.length; i++) {
			if (token.isCancellationRequested) {
				break;
			}

			const line = lines[i];
			const lineNumber = i + 1;

			// Detect function definitions (simplified - can be enhanced with language service)
			const functionPatterns = [
				/^\s*(export\s+)?(async\s+)?function\s+\w+/,
				/^\s*(export\s+)?(async\s+)?\w+\s*[:=]\s*(async\s+)?\(/,
				/^\s*(export\s+)?(public|private|protected)?\s*(async\s+)?\w+\s*\(/,
				/^\s*def\s+\w+/,
			];

			const isFunction = functionPatterns.some(pattern => pattern.test(line));
			if (isFunction) {
				const range = new Range(lineNumber, 1, lineNumber, 1);
				lenses.push({
					range,
					command: {
						id: 'ai.command.explain',
						title: localize('ai.codelens.explain', '$(sparkle) Explain'),
						arguments: [model.uri, range],
					},
				});
				lenses.push({
					range,
					command: {
						id: 'ai.command.refactor',
						title: localize('ai.codelens.refactor', '$(wand) Refactor'),
						arguments: [model.uri, range],
					},
				});
				lenses.push({
					range,
					command: {
						id: 'ai.command.test',
						title: localize('ai.codelens.test', '$(beaker) Test'),
						arguments: [model.uri, range],
					},
				});
			}
		}

		return lenses.length > 0 ? { lenses } : undefined;
	}
}

