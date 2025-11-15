/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { IExtensionBridgeService, ExtensionContextItem, ExtensionContextQuery, ExtensionContextProvider } from '../common/extensionBridge.js';
import { IContextService } from '../common/contextService.js';
import { IProjectGraphService } from '../common/projectGraphService.js';
import { ILogService } from '../../../platform/log/common/log.js';

export class ExtensionBridgeService extends Disposable implements IExtensionBridgeService {
	declare _serviceBrand: undefined;

	private readonly providers = new Map<string, ExtensionContextProvider>();
	private readonly contributedContext = new Map<string, ExtensionContextItem>();
	private readonly subscriptions = new Map<string, Set<(items: ExtensionContextItem[]) => void>>();

	private readonly _onDidContextUpdate = new Emitter<ExtensionContextItem>();
	public readonly onDidContextUpdate: Event<ExtensionContextItem> = this._onDidContextUpdate.event;

	constructor(
		@IContextService private readonly contextService: IContextService,
		@IProjectGraphService private readonly projectGraphService: IProjectGraphService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	registerContextProvider(extensionId: string, provider: ExtensionContextProvider): void {
		if (this.providers.has(extensionId)) {
			this.logService.warn(`[ExtensionBridge] Provider already registered for ${extensionId}, replacing`);
		}
		this.providers.set(extensionId, provider);
		this.logService.info(`[ExtensionBridge] Registered context provider: ${extensionId}`);
	}

	unregisterContextProvider(extensionId: string): void {
		if (this.providers.delete(extensionId)) {
			this.logService.info(`[ExtensionBridge] Unregistered context provider: ${extensionId}`);
		}
	}

	async queryContext(query: ExtensionContextQuery, token?: CancellationToken): Promise<ExtensionContextItem[]> {
		const results: ExtensionContextItem[] = [];

		// Query built-in context service (semantic search)
		try {
			const contextResults = await this.contextService.search(query.query, query.maxResults || 10, token);
			for (const result of contextResults) {
				results.push({
					id: result.uri.toString(),
					type: 'file',
					uri: result.uri,
					content: result.snippet,
					metadata: result.metadata,
				});
			}
		} catch (error) {
			this.logService.warn('[ExtensionBridge] Context service query failed', error);
		}

		// Query extension providers
		for (const [extensionId, provider] of this.providers.entries()) {
			if (token?.isCancellationRequested) {
				break;
			}

			try {
				const providerResults = await provider.provideContext(query, token || CancellationToken.None);
				results.push(...providerResults);
			} catch (error) {
				this.logService.warn(`[ExtensionBridge] Provider ${extensionId} query failed`, error);
			}
		}

		// Filter by query filters
		if (query.filters) {
			return results.filter(item => {
				if (query.filters!.languageIds && item.uri) {
					// Simple language ID matching (could be improved)
					if (!query.filters!.languageIds.some(lid => item.uri!.path.endsWith(`.${lid}`))) {
						return false;
					}
				}

				if (query.filters!.filePatterns) {
					const matches = query.filters!.filePatterns.some(pattern => {
						const regex = new RegExp(pattern.replace(/\*/g, '.*'));
						return item.uri && regex.test(item.uri.path);
					});
					if (!matches) {
						return false;
					}
				}

				return true;
			});
		}

		return results;
	}

	async getContext(uri: URI, symbol?: string, token?: CancellationToken): Promise<ExtensionContextItem | undefined> {
		// Try extension providers first
		for (const [extensionId, provider] of this.providers.entries()) {
			if (provider.getContext) {
				try {
					const result = await provider.getContext(uri, symbol, token || CancellationToken.None);
					if (result) {
						return result;
					}
				} catch (error) {
					this.logService.debug(`[ExtensionBridge] Provider ${extensionId} getContext failed`, error);
				}
			}
		}

		// Fallback to project graph service
		if (symbol) {
			try {
				const related = await this.projectGraphService.getRelatedNodes(uri, symbol, 1);
				if (related.length > 0) {
					const node = related[0];
					return {
						id: `${uri.toString()}#${symbol}`,
						type: 'symbol',
						uri: node.uri,
						range: node.range,
						metadata: node.metadata,
					};
				}
			} catch (error) {
				this.logService.debug('[ExtensionBridge] Project graph query failed', error);
			}
		}

		// Check contributed context
		const contributed = this.contributedContext.get(uri.toString());
		if (contributed) {
			return contributed;
		}

		return undefined;
	}

	contributeContext(item: ExtensionContextItem): void {
		const id = item.id || (item.uri ? item.uri.toString() : `contributed-${Date.now()}`);
		const contextItem: ExtensionContextItem = {
			...item,
			id,
		};

		this.contributedContext.set(id, contextItem);
		this._onDidContextUpdate.fire(contextItem);

		// Notify subscribers
		const subscribers = this.subscriptions.get(id);
		if (subscribers) {
			subscribers.forEach(callback => callback([contextItem]));
		}

		this.logService.debug(`[ExtensionBridge] Context contributed: ${id}`);
	}

	async getRelatedContext(
		itemId: string,
		relationshipTypes: string[] = ['imports', 'calls', 'references'],
		token?: CancellationToken
	): Promise<ExtensionContextItem[]> {
		const results: ExtensionContextItem[] = [];

		// Get from contributed context
		const item = this.contributedContext.get(itemId);
		if (item?.relationships) {
			for (const rel of item.relationships) {
				if (relationshipTypes.includes(rel.type)) {
					const related = this.contributedContext.get(rel.target);
					if (related) {
						results.push(related);
					}
				}
			}
		}

		// Query extension providers
		for (const [extensionId, provider] of this.providers.entries()) {
			if (provider.getRelated) {
				try {
					const providerResults = await provider.getRelated(itemId, relationshipTypes, token || CancellationToken.None);
					results.push(...providerResults);
				} catch (error) {
					this.logService.debug(`[ExtensionBridge] Provider ${extensionId} getRelated failed`, error);
				}
			}
		}

		// Query project graph if item has URI
		if (item?.uri) {
			try {
				const related = await this.projectGraphService.getRelatedNodes(item.uri, undefined, 2);
				for (const node of related) {
					results.push({
						id: node.uri.toString(),
						type: 'file',
						uri: node.uri,
						metadata: node.metadata,
					});
				}
			} catch (error) {
				this.logService.debug('[ExtensionBridge] Project graph getRelated failed', error);
			}
		}

		return results;
	}

	subscribeToContext(
		itemIds: string[],
		callback: (items: ExtensionContextItem[]) => void
	): IDisposable {
		for (const itemId of itemIds) {
			if (!this.subscriptions.has(itemId)) {
				this.subscriptions.set(itemId, new Set());
			}
			this.subscriptions.get(itemId)!.add(callback);
		}

		return {
			dispose: () => {
				for (const itemId of itemIds) {
					const subscribers = this.subscriptions.get(itemId);
					if (subscribers) {
						subscribers.delete(callback);
						if (subscribers.size === 0) {
							this.subscriptions.delete(itemId);
						}
					}
				}
			},
		};
	}
}

