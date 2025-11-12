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
import { joinPath } from '../../../base/common/resources.js';
import { isString } from '../../../base/common/types.js';
import { FileChangesEvent, FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INativeEnvironmentService } from '../../../platform/environment/common/environment.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { AICompletionRequest, AIStreamRequest, IAIService } from '../common/aiService.js';
import { AIDiff, AICompletionChunk, AICompletionResponse, AIModelConfiguration, AIStreamHandle } from '../common/aiTypes.js';

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

	async requestCompletion(request: AICompletionRequest, _token: CancellationToken): Promise<AICompletionResponse> {
		throw new Error(`AIService requestCompletion not yet implemented for model '${request.modelId}'`);
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
				this.logService.info('[AIService] Model configuration not found; using empty registry.');
				this._models = [];
				this._activeModelId = undefined;
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

	private getConfigUri(): URI {
		return joinPath(this.environmentService.userHome, '.void', 'config.json');
	}
}


