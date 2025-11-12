/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import { IRange } from '../../../editor/common/core/range.js';

export const IContextService = createDecorator<IContextService>('aiContextService');

export interface ContextSearchResult {
	readonly uri: URI;
	readonly score: number;
	readonly snippet: string;
	readonly range?: IRange;
	readonly metadata?: Record<string, unknown>;
}

export interface ContextIndexEntry {
	readonly uri: URI;
	readonly content: string;
	readonly embedding?: number[];
	readonly lastModified: number;
	readonly metadata?: Record<string, unknown>;
}

export interface IContextService {
	readonly _serviceBrand: undefined;

	readonly onDidIndexFile: Event<URI>;
	readonly onDidRemoveFile: Event<URI>;

	/**
	 * Search for files and snippets matching the query using semantic similarity.
	 */
	search(query: string, maxResults?: number, token?: CancellationToken): Promise<ContextSearchResult[]>;

	/**
	 * Index a file's content for context search.
	 */
	indexFile(uri: URI, content: string, token?: CancellationToken): Promise<void>;

	/**
	 * Remove a file from the index.
	 */
	removeFile(uri: URI): Promise<void>;

	/**
	 * Get all indexed files.
	 */
	getIndexedFiles(): Promise<URI[]>;

	/**
	 * Check if a file is indexed.
	 */
	isIndexed(uri: URI): Promise<boolean>;

	/**
	 * Clear the entire index.
	 */
	clearIndex(): Promise<void>;

	/**
	 * Rebuild the index for a workspace.
	 */
	rebuildIndex(workspaceRoot: URI, token?: CancellationToken): Promise<void>;
}

