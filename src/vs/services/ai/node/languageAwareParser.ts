/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IModelService } from '../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../editor/common/services/languageFeatures.js';
import { ITreeSitterLibraryService } from '../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { ILanguageService } from '../../../editor/common/languages/language.js';
import { ProjectNode, ImportReference, CallReference } from '../common/projectGraphService.js';
import { IRange } from '../../../editor/common/core/range.js';
import { Range } from '../../../editor/common/core/range.js';
import { WASMAnalyzer } from './wasmAnalyzer.js';

export interface ParsedFileResult {
	node: ProjectNode;
	imports: ImportReference[];
	exports: string[];
	calls: CallReference[];
}

export class LanguageAwareParser {
	private readonly wasmAnalyzer: WASMAnalyzer | undefined;

	constructor(
		private readonly modelService: IModelService,
		private readonly languageFeaturesService: ILanguageFeaturesService,
		private readonly treeSitterService: ITreeSitterLibraryService | undefined,
		private readonly logService: ILogService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
		if (this.treeSitterService) {
			this.wasmAnalyzer = new WASMAnalyzer(this.treeSitterService, this.logService);
		}
	}

	async parseFile(uri: URI, content: string, workspaceRoot: URI, token?: CancellationToken): Promise<ParsedFileResult | undefined> {
		const languageId = this.getLanguageId(uri);
		if (!languageId) {
			return undefined;
		}

		// Try language service first (best for TypeScript/JavaScript)
		if (this.supportsLanguageService(languageId)) {
			const result = await this.parseWithLanguageService(uri, content, languageId, token);
			if (result) {
				return result;
			}
		}

		// Try WASM analyzer first (fastest for performance-critical indexing)
		if (this.wasmAnalyzer) {
			const result = await this.parseWithWASMAnalyzer(uri, content, languageId, workspaceRoot, token);
			if (result) {
				return result;
			}
		}

		// Try tree-sitter WASM parser (good for many languages)
		if (this.treeSitterService) {
			const result = await this.parseWithTreeSitter(uri, content, languageId, workspaceRoot, token);
			if (result) {
				return result;
			}
		}

		// Fall back to regex-based parsing
		return this.parseWithRegex(uri, content, languageId, workspaceRoot);
	}

	private getLanguageId(uri: URI): string | undefined {
		const path = uri.path.toLowerCase();
		if (path.endsWith('.ts') || path.endsWith('.tsx')) {
			return 'typescript';
		}
		if (path.endsWith('.js') || path.endsWith('.jsx')) {
			return 'javascript';
		}
		if (path.endsWith('.py')) {
			return 'python';
		}
		if (path.endsWith('.java')) {
			return 'java';
		}
		if (path.endsWith('.cpp') || path.endsWith('.cc') || path.endsWith('.cxx') || path.endsWith('.c++')) {
			return 'cpp';
		}
		if (path.endsWith('.c')) {
			return 'c';
		}
		if (path.endsWith('.cs')) {
			return 'csharp';
		}
		if (path.endsWith('.go')) {
			return 'go';
		}
		if (path.endsWith('.rs')) {
			return 'rust';
		}
		if (path.endsWith('.rb')) {
			return 'ruby';
		}
		if (path.endsWith('.php')) {
			return 'php';
		}
		return undefined;
	}

	private supportsLanguageService(languageId: string): boolean {
		return languageId === 'typescript' || languageId === 'javascript';
	}

	private async parseWithLanguageService(
		uri: URI,
		content: string,
		languageId: string,
		token?: CancellationToken
	): Promise<ParsedFileResult | undefined> {
		try {
			const languageSelection = this.languageService.createById(languageId);
			const model = this.modelService.getModel(uri) || this.modelService.createModel(content, languageSelection, uri);
			if (!model) {
				return undefined;
			}

			const imports: ImportReference[] = [];
			const exports: string[] = [];
			const calls: CallReference[] = [];

			// Get document symbols to find exports
			const symbolProviders = this.languageFeaturesService.documentSymbolProvider.ordered(model);
			for (const provider of symbolProviders) {
				try {
					const symbols = await provider.provideDocumentSymbols(model, token || CancellationToken.None);
					if (symbols) {
						for (const symbol of symbols) {
							if (symbol.kind === 2 || symbol.kind === 5 || symbol.kind === 7) { // Function, Class, Variable
								if (symbol.name && (symbol.containerName === '' || symbol.name.startsWith('export'))) {
									exports.push(symbol.name);
								}
							}
							this.collectSymbols(symbol, exports);
						}
					}
				} catch (error) {
					this.logService.debug(`[LanguageAwareParser] Error getting symbols for ${uri.toString()}`, error);
				}
			}

			// Extract imports using regex (language service doesn't provide import info directly)
			const importRegex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g;
			let match;
			while ((match = importRegex.exec(content)) !== null) {
				const importPath = match[1];
				const resolvedUri = this.resolveImport(uri, importPath);
				if (resolvedUri) {
					imports.push({ from: resolvedUri });
				}
			}

			// Try to find function calls using references
			// This is a simplified approach - full implementation would traverse the AST

			return {
				node: {
					uri,
					name: uri.path.split('/').pop() || uri.toString(),
					type: 'file',
					imports,
					exports,
					calls,
				},
				imports,
				exports,
				calls,
			};
		} catch (error) {
			this.logService.debug(`[LanguageAwareParser] Error parsing with language service: ${uri.toString()}`, error);
			return undefined;
		}
	}

	private collectSymbols(symbol: any, exports: string[]): void {
		if (symbol.children) {
			for (const child of symbol.children) {
				if (child.name && (child.kind === 2 || child.kind === 5 || child.kind === 7)) {
					exports.push(child.name);
				}
				this.collectSymbols(child, exports);
			}
		}
	}

	private async parseWithWASMAnalyzer(
		uri: URI,
		content: string,
		languageId: string,
		workspaceRoot: URI,
		token?: CancellationToken
	): Promise<ParsedFileResult | undefined> {
		if (!this.wasmAnalyzer) {
			return undefined;
		}

		try {
			const analysis = await this.wasmAnalyzer.analyzeFile(uri, content, languageId, token);
			if (!analysis) {
				return undefined;
			}

			return {
				node: {
					uri,
					name: uri.path.split('/').pop() || uri.toString(),
					type: 'file',
					imports: analysis.imports,
					exports: analysis.exports,
					calls: analysis.calls,
					metadata: {
						functions: analysis.functions,
						classes: analysis.classes,
					},
				},
				imports: analysis.imports,
				exports: analysis.exports,
				calls: analysis.calls,
			};
		} catch (error) {
			this.logService.debug(`[LanguageAwareParser] Error parsing with WASM analyzer: ${uri.toString()}`, error);
			return undefined;
		}
	}

	private async parseWithTreeSitter(
		uri: URI,
		content: string,
		languageId: string,
		workspaceRoot: URI,
		token?: CancellationToken
	): Promise<ParsedFileResult | undefined> {
		try {
			const language = await this.treeSitterService!.getLanguagePromise(languageId);
			if (!language) {
				return undefined;
			}

			const ParserClass = await this.treeSitterService!.getParserClass();
			const parser = new ParserClass();
			parser.setLanguage(language);

			const tree = parser.parse(content);
			if (!tree) {
				return undefined;
			}

			const imports: ImportReference[] = [];
			const exports: string[] = [];
			const calls: CallReference[] = [];

			// Create queries based on language
			const queries = this.getTreeSitterQueries(languageId);
			if (queries) {
				for (const querySource of queries) {
					try {
						const query = await this.treeSitterService!.createQuery(language, querySource);
						const captures = query.captures(tree.rootNode);

						for (const capture of captures) {
							const node = capture.node;
							const captureName = capture.name;

							if (captureName === 'import_path' && node.text) {
								const importPath = node.text.replace(/['"]/g, '');
								const resolvedUri = this.resolveImport(uri, importPath, languageId);
								if (resolvedUri) {
									imports.push({ from: resolvedUri });
								}
							} else if (captureName === 'export_name' && node.text) {
								exports.push(node.text.trim());
							} else if (captureName === 'function_call' && node.text) {
								// Extract function name from call
								const callMatch = node.text.match(/(\w+)\s*\(/);
								if (callMatch) {
									calls.push({
										target: uri, // Required property
										symbol: callMatch[1],
										range: this.nodeToRange(node),
									});
								}
							}
						}
					} catch (error) {
						this.logService.debug(`[LanguageAwareParser] Error executing tree-sitter query: ${uri.toString()}`, error);
					}
				}
			}

			return {
				node: {
					uri,
					name: uri.path.split('/').pop() || uri.toString(),
					type: 'file',
					imports,
					exports,
					calls,
				},
				imports,
				exports,
				calls,
			};
		} catch (error) {
			this.logService.debug(`[LanguageAwareParser] Error parsing with tree-sitter: ${uri.toString()}`, error);
			return undefined;
		}
	}

	private getTreeSitterQueries(languageId: string): string[] | undefined {
		const queries: Record<string, string[]> = {
			typescript: [
				'(import_statement source: (string) @import_path)',
				'(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @export_name)))',
				'(call_expression function: (identifier) @function_call)',
			],
			javascript: [
				'(import_statement source: (string) @import_path)',
				'(export_statement declaration: (variable_declaration (variable_declarator name: (identifier) @export_name)))',
				'(call_expression function: (identifier) @function_call)',
			],
			python: [
				'(import_statement module_name: (dotted_name) @import_path)',
				'(function_definition name: (identifier) @export_name)',
				'(call function: (identifier) @function_call)',
			],
			java: [
				'(import_declaration (scoped_identifier) @import_path)',
				'(method_declaration name: (identifier) @export_name)',
				'(method_invocation name: (identifier) @function_call)',
			],
			cpp: [
				'(preproc_include path: (string_literal) @import_path)',
				'(function_declarator declarator: (identifier) @export_name)',
				'(call_expression function: (identifier) @function_call)',
			],
		};

		return queries[languageId];
	}

	private nodeToRange(node: any): IRange {
		// Tree-sitter nodes have startPosition and endPosition
		if (node.startPosition && node.endPosition) {
			return new Range(
				node.startPosition.row + 1, // Tree-sitter uses 0-based, VS Code uses 1-based
				node.startPosition.column + 1,
				node.endPosition.row + 1,
				node.endPosition.column + 1
			);
		}
		// Fallback
		return new Range(0, 0, 0, 0);
	}

	private parseWithRegex(
		uri: URI,
		content: string,
		languageId: string,
		workspaceRoot: URI
	): ParsedFileResult {
		const imports: ImportReference[] = [];
		const exports: string[] = [];
		const calls: CallReference[] = [];

		// Language-specific regex patterns
		const patterns = this.getRegexPatterns(languageId);
		if (patterns) {
			// Extract imports
			if (patterns.import) {
				let match;
				while ((match = patterns.import.exec(content)) !== null) {
					const importPath = match[1] || match[2] || match[3];
					if (importPath) {
						const resolvedUri = this.resolveImport(uri, importPath, languageId);
						if (resolvedUri) {
							imports.push({ from: resolvedUri });
						}
					}
				}
			}

			// Extract exports
			if (patterns.export) {
				let match;
				while ((match = patterns.export.exec(content)) !== null) {
					const exportName = match[1] || match[2];
					if (exportName) {
						exports.push(exportName);
					}
				}
			}

			// Extract function calls (simplified)
			if (patterns.call) {
				let match;
				while ((match = patterns.call.exec(content)) !== null) {
					const callName = match[1];
					if (callName) {
						calls.push({
							target: uri, // Required property
							symbol: callName,
						});
					}
				}
			}
		}

		return {
			node: {
				uri,
				name: uri.path.split('/').pop() || uri.toString(),
				type: 'file',
				imports,
				exports,
				calls,
			},
			imports,
			exports,
			calls,
		};
	}

	private getRegexPatterns(languageId: string): { import?: RegExp; export?: RegExp; call?: RegExp } | undefined {
		const patterns: Record<string, { import?: RegExp; export?: RegExp; call?: RegExp }> = {
			typescript: {
				import: /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g,
				export: /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g,
				call: /(\w+)\s*\(/g,
			},
			javascript: {
				import: /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g,
				export: /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
				call: /(\w+)\s*\(/g,
			},
			python: {
				import: /(?:from\s+([\w.]+)\s+)?import\s+([\w, ]+)/g,
				export: /def\s+(\w+)\s*\(/g,
				call: /(\w+)\s*\(/g,
			},
			java: {
				import: /import\s+([\w.]+);/g,
				export: /(?:public\s+)?(?:static\s+)?(?:void|int|String|boolean|double|float)\s+(\w+)\s*\(/g,
				call: /(\w+)\s*\(/g,
			},
			cpp: {
				import: /#include\s+[<"]([^>"]+)[>"]/g,
				export: /(?:void|int|double|float|bool|string)\s+(\w+)\s*\(/g,
				call: /(\w+)\s*\(/g,
			},
		};

		return patterns[languageId];
	}

	private resolveImport(from: URI, importPath: string, languageId?: string): URI | undefined {
		// Remove quotes if present
		importPath = importPath.replace(/['"]/g, '');

		// Relative imports
		if (importPath.startsWith('.')) {
			const baseDir = URI.joinPath(from, '..');
			const pathParts = importPath.split('/').filter(p => p !== '.');
			let resolved = baseDir;
			for (const part of pathParts) {
				if (part === '..') {
					resolved = URI.joinPath(resolved, '..');
				} else if (part) {
					resolved = URI.joinPath(resolved, part);
				}
			}
			// Try common extensions if path doesn't already have one
			const pathStr = resolved.path;
			if (!pathStr.match(/\.\w+$/)) {
				const extensions = languageId === 'python' ? ['.py'] : ['.ts', '.tsx', '.js', '.jsx'];
				for (const ext of extensions) {
					const withExt = URI.joinPath(resolved, pathStr.split('/').pop()! + ext);
					// In real implementation, check if file exists
					return withExt;
				}
			}
			return resolved;
		}

		// Absolute imports (node_modules, etc.)
		// This is simplified - real implementation would need module resolution
		return undefined;
	}
}

