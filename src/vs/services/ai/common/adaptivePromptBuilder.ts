/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IProjectGraphService } from './projectGraphService.js';
import { IContextService } from './contextService.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { EditorContext } from './aiTypes.js';

export interface AdaptivePromptOptions {
	readonly maxContextFiles?: number;
	readonly includeRelatedFiles?: boolean;
	readonly includeCallChain?: boolean;
	readonly includeDependencies?: boolean;
	readonly projectRules?: string[];
}

export interface AdaptivePromptResult {
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly contextFiles: Array<{ uri: URI; content: string; reason: string }>;
	readonly metadata: Record<string, unknown>;
}

export class AdaptivePromptBuilder {
	constructor(
		private readonly projectGraphService: IProjectGraphService,
		private readonly contextService: IContextService,
		private readonly fileService: IFileService,
	) { }

	async buildPrompt(
		editorContext: EditorContext,
		userPrompt: string,
		options: AdaptivePromptOptions = {},
	): Promise<AdaptivePromptResult> {
		const {
			maxContextFiles = 10,
			includeRelatedFiles = true,
			includeCallChain = true,
			includeDependencies = true,
			projectRules = [],
		} = options;

		const contextFiles: Array<{ uri: URI; content: string; reason: string }> = [];
		const metadata: Record<string, unknown> = {};

		// 1. Get project rules
		const rules = await this.loadProjectRules(editorContext.workspaceFolder);
		const allRules = [...projectRules, ...rules];

		// 2. Get related files from project graph
		if (includeRelatedFiles) {
			const relatedNodes = await this.projectGraphService.getRelatedNodes(editorContext.uri, undefined, 2);
			for (const node of relatedNodes.slice(0, maxContextFiles)) {
				try {
					const content = await this.fileService.readFile(node.uri);
					contextFiles.push({
						uri: node.uri,
						content: content.value.toString(),
						reason: `Related file: ${node.name}`,
					});
				} catch (error) {
					// Skip files we can't read
				}
			}
		}

		// 3. Get call chain if we have a symbol
		if (includeCallChain && editorContext.selection) {
			// Try to extract symbol name from selection
			const symbol = this.extractSymbolName(editorContext.content || '', editorContext.selection);
			if (symbol) {
				const callChain = await this.projectGraphService.getCallChain(editorContext.uri, symbol);
				for (const node of [...callChain.calls, ...callChain.calledBy].slice(0, 5)) {
					if (!contextFiles.some(f => f.uri.toString() === node.uri.toString())) {
						try {
							const content = await this.fileService.readFile(node.uri);
							contextFiles.push({
								uri: node.uri,
								content: content.value.toString(),
								reason: `Call chain: ${symbol}`,
							});
						} catch (error) {
							// Skip
						}
					}
				}
			}
		}

		// 4. Get dependencies
		if (includeDependencies) {
			const dependencies = await this.projectGraphService.getDependencies(editorContext.uri);
			for (const dep of dependencies.slice(0, 5)) {
				if (!contextFiles.some(f => f.uri.toString() === dep.uri.toString())) {
					try {
						const content = await this.fileService.readFile(dep.uri);
						contextFiles.push({
							uri: dep.uri,
							content: content.value.toString(),
							reason: 'Dependency',
						});
					} catch (error) {
						// Skip
					}
				}
			}
		}

		// 5. Get semantic context from embeddings
		const semanticResults = await this.contextService.search(userPrompt, 5);
		for (const result of semanticResults) {
			if (!contextFiles.some(f => f.uri.toString() === result.uri.toString())) {
				try {
					const content = await this.fileService.readFile(result.uri);
					contextFiles.push({
						uri: result.uri,
						content: content.value.toString(),
						reason: `Semantic match (score: ${result.score.toFixed(2)})`,
					});
				} catch (error) {
					// Skip
				}
			}
		}

		// Limit total context files
		const finalContextFiles = contextFiles.slice(0, maxContextFiles);

		// Build system prompt
		const systemPrompt = this.buildSystemPrompt(allRules, editorContext);

		// Build enhanced user prompt with context
		const enhancedUserPrompt = this.buildUserPrompt(userPrompt, editorContext, finalContextFiles);

		metadata.contextFileCount = finalContextFiles.length;
		metadata.relatedFiles = finalContextFiles.map(f => f.uri.toString());
		metadata.projectRules = allRules.length;

		return {
			systemPrompt,
			userPrompt: enhancedUserPrompt,
			contextFiles: finalContextFiles,
			metadata,
		};
	}

	private async loadProjectRules(workspaceFolder?: URI): Promise<string[]> {
		if (!workspaceFolder) {
			return [];
		}

		const rulesPath = URI.joinPath(workspaceFolder, '.vscode', 'ai', 'rules.md');
		try {
			if (await this.fileService.exists(rulesPath)) {
				const content = await this.fileService.readFile(rulesPath);
				const rules = content.value.toString()
					.split('\n')
					.map(line => line.trim())
					.filter(line => line && !line.startsWith('#') && line.startsWith('-'))
					.map(line => line.replace(/^-\s*/, ''));
				return rules;
			}
		} catch (error) {
			// Rules file not found or unreadable
		}

		return [];
	}

	private extractSymbolName(content: string, selection: any): string | undefined {
		// Simple extraction - can be enhanced with language services
		const lines = content.split('\n');
		if (selection.startLineNumber && selection.startLineNumber <= lines.length) {
			const line = lines[selection.startLineNumber - 1];
			// Try to find function/class name
			const match = line.match(/(?:function|class|const|let|var)\s+(\w+)/);
			return match?.[1];
		}
		return undefined;
	}

	private buildSystemPrompt(rules: string[], editorContext: EditorContext): string {
		const parts: string[] = [];

		parts.push('You are an AI coding assistant integrated into VS Code.');
		parts.push(`You are working on file: ${editorContext.uri.path.split('/').pop()}`);
		parts.push(`Language: ${editorContext.languageId}`);

		if (rules.length > 0) {
			parts.push('\nProject-specific rules:');
			for (const rule of rules) {
				parts.push(`- ${rule}`);
			}
		}

		parts.push('\nGuidelines:');
		parts.push('- Provide clear, concise, and accurate code suggestions');
		parts.push('- Follow the project\'s coding style and conventions');
		parts.push('- Consider related files and dependencies when making suggestions');
		parts.push('- Explain your reasoning when making significant changes');

		return parts.join('\n');
	}

	private buildUserPrompt(
		userPrompt: string,
		editorContext: EditorContext,
		contextFiles: Array<{ uri: URI; content: string; reason: string }>,
	): string {
		const parts: string[] = [];

		parts.push(userPrompt);

		if (editorContext.content) {
			parts.push('\n\nCurrent file context:');
			parts.push('```' + editorContext.languageId);
			parts.push(editorContext.content);
			parts.push('```');
		}

		if (contextFiles.length > 0) {
			parts.push('\n\nRelated files for context:');
			for (const file of contextFiles) {
				const fileName = file.uri.path.split('/').pop() || file.uri.toString();
				parts.push(`\n--- ${fileName} (${file.reason}) ---`);
				parts.push('```');
				parts.push(file.content.substring(0, 2000)); // Limit content size
				if (file.content.length > 2000) {
					parts.push('... (truncated)');
				}
				parts.push('```');
			}
		}

		return parts.join('\n');
	}
}

