/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { AIDiff, AICompletionResponse, AIModelConfiguration, AIStreamHandle, EditorContext } from './aiTypes.js';

// Re-export for convenience
export type { AICompletionResponse } from './aiTypes.js';

export const IAIService = createDecorator<IAIService>('aiService');

export interface AICompletionRequest {
	readonly context: EditorContext;
	readonly modelId: string;
	readonly prompt?: string;
	readonly supplementalContext?: ReadonlyArray<string>;
	readonly maxOutputTokens?: number;
	readonly temperature?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface AIStreamRequest extends AICompletionRequest {
	readonly stream: true;
}

export interface IAIService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeActiveModel: Event<string>;
	readonly onDidUpdateModelRegistry: Event<void>;

	requestCompletion(request: AICompletionRequest, token: CancellationToken): Promise<AICompletionResponse>;
	streamResponse(request: AIStreamRequest, token: CancellationToken): AIStreamHandle;

	applyDiff(diff: AIDiff, token: CancellationToken): Promise<void>;

	getModels(): ReadonlyArray<AIModelConfiguration>;
	getActiveModel(): string | undefined;
	setActiveModel(modelId: string): Promise<void>;
	reloadModelConfiguration(): Promise<void>;

	// Model management
	getConfigUri(): URI;
	addModel(model: Omit<AIModelConfiguration, 'api'> & { api: string }): Promise<void>;
	removeModel(modelId: string): Promise<void>;
	updateModel(modelId: string, updates: Partial<Omit<AIModelConfiguration, 'id' | 'api'> & { api?: string }>): Promise<void>;
}


