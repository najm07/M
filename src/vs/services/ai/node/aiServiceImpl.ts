/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { joinPath, dirname } from '../../../base/common/resources.js';
import { isString } from '../../../base/common/types.js';
import { FileChangesEvent, FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INativeEnvironmentService } from '../../../platform/environment/common/environment.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { AICompletionRequest, AIStreamRequest, IAIService } from '../common/aiService.js';
import { AIDiff, AICompletionChunk, AICompletionResponse, AIModelConfiguration, AIStreamHandle } from '../common/aiTypes.js';
import { OllamaAdapter } from './ollamaAdapter.js';
import { CloudAIAdapter } from './cloudAIAdapter.js';

const MODEL_CONFIG_STORAGE_KEY = 'workbench.ai.activeModelId';

class NotImplementedStreamHandle extends AsyncIterableObject<AICompletionChunk> implements AIStreamHandle {
	constructor(public readonly requestId: string) {
		super(() => {
			// Not implemented - do nothing
		});
	}

	override [Symbol.asyncIterator](): AsyncIterator<AICompletionChunk> {
		throw new Error('AI streaming is not yet implemented');
	}

	cancel(): void {
		// no-op
	}
}

export class AIService extends Disposable implements IAIService {
	declare _serviceBrand: undefined;

	private readonly _configWatchDisposable = this._register(new MutableDisposable<IDisposable>());
	private readonly _configListener = this._register(new MutableDisposable<IDisposable>());
	private _models: AIModelConfiguration[] = [];
	private _activeModelId: string | undefined;
	private readonly _adapters = new Map<string, OllamaAdapter | CloudAIAdapter>();

	private readonly _onDidChangeActiveModel = new Emitter<string>();
	private readonly _onDidUpdateModelRegistry = new Emitter<void>();

	public readonly onDidChangeActiveModel: Event<string> = this._onDidChangeActiveModel.event;
	public readonly onDidUpdateModelRegistry: Event<void> = this._onDidUpdateModelRegistry.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.restoreActiveModel();
		void this.reloadModelConfiguration();
	}

	override dispose(): void {
		super.dispose();
		this._onDidChangeActiveModel.dispose();
		this._onDidUpdateModelRegistry.dispose();
	}

	async requestCompletion(request: AICompletionRequest, token: CancellationToken): Promise<AICompletionResponse> {
		const model = this._models.find(m => m.id === request.modelId);
		if (!model) {
			throw new Error(`Unknown AI model '${request.modelId}'`);
		}

		// Get or create adapter for this model
		let adapter = this._adapters.get(request.modelId);
		if (!adapter) {
			adapter = this.createAdapter(model);
			if (adapter) {
				this._adapters.set(request.modelId, adapter);
			}
		}

		if (!adapter) {
			throw new Error(`No adapter available for model '${request.modelId}'`);
		}

		// Try local first (Ollama), then fallback to cloud
		if (adapter instanceof OllamaAdapter) {
			try {
				// Check if Ollama is available
				const isHealthy = await adapter.healthCheck(token);
				if (isHealthy) {
					this.logService.debug(`[AIService] Using local Ollama model: ${request.modelId}`);
					return await adapter.generate(request, token);
				} else {
					this.logService.warn(`[AIService] Ollama not available, falling back to cloud for model: ${request.modelId}`);
					// Try to find a cloud fallback
					const cloudModel = this.findCloudFallback(model);
					if (cloudModel) {
						this.logService.info(`[AIService] Falling back to cloud model: ${cloudModel.id}`);
						const cloudAdapter = this.createAdapter(cloudModel);
						if (cloudAdapter && cloudAdapter instanceof CloudAIAdapter) {
							return await cloudAdapter.generate({ ...request, modelId: cloudModel.id }, token);
						}
					}
				}
			} catch (error) {
				this.logService.warn(`[AIService] Ollama request failed, falling back to cloud: ${error instanceof Error ? error.message : String(error)}`);
				// Try to find a cloud fallback
				const cloudModel = this.findCloudFallback(model);
				if (cloudModel) {
					this.logService.info(`[AIService] Falling back to cloud model: ${cloudModel.id}`);
					const cloudAdapter = this.createAdapter(cloudModel);
					if (cloudAdapter && cloudAdapter instanceof CloudAIAdapter) {
						return await cloudAdapter.generate({ ...request, modelId: cloudModel.id }, token);
					}
				}
			}
		}

		// Use cloud adapter directly if it's a cloud model
		if (adapter instanceof CloudAIAdapter) {
			this.logService.debug(`[AIService] Using cloud AI model: ${request.modelId}`);
			return await adapter.generate(request, token);
		}

		throw new Error(`Failed to generate completion for model '${request.modelId}'`);
	}

	private createAdapter(config: AIModelConfiguration): OllamaAdapter | CloudAIAdapter | undefined {
		if (OllamaAdapter.canHandle(config)) {
			return new OllamaAdapter(config, this.logService);
		} else if (CloudAIAdapter.canHandle(config)) {
			return new CloudAIAdapter(config, this.logService);
		}
		return undefined;
	}

	private findCloudFallback(localModel: AIModelConfiguration): AIModelConfiguration | undefined {
		// Try to find a cloud model with similar name or same family preference
		// For now, just return the first cloud model as fallback
		return this._models.find(m => {
			if (m.id === localModel.id) {
				return false;
			}
			const family = m.family?.toLowerCase();
			return family === 'openai' || family === 'anthropic';
		});
	}

	streamResponse(request: AIStreamRequest, _token: CancellationToken): AIStreamHandle {
		return new NotImplementedStreamHandle(`not-implemented:${request.modelId}`);
	}

	async applyDiff(_diff: AIDiff, _token: CancellationToken): Promise<void> {
		throw new Error('AIService applyDiff not yet implemented');
	}

	getModels(): ReadonlyArray<AIModelConfiguration> {
		return this._models;
	}

	getActiveModel(): string | undefined {
		return this._activeModelId;
	}

	async setActiveModel(modelId: string): Promise<void> {
		if (this._activeModelId === modelId) {
			return;
		}

		const modelExists = this._models.some(model => model.id === modelId);
		if (!modelExists) {
			throw new Error(`Unknown AI model '${modelId}'`);
		}

		this._activeModelId = modelId;
		this.storageService.store(MODEL_CONFIG_STORAGE_KEY, modelId, StorageScope.PROFILE, StorageTarget.USER);
		this._onDidChangeActiveModel.fire(modelId);
	}

	async reloadModelConfiguration(): Promise<void> {
		const configUri = this.getConfigUri();

		try {
			const file = await this.fileService.readFile(configUri);
			const parsed = this.parseConfig(file.value);
			this._models = parsed;

			// Clear old adapters and create new ones
			this._adapters.clear();
			for (const model of this._models) {
				const adapter = this.createAdapter(model);
				if (adapter) {
					this._adapters.set(model.id, adapter);
				}
			}

			if (this._models.length > 0) {
				const active = this._activeModelId && this._models.some(model => model.id === this._activeModelId)
					? this._activeModelId
					: this._models.find(model => model.isDefault)?.id ?? this._models[0].id;

				if (active !== this._activeModelId) {
					this._activeModelId = active;
					if (active) {
						this.storageService.store(MODEL_CONFIG_STORAGE_KEY, active, StorageScope.PROFILE, StorageTarget.USER);
						this._onDidChangeActiveModel.fire(active);
					}
				}
			} else {
				this._activeModelId = undefined;
			}

			this.registerConfigWatcher(configUri);
			this._onDidUpdateModelRegistry.fire();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				// Create default config file automatically
				try {
					await this.createDefaultConfig(configUri);
					// Try to reload again after creating default config
					try {
						const file = await this.fileService.readFile(configUri);
						const parsed = this.parseConfig(file.value);
						this._models = parsed;

						// Clear old adapters and create new ones
						this._adapters.clear();
						for (const model of this._models) {
							const adapter = this.createAdapter(model);
							if (adapter) {
								this._adapters.set(model.id, adapter);
							}
						}

						if (this._models.length > 0) {
							const active = this._activeModelId && this._models.some(model => model.id === this._activeModelId)
								? this._activeModelId
								: this._models.find(model => model.isDefault)?.id ?? this._models[0].id;

							if (active !== this._activeModelId) {
								this._activeModelId = active;
								if (active) {
									this.storageService.store(MODEL_CONFIG_STORAGE_KEY, active, StorageScope.PROFILE, StorageTarget.USER);
									this._onDidChangeActiveModel.fire(active);
								}
							}
						} else {
							this._activeModelId = undefined;
						}

						this.logService.info('[AIService] Created default configuration file at ' + configUri.toString());
					} catch (reloadError) {
						this.logService.warn('[AIService] Failed to reload configuration after creating default file', reloadError);
						this._models = [];
						this._activeModelId = undefined;
						this._adapters.clear();
					}
				} catch (createError) {
					this.logService.warn('[AIService] Failed to create default configuration file', createError);
					this.logService.info('[AIService] Model configuration not found; using empty registry.');
					this._models = [];
					this._activeModelId = undefined;
					this._adapters.clear();
				}
				this.registerConfigWatcher(configUri);
				this._onDidUpdateModelRegistry.fire();
				return;
			}

			this.logService.error('[AIService] Failed to load model configuration', error);
			throw error;
		}
	}

	private parseConfig(buffer: VSBuffer): AIModelConfiguration[] {
		try {
			const raw = JSON.parse(buffer.toString());
			const models = raw?.models;
			if (!models || typeof models !== 'object') {
				return [];
			}

			const result: AIModelConfiguration[] = [];
			for (const [id, value] of Object.entries(models)) {
				if (!value || typeof value !== 'object') {
					continue;
				}

				const api = isString((value as any).api) ? URI.parse((value as any).api) : undefined;
				if (!api) {
					continue;
				}

				const configuration: AIModelConfiguration = {
					id,
					api,
					apiKey: isString((value as any).key) ? (value as any).key : undefined,
					family: isString((value as any).family) ? (value as any).family : undefined,
					isDefault: Boolean((value as any).default),
					metadata: typeof (value as any).metadata === 'object' ? (value as any).metadata : undefined,
				};
				result.push(configuration);
			}

			return result;
		} catch (error) {
			this.logService.warn('[AIService] Unable to parse model configuration file', error);
			return [];
		}
	}

	private registerConfigWatcher(configUri: URI): void {
		this._configWatchDisposable.clear();
		this._configListener.clear();

		try {
			this._configWatchDisposable.value = this.fileService.watch(configUri);
		} catch (error) {
			this.logService.debug('[AIService] failed to watch model configuration', error);
		}

		const listener = this.fileService.onDidFilesChange(async (e: FileChangesEvent) => {
			if (e.contains(configUri)) {
				try {
					await this.reloadModelConfiguration();
				} catch (reloadError) {
					this.logService.error('[AIService] Failed to reload configuration after change', reloadError);
				}
			}
		});
		this._configListener.value = listener;
	}

	private restoreActiveModel(): void {
		const stored = this.storageService.get(MODEL_CONFIG_STORAGE_KEY, StorageScope.PROFILE, undefined);
		if (stored) {
			this._activeModelId = stored;
		}
	}

	getConfigUri(): URI {
		return joinPath(this.environmentService.userHome, '.void', 'config.json');
	}

	async addModel(model: Omit<AIModelConfiguration, 'api'> & { api: string }): Promise<void> {
		const configUri = this.getConfigUri();

		// Read current config
		let config: any;
		try {
			const file = await this.fileService.readFile(configUri);
			config = JSON.parse(file.value.toString());
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await this.createDefaultConfig(configUri);
				config = { models: {} };
			} else {
				throw error;
			}
		}

		if (!config.models) {
			config.models = {};
		}

		// Add new model
		config.models[model.id] = {
			api: model.api,
			key: model.apiKey,
			family: model.family,
			default: model.isDefault,
			metadata: model.metadata,
		};

		// Write back
		await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(config, null, 2)));

		// Reload configuration
		await this.reloadModelConfiguration();
	}

	async removeModel(modelId: string): Promise<void> {
		const configUri = this.getConfigUri();

		// Read current config
		const file = await this.fileService.readFile(configUri);
		const config = JSON.parse(file.value.toString());

		if (!config.models || !config.models[modelId]) {
			throw new Error(`Model '${modelId}' not found`);
		}

		// Remove model
		delete config.models[modelId];

		// If this was the active model, clear it
		if (this._activeModelId === modelId) {
			this._activeModelId = undefined;
			this.storageService.remove(MODEL_CONFIG_STORAGE_KEY, StorageScope.PROFILE);
		}

		// Write back
		await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(config, null, 2)));

		// Reload configuration
		await this.reloadModelConfiguration();
	}

	async updateModel(modelId: string, updates: Partial<Omit<AIModelConfiguration, 'id' | 'api'> & { api?: string }>): Promise<void> {
		const configUri = this.getConfigUri();

		// Read current config
		const file = await this.fileService.readFile(configUri);
		const config = JSON.parse(file.value.toString());

		if (!config.models || !config.models[modelId]) {
			throw new Error(`Model '${modelId}' not found`);
		}

		// Update model
		const model = config.models[modelId];
		if (updates.api !== undefined) {
			model.api = updates.api;
		}
		if (updates.apiKey !== undefined) {
			model.key = updates.apiKey;
		}
		if (updates.family !== undefined) {
			model.family = updates.family;
		}
		if (updates.isDefault !== undefined) {
			model.default = updates.isDefault;
		}
		if (updates.metadata !== undefined) {
			model.metadata = updates.metadata;
		}

		// Write back
		await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(config, null, 2)));

		// Reload configuration
		await this.reloadModelConfiguration();
	}

	private async createDefaultConfig(configUri: URI): Promise<void> {
		try {
			// Ensure directory exists
			const dirUri = dirname(configUri);
			if (!(await this.fileService.exists(dirUri))) {
				await this.fileService.createFolder(dirUri);
			}

			// Create default config with helpful template
			// Note: JSON doesn't support comments, so we create a minimal valid structure
			// Users can add their models following the examples in the documentation
			const defaultConfig = {
				models: {}
			};

			await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(defaultConfig, null, 2)));
		} catch (error) {
			this.logService.warn('[AIService] Failed to create default configuration file', error);
			throw error;
		}
	}
}


