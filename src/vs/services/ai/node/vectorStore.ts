/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { joinPath } from '../../../base/common/resources.js';
// import { ContextIndexEntry } from '../common/contextService.js';

export interface VectorStoreEntry {
	uri: string;
	content: string;
	embedding: number[];
	lastModified: number;
	metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
	uri: URI;
	score: number;
	snippet: string;
	metadata?: Record<string, unknown>;
}

/**
 * SQLite-based vector store for efficient semantic search
 * Uses SQLite with custom vector similarity functions
 */
export class VectorStore {
	private db: any; // SQLite3 Database
	private readonly dbPath: URI;
	private initialized = false;

	constructor(
		dbName: string,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		this.dbPath = joinPath(this.environmentService.userRoamingDataHome, '.vscode', 'context', `${dbName}.db`);
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		try {
			// Ensure directory exists first
			const dir = joinPath(this.dbPath, '..');
			try {
				await this.fileService.createFolder(dir);
			} catch {
				// Directory might already exist, ignore
			}

			const sqlite3 = await import('@vscode/sqlite3');
			const Database = sqlite3.default.verbose().Database;

			return new Promise((resolve, reject) => {
				const dbPath = this.dbPath.fsPath;

				this.db = new Database(dbPath, (err: Error | null) => {
					if (err) {
						this.logService.error('[VectorStore] Failed to open database', err);
						reject(err);
						return;
					}

					this.setupDatabase()
						.then(() => {
							this.initialized = true;
							this.logService.info('[VectorStore] Database initialized');
							resolve();
						})
						.catch(reject);
				});

				this.db.on('error', (err: Error) => {
					this.logService.error('[VectorStore] Database error', err);
				});
			});
		} catch (error) {
			this.logService.error('[VectorStore] Failed to import sqlite3', error);
			throw new Error('SQLite3 not available. Vector store requires @vscode/sqlite3 package.');
		}
	}

	private async setupDatabase(): Promise<void> {
		return new Promise((resolve, reject) => {
			const sql = `
				CREATE TABLE IF NOT EXISTS vectors (
					uri TEXT PRIMARY KEY,
					content TEXT NOT NULL,
					embedding BLOB NOT NULL,
					last_modified INTEGER NOT NULL,
					metadata TEXT,
					content_fts TEXT
				);

				CREATE INDEX IF NOT EXISTS idx_last_modified ON vectors(last_modified);

				-- FTS5 virtual table for full-text search fallback
				CREATE VIRTUAL TABLE IF NOT EXISTS vectors_fts USING fts5(
					uri,
					content,
					content_tokenize='porter'
				);
			`;

			this.db.exec(sql, (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	async upsert(entry: VectorStoreEntry): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			// Serialize embedding array to BLOB
			const embeddingBuffer = Buffer.from(new Float32Array(entry.embedding).buffer);
			const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null;

			// Extract first 1000 chars for FTS (FTS5 has limits)
			const contentFts = entry.content.substring(0, 1000);

			const sql = `
				INSERT OR REPLACE INTO vectors (uri, content, embedding, last_modified, metadata, content_fts)
				VALUES (?, ?, ?, ?, ?, ?)
			`;

			this.db.run(sql, [
				entry.uri,
				entry.content,
				embeddingBuffer,
				entry.lastModified,
				metadataJson,
				contentFts
			], (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					// Update FTS table
					this.db.run(
						'INSERT OR REPLACE INTO vectors_fts (uri, content) VALUES (?, ?)',
						[entry.uri, contentFts],
						() => resolve()
					);
				}
			});
		});
	}

	async search(queryEmbedding: number[], maxResults: number = 10, minScore: number = 0.3): Promise<VectorSearchResult[]> {
		if (!this.initialized) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			const sql = 'SELECT uri, content, embedding, metadata FROM vectors';

			this.db.all(sql, [], (err: Error | null, rows: any[]) => {
				if (err) {
					reject(err);
					return;
				}

				const results: Array<VectorSearchResult & { score: number }> = [];

				for (const row of rows) {
					// Deserialize embedding from BLOB
					const buffer = Buffer.from(row.embedding);
					const embedding = Array.from(new Float32Array(buffer.buffer, 0, buffer.length / 4));

					const score = this.cosineSimilarity(queryEmbedding, embedding);
					if (score >= minScore) {
						const metadata = row.metadata ? JSON.parse(row.metadata) : undefined;
						results.push({
							uri: URI.parse(row.uri),
							score,
							snippet: this.extractSnippet(row.content, 200),
							metadata,
						});
					}
				}

				// Sort by score descending
				results.sort((a, b) => b.score - a.score);

				resolve(results.slice(0, maxResults));
			});
		});
	}

	async textSearch(query: string, maxResults: number = 10): Promise<VectorSearchResult[]> {
		if (!this.initialized) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			// Use FTS5 for text search
			const sql = `
				SELECT v.uri, v.content, v.metadata, rank
				FROM vectors_fts fts
				JOIN vectors v ON fts.uri = v.uri
				WHERE vectors_fts MATCH ?
				ORDER BY rank
				LIMIT ?
			`;

			this.db.all(sql, [query, maxResults], (err: Error | null, rows: any[]) => {
				if (err) {
					reject(err);
					return;
				}

				const results: VectorSearchResult[] = rows.map(row => ({
					uri: URI.parse(row.uri),
					score: 0.5, // Default score for text matches
					snippet: this.extractSnippet(row.content, query, 200),
					metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
				}));

				resolve(results);
			});
		});
	}

	async delete(uri: string): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			this.db.run('DELETE FROM vectors WHERE uri = ?', [uri], (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					// Also delete from FTS table
					this.db.run('DELETE FROM vectors_fts WHERE uri = ?', [uri], () => resolve());
				}
			});
		});
	}

	async clear(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			this.db.exec('DELETE FROM vectors; DELETE FROM vectors_fts;', (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	async getCount(): Promise<number> {
		if (!this.initialized) {
			await this.initialize();
		}

		return new Promise((resolve, reject) => {
			this.db.get('SELECT COUNT(*) as count FROM vectors', [], (err: Error | null, row: any) => {
				if (err) {
					reject(err);
				} else {
					resolve(row?.count || 0);
				}
			});
		});
	}

	async close(): Promise<void> {
		if (!this.db) {
			return;
		}

		return new Promise((resolve, reject) => {
			this.db.close((err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					this.initialized = false;
					resolve();
				}
			});
		});
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

	private extractSnippet(content: string, queryOrLength: string | number, maxLength?: number): string {
		if (typeof queryOrLength === 'number') {
			maxLength = queryOrLength;
			return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
		}

		const query = queryOrLength.toLowerCase();
		const contentLower = content.toLowerCase();
		const index = contentLower.indexOf(query);

		if (index === -1) {
			return content.substring(0, maxLength || 200) + (content.length > (maxLength || 200) ? '...' : '');
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
}

