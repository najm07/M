/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { ITreeSitterLibraryService } from '../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ImportReference, CallReference } from '../common/projectGraphService.js';

export interface AnalyzerResult {
	imports: ImportReference[];
	exports: string[];
	calls: CallReference[];
	functions: Array<{ name: string; line: number; column: number }>;
	classes: Array<{ name: string; line: number; column: number }>;
}

/**
 * WASM-based analyzer for performance-critical code indexing.
 * Uses tree-sitter WASM parsers for fast, accurate code analysis.
 */
export class WASMAnalyzer extends Disposable {
	constructor(
		private readonly treeSitterService: ITreeSitterLibraryService,
		private readonly logService: ILogService,
	) {
		super();
	}

	async analyzeFile(
		uri: URI,
		content: string,
		languageId: string,
		token?: CancellationToken
	): Promise<AnalyzerResult | undefined> {
		try {
			const language = await this.treeSitterService.getLanguagePromise(languageId);
			if (!language) {
				this.logService.debug(`[WASMAnalyzer] Language ${languageId} not supported by tree-sitter`);
				return undefined;
			}

			const ParserClass = await this.treeSitterService.getParserClass();
			const parser = new ParserClass();
			parser.setLanguage(language);

			const tree = parser.parse(content);
			if (!tree) {
				return undefined;
			}

			const result: AnalyzerResult = {
				imports: [],
				exports: [],
				calls: [],
				functions: [],
				classes: [],
			};

			// Get language-specific queries
			const queries = this.getQueriesForLanguage(languageId);
			if (!queries) {
				return undefined;
			}

			// Execute queries
			for (const querySource of queries) {
				if (token?.isCancellationRequested) {
					break;
				}

				try {
					const query = await this.treeSitterService.createQuery(language, querySource.query);
					const captures = query.captures(tree.rootNode);

					for (const capture of captures) {
						const node = capture.node;
						const captureName = capture.name;

						if (querySource.captureMap[captureName]) {
							const handler = querySource.captureMap[captureName];
							handler(node, result, uri);
						}
					}
				} catch (error) {
					this.logService.debug(`[WASMAnalyzer] Error executing query for ${languageId}`, error);
				}
			}

			return result;
		} catch (error) {
			this.logService.debug(`[WASMAnalyzer] Error analyzing file ${uri.toString()}`, error);
			return undefined;
		}
	}

	private getQueriesForLanguage(languageId: string): Array<{
		query: string;
		captureMap: Record<string, (node: any, result: AnalyzerResult, uri: URI) => void>;
	}> | undefined {
		const queries: Record<string, Array<{
			query: string;
			captureMap: Record<string, (node: any, result: AnalyzerResult, uri: URI) => void>;
		}>> = {
			typescript: [
				{
					query: `
						(import_statement source: (string) @import_path)
						(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @export_name)))
						(function_declaration name: (identifier) @function_name)
						(class_declaration name: (type_identifier) @class_name)
						(call_expression function: (identifier) @call_name)
					`,
					captureMap: {
						import_path: (node, result) => {
							const importPath = node.text.replace(/['"]/g, '');
							if (importPath) {
								result.imports.push({ from: URI.parse(importPath) });
							}
						},
						export_name: (node, result) => {
							result.exports.push(node.text.trim());
						},
						function_name: (node, result) => {
							result.functions.push({
								name: node.text,
								line: node.startPosition.row + 1,
								column: node.startPosition.column + 1,
							});
						},
						class_name: (node, result) => {
							result.classes.push({
								name: node.text,
								line: node.startPosition.row + 1,
								column: node.startPosition.column + 1,
							});
						},
						call_name: (node, result, uri) => {
							result.calls.push({
								target: uri, // Target URI (will be resolved later)
								symbol: node.text,
								range: {
									startLineNumber: node.startPosition.row + 1,
									startColumn: node.startPosition.column + 1,
									endLineNumber: node.endPosition.row + 1,
									endColumn: node.endPosition.column + 1,
								},
							});
						},
					},
				},
			],
			javascript: [
				{
					query: `
						(import_statement source: (string) @import_path)
						(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @export_name)))
						(function_declaration name: (identifier) @function_name)
						(class_declaration name: (identifier) @class_name)
						(call_expression function: (identifier) @call_name)
					`,
					captureMap: {
						import_path: (node, result) => {
							const importPath = node.text.replace(/['"]/g, '');
							if (importPath) {
								result.imports.push({ from: URI.parse(importPath) });
							}
						},
						export_name: (node, result) => {
							result.exports.push(node.text.trim());
						},
						function_name: (node, result) => {
							result.functions.push({
								name: node.text,
								line: node.startPosition.row + 1,
								column: node.startPosition.column + 1,
							});
						},
						class_name: (node, result) => {
							result.classes.push({
								name: node.text,
								line: node.startPosition.row + 1,
								column: node.startPosition.column + 1,
							});
						},
						call_name: (node, result, uri) => {
							result.calls.push({
								target: uri, // Target URI (will be resolved later)
								symbol: node.text,
								range: {
									startLineNumber: node.startPosition.row + 1,
									startColumn: node.startPosition.column + 1,
									endLineNumber: node.endPosition.row + 1,
									endColumn: node.endPosition.column + 1,
								},
							});
						},
					},
				},
			],
			python: [
				{
					query: `
						(import_statement module_name: (dotted_name) @import_path)
						(function_definition name: (identifier) @function_name)
						(class_definition name: (identifier) @class_name)
						(call function: (identifier) @call_name)
					`,
					captureMap: {
						import_path: (node, result) => {
							const importPath = node.text;
							if (importPath) {
								result.imports.push({ from: URI.parse(importPath) });
							}
						},
						function_name: (node, result) => {
							result.functions.push({
								name: node.text,
								line: node.startPosition.row + 1,
								column: node.startPosition.column + 1,
							});
							result.exports.push(node.text);
						},
						class_name: (node, result) => {
							result.classes.push({
								name: node.text,
								line: node.startPosition.row + 1,
								column: node.startPosition.column + 1,
							});
							result.exports.push(node.text);
						},
						call_name: (node, result, uri) => {
							result.calls.push({
								target: uri, // Target URI (will be resolved later)
								symbol: node.text,
								range: {
									startLineNumber: node.startPosition.row + 1,
									startColumn: node.startPosition.column + 1,
									endLineNumber: node.endPosition.row + 1,
									endColumn: node.endPosition.column + 1,
								},
							});
						},
					},
				},
			],
		};

		return queries[languageId];
	}

	/**
	 * Batch analyze multiple files for better performance.
	 */
	async analyzeFiles(
		files: Array<{ uri: URI; content: string; languageId: string }>,
		token?: CancellationToken
	): Promise<Map<string, AnalyzerResult>> {
		const results = new Map<string, AnalyzerResult>();

		// Process files in parallel (with concurrency limit)
		const concurrency = 10;
		const chunks: Array<typeof files> = [];
		for (let i = 0; i < files.length; i += concurrency) {
			chunks.push(files.slice(i, i + concurrency));
		}

		for (const chunk of chunks) {
			if (token?.isCancellationRequested) {
				break;
			}

			const chunkResults = await Promise.all(
				chunk.map(async (file) => {
					const result = await this.analyzeFile(file.uri, file.content, file.languageId, token);
					return { uri: file.uri.toString(), result };
				})
			);

			for (const { uri, result } of chunkResults) {
				if (result) {
					results.set(uri, result);
				}
			}
		}

		return results;
	}
}

