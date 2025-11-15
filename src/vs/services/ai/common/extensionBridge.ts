/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import { IRange } from '../../../editor/common/core/range.js';

export const IExtensionBridgeService = createDecorator<IExtensionBridgeService>('extensionBridgeService');

/**
 * Context information that extensions can contribute or consume
 */
export interface ExtensionContextItem {
	readonly id: string;
	readonly type: 'file' | 'symbol' | 'relationship' | 'metadata';
	readonly uri?: URI;
	readonly range?: IRange;
	readonly content?: string;
	readonly metadata?: Record<string, unknown>;
	readonly relationships?: ExtensionContextRelationship[];
}

export interface ExtensionContextRelationship {
	readonly target: string; // ID of related context item
	readonly type: 'imports' | 'calls' | 'references' | 'depends' | 'custom';
	readonly metadata?: Record<string, unknown>;
}

/**
 * Context query for extensions to search the codebase
 */
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

/**
 * Extension Bridge Service - SDK for extensions to interact with AI context system
 */
export interface IExtensionBridgeService {
	readonly _serviceBrand: undefined;

	readonly onDidContextUpdate: Event<ExtensionContextItem>;

	/**
	 * Register a context provider that extensions can contribute
	 */
	registerContextProvider(
		extensionId: string,
		provider: ExtensionContextProvider
	): void;

	/**
	 * Unregister a context provider
	 */
	unregisterContextProvider(extensionId: string): void;

	/**
	 * Query the context system (semantic search + extension contributions)
	 */
	queryContext(query: ExtensionContextQuery, token?: CancellationToken): Promise<ExtensionContextItem[]>;

	/**
	 * Get context for a specific file or symbol
	 */
	getContext(uri: URI, symbol?: string, token?: CancellationToken): Promise<ExtensionContextItem | undefined>;

	/**
	 * Contribute context information (for extensions to add their own context)
	 */
	contributeContext(item: ExtensionContextItem): void;

	/**
	 * Get related context items (imports, calls, references, etc.)
	 */
	getRelatedContext(
		itemId: string,
		relationshipTypes?: string[],
		token?: CancellationToken
	): Promise<ExtensionContextItem[]>;

	/**
	 * Subscribe to context updates for specific items
	 */
	subscribeToContext(
		itemIds: string[],
		callback: (items: ExtensionContextItem[]) => void
	): { dispose(): void };
}

export interface ExtensionContextProvider {
	/**
	 * Provide context items for a query
	 */
	provideContext(query: ExtensionContextQuery, token: CancellationToken): Promise<ExtensionContextItem[]>;

	/**
	 * Get context for a specific URI/symbol
	 */
	getContext?(uri: URI, symbol?: string, token?: CancellationToken): Promise<ExtensionContextItem | undefined>;

	/**
	 * Get related items
	 */
	getRelated?(itemId: string, relationshipTypes: string[], token: CancellationToken): Promise<ExtensionContextItem[]>;
}

