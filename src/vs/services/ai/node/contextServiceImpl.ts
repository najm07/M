/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { joinPath } from '../../../base/common/resources.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IContextService, ContextSearchResult, ContextIndexEntry } from '../common/contextService.js';
import { IAiEmbeddingVectorService } from '../../../workbench/services/aiEmbeddingVector/common/aiEmbeddingVectorService.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { RunOnceScheduler } from '../../../base/common/async.js';

const CONTEXT_INDEX_STORAGE_KEY = 'workbench.ai.contextIndex';
const CONTEXT_INDEX_VERSION = 1;

interface IndexData {
	version: number;
	entries: Map<string, ContextIndexEntry>;
}

export class ContextService extends Disposable implements IContextService {
	declare _serviceBrand: undefined;

	private readonly _index: Map<string, ContextIndexEntry> = new Map();
	private readonly _indexPath: URI;
	private readonly _indexSaveScheduler: RunOnceScheduler;

	private readonly _onDidIndexFile = new Emitter<URI>();
	private readonly _onDidRemoveFile = new Emitter<URI>();

	public readonly onDidIndexFile: Event<URI> = this._onDidIndexFile.event;
	public readonly onDidRemoveFile: Event<URI> = this._onDidRemoveFile.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IAiEmbeddingVectorService private readonly embeddingService: IAiEmbeddingVectorService,
	) {
		super();

		// Store index in workspace storage for now (can be upgraded to file-based SQLite later)
		this._indexPath = joinPath(this.environmentService.userRoamingDataHome, '.vscode', 'context', 'index.json');

		this._indexSaveScheduler = this._register(new RunOnceScheduler(() => {
			void this.saveIndex();
		}, 2000)); // Debounce saves by 2 seconds

		void this.loadIndex();
	}

	override dispose(): void {
		// Save index before disposing
		this._indexSaveScheduler.schedule();
		this._onDidIndexFile.dispose();
		this._onDidRemoveFile.dispose();
		super.dispose();
	}

	async search(query: string, maxResults: number = 10, token?: CancellationToken): Promise<ContextSearchResult[]> {
		if (!this.embeddingService.isEnabled()) {
			this.logService.warn('[ContextService] Embedding service not enabled, falling back to text search');
			return this.textSearch(query, maxResults);
		}

		try {
			// Get embedding for query
			const queryEmbedding = await this.embeddingService.getEmbeddingVector(query, token || CancellationToken.None);

			// Calculate similarity scores
			const results: Array<ContextSearchResult & { score: number }> = [];

			for (const [uriStr, entry] of this._index.entries()) {
				if (token?.isCancellationRequested) {
					break;
				}

				if (!entry.embedding || entry.embedding.length === 0) {
					// Skip entries without embeddings
					continue;
				}

				const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
				if (score > 0.3) { // Threshold for relevance
					results.push({
						uri: URI.parse(uriStr),
						score,
						snippet: this.extractSnippet(entry.content, query),
						metadata: entry.metadata,
					});
				}
			}

			// Sort by score descending
			results.sort((a, b) => b.score - a.score);

			return results.slice(0, maxResults);
		} catch (error) {
			this.logService.error('[ContextService] Error during semantic search', error);
			return this.textSearch(query, maxResults);
		}
	}

	private textSearch(query: string, maxResults: number): ContextSearchResult[] {
		const queryLower = query.toLowerCase();
		const results: ContextSearchResult[] = [];

		for (const [uriStr, entry] of this._index.entries()) {
			const contentLower = entry.content.toLowerCase();
			if (contentLower.includes(queryLower)) {
				results.push({
					uri: URI.parse(uriStr),
					score: 0.5, // Default score for text matches
					snippet: this.extractSnippet(entry.content, query),
					metadata: entry.metadata,
				});
			}
		}

		return results.slice(0, maxResults);
	}

	private cosineSimilarity(vecA: number[], vecB: number[]): number {
		if (vecA.length !== vecB.length) {
			return 0;
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < vecA.length; i++) {
			dotProduct += vecA[i] * vecB[i];
			normA += vecA[i] * vecA[i];
			normB += vecB[i] * vecB[i];
		}

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	}

	private extractSnippet(content: string, query: string, maxLength: number = 200): string {
		const queryLower = query.toLowerCase();
		const contentLower = content.toLowerCase();
		const index = contentLower.indexOf(queryLower);

		if (index === -1) {
			// Return first part of content
			return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
		}

		const start = Math.max(0, index - 50);
		const end = Math.min(content.length, index + query.length + 50);
		let snippet = content.substring(start, end);

		if (start > 0) {
			snippet = '...' + snippet;
		}
		if (end < content.length) {
			snippet = snippet + '...';
		}

		return snippet;
	}

	async indexFile(uri: URI, content: string, token?: CancellationToken): Promise<void> {
		const uriStr = uri.toString();
		const now = Date.now();

		let embedding: number[] | undefined;
		if (this.embeddingService.isEnabled()) {
			try {
				embedding = await this.embeddingService.getEmbeddingVector(content, token || CancellationToken.None);
			} catch (error) {
				this.logService.warn(`[ContextService] Failed to generate embedding for ${uriStr}`, error);
			}
		}

		const entry: ContextIndexEntry = {
			uri,
			content,
			embedding,
			lastModified: now,
		};

		this._index.set(uriStr, entry);
		this._onDidIndexFile.fire(uri);
		this._indexSaveScheduler.schedule();
	}

	async removeFile(uri: URI): Promise<void> {
		const uriStr = uri.toString();
		if (this._index.delete(uriStr)) {
			this._onDidRemoveFile.fire(uri);
			this._indexSaveScheduler.schedule();
		}
	}

	async getIndexedFiles(): Promise<URI[]> {
		return Array.from(this._index.values()).map(entry => entry.uri);
	}

	async isIndexed(uri: URI): Promise<boolean> {
		return this._index.has(uri.toString());
	}

	async clearIndex(): Promise<void> {
		this._index.clear();
		await this.saveIndex();
	}

	async rebuildIndex(workspaceRoot: URI, token?: CancellationToken): Promise<void> {
		this.logService.info('[ContextService] Rebuilding index for workspace', workspaceRoot.toString());

		// Clear existing index
		this._index.clear();

		// Find all code files in workspace
		try {
			const files = await this.fileService.resolve(workspaceRoot);
			if (files.children) {
				await this.indexDirectory(files.children, token);
			}
		} catch (error) {
			this.logService.error('[ContextService] Error rebuilding index', error);
		}

		await this.saveIndex();
	}

	private async indexDirectory(children: Array<{ resource: URI; isDirectory: boolean }>, token?: CancellationToken): Promise<void> {
		for (const child of children) {
			if (token?.isCancellationRequested) {
				break;
			}

			if (child.isDirectory) {
				try {
					const dir = await this.fileService.resolve(child.resource);
					if (dir.children) {
						await this.indexDirectory(dir.children, token);
					}
				} catch (error) {
					// Skip directories we can't read
				}
			} else if (this.shouldIndexFile(child.resource)) {
				try {
					const content = await this.fileService.readFile(child.resource);
					await this.indexFile(child.resource, content.value.toString(), token);
				} catch (error) {
					this.logService.debug(`[ContextService] Failed to index ${child.resource.toString()}`, error);
				}
			}
		}
	}

	private shouldIndexFile(uri: URI): boolean {
		const path = uri.path.toLowerCase();
		const excludePatterns = [
			'node_modules',
			'.git',
			'out',
			'dist',
			'build',
			'.vscode',
			'package-lock.json',
			'yarn.lock',
		];

		if (excludePatterns.some(pattern => path.includes(pattern))) {
			return false;
		}

		// Index common code file extensions
		const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.rb', '.php'];
		return codeExtensions.some(ext => path.endsWith(ext));
	}

	private async loadIndex(): Promise<void> {
		try {
			// Try loading from file first
			if (await this.fileService.exists(this._indexPath)) {
				const content = await this.fileService.readFile(this._indexPath);
				const data: IndexData = JSON.parse(content.value.toString());

				if (data.version === CONTEXT_INDEX_VERSION && data.entries) {
					// Convert entries object back to Map
					for (const [uriStr, entry] of Object.entries(data.entries)) {
						this._index.set(uriStr, {
							...entry,
							uri: typeof entry.uri === 'string' ? URI.parse(entry.uri) : URI.revive(entry.uri as any),
						});
					}
					this.logService.info(`[ContextService] Loaded ${this._index.size} indexed files`);
					return;
				}
			}
		} catch (error) {
			this.logService.warn('[ContextService] Failed to load index from file, starting fresh', error);
		}

		// Fallback to storage service
		try {
			const stored = this.storageService.get(CONTEXT_INDEX_STORAGE_KEY, StorageScope.WORKSPACE, '');
			if (stored) {
				const data: IndexData = JSON.parse(stored);
				if (data.version === CONTEXT_INDEX_VERSION && data.entries) {
					for (const [uriStr, entry] of Object.entries(data.entries)) {
						this._index.set(uriStr, {
							...entry,
							uri: typeof entry.uri === 'string' ? URI.parse(entry.uri) : URI.revive(entry.uri as any),
						});
					}
					this.logService.info(`[ContextService] Loaded ${this._index.size} indexed files from storage`);
				}
			}
		} catch (error) {
			this.logService.warn('[ContextService] Failed to load index from storage', error);
		}
	}

	private async saveIndex(): Promise<void> {
		// Convert Map to object for serialization
		const entries: Record<string, any> = {};
		for (const [uriStr, entry] of this._index.entries()) {
			entries[uriStr] = {
				...entry,
				uri: entry.uri.toJSON(), // Serialize URI using toJSON()
			};
		}

		const data: IndexData = {
			version: CONTEXT_INDEX_VERSION,
			entries: entries as any,
		};

		try {
			// Ensure directory exists
			const dir = joinPath(this._indexPath, '..');
			if (!(await this.fileService.exists(dir))) {
				await this.fileService.createFolder(dir);
			}

			// Save to file
			const content = JSON.stringify(data, null, 2);
			await this.fileService.writeFile(this._indexPath, VSBuffer.fromString(content));
		} catch (error) {
			this.logService.warn('[ContextService] Failed to save index to file, using storage fallback', error);

			// Fallback to storage service
			try {
				this.storageService.store(CONTEXT_INDEX_STORAGE_KEY, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			} catch (storageError) {
				this.logService.error('[ContextService] Failed to save index to storage', storageError);
			}
		}
	}
}

