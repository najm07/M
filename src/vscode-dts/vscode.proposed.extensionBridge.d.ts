/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	/**
	 * Context information that extensions can contribute or consume
	 */
	export interface ExtensionContextItem {
		readonly id: string;
		readonly type: 'file' | 'symbol' | 'relationship' | 'metadata';
		readonly uri?: Uri;
		readonly range?: Range;
		readonly content?: string;
		readonly metadata?: Record<string, unknown>;
		readonly relationships?: ExtensionContextRelationship[];
	}

	export interface ExtensionContextRelationship {
		readonly target: string;
		readonly type: 'imports' | 'calls' | 'references' | 'depends' | 'custom';
		readonly metadata?: Record<string, unknown>;
	}

	export interface ExtensionContextQuery {
		readonly query: string;
		readonly maxResults?: number;
		readonly types?: Array<'file' | 'symbol' | 'relationship' | 'metadata'>;
		readonly filters?: {
			readonly languageIds?: string[];
			readonly filePatterns?: string[];
			readonly metadata?: Record<string, unknown>;
		};
	}

	export interface ExtensionContextProvider {
		provideContext(query: ExtensionContextQuery, token: CancellationToken): ProviderResult<ExtensionContextItem[]>;
		getContext?(uri: Uri, symbol?: string, token?: CancellationToken): ProviderResult<ExtensionContextItem | undefined>;
		getRelated?(itemId: string, relationshipTypes: string[], token: CancellationToken): ProviderResult<ExtensionContextItem[]>;
	}

	export namespace ai {
		/**
		 * Query the AI context system (semantic search + extension contributions)
		 */
		export function queryContext(query: ExtensionContextQuery, token?: CancellationToken): Thenable<ExtensionContextItem[]>;

		/**
		 * Get context for a specific file or symbol
		 */
		export function getContext(uri: Uri, symbol?: string, token?: CancellationToken): Thenable<ExtensionContextItem | undefined>;

		/**
		 * Contribute context information (for extensions to add their own context)
		 */
		export function contributeContext(item: ExtensionContextItem): void;

		/**
		 * Get related context items (imports, calls, references, etc.)
		 */
		export function getRelatedContext(
			itemId: string,
			relationshipTypes?: string[],
			token?: CancellationToken
		): Thenable<ExtensionContextItem[]>;

		/**
		 * Register a context provider that extensions can contribute
		 */
		export function registerContextProvider(
			provider: ExtensionContextProvider
		): Disposable;
	}
}

