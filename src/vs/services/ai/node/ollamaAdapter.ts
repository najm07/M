/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { AICompletionRequest, AICompletionResponse } from '../common/aiService.js';
import { AIModelConfiguration } from '../common/aiTypes.js';

/**
 * Converts a CancellationToken to an AbortSignal for use with fetch API
 */
function toAbortSignal(token?: CancellationToken): AbortSignal | undefined {
	if (!token) {
		return undefined;
	}

	if (token.isCancellationRequested) {
		const controller = new AbortController();
		controller.abort();
		return controller.signal;
	}

	const controller = new AbortController();
	const disposable = token.onCancellationRequested(() => {
		controller.abort();
		disposable.dispose();
	});

	return controller.signal;
}

export interface OllamaModelInfo {
	name: string;
	modified_at: string;
	size: number;
	digest: string;
	details: {
		parent_model: string;
		format: string;
		family: string;
		families: string[];
		parameter_size: string;
		quantization_level: string;
	};
}

export interface OllamaGenerateRequest {
	model: string;
	prompt: string;
	system?: string;
	template?: string;
	context?: number[];
	stream?: boolean;
	raw?: boolean;
	format?: 'json';
	options?: {
		temperature?: number;
		top_p?: number;
		top_k?: number;
		num_predict?: number;
		stop?: string[];
	};
}

export interface OllamaGenerateResponse {
	model: string;
	created_at: string;
	response: string;
	done: boolean;
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

export class OllamaAdapter extends Disposable {
	constructor(
		private readonly config: AIModelConfiguration,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Check if Ollama is available and healthy
	 */
	async healthCheck(token?: CancellationToken): Promise<boolean> {
		try {
			const baseUrl = this.config.api.toString();
			const response = await fetch(`${baseUrl}/api/tags`, {
				signal: toAbortSignal(token),
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				return false;
			}

			return true;
		} catch (error) {
			this.logService.debug('[OllamaAdapter] Health check failed', error);
			return false;
		}
	}

	/**
	 * Get list of available models from Ollama
	 */
	async listModels(token?: CancellationToken): Promise<OllamaModelInfo[]> {
		try {
			const baseUrl = this.config.api.toString();
			const response = await fetch(`${baseUrl}/api/tags`, {
				signal: toAbortSignal(token),
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				throw new Error(`Ollama API returned ${response.status}: ${response.statusText}`);
			}

			const data = await response.json() as { models: OllamaModelInfo[] };
			return data.models || [];
		} catch (error) {
			this.logService.error('[OllamaAdapter] Failed to list models', error);
			throw error;
		}
	}

	/**
	 * Generate completion using Ollama API
	 */
	async generate(request: AICompletionRequest, token?: CancellationToken): Promise<AICompletionResponse> {
		const modelName = this.extractModelName(request.modelId);
		if (!modelName) {
			throw new Error(`Invalid Ollama model ID: ${request.modelId}`);
		}

		// Build prompt from request
		const systemPrompt = this.buildSystemPrompt(request);
		const userPrompt = request.prompt || '';

		const ollamaRequest: OllamaGenerateRequest = {
			model: modelName,
			prompt: userPrompt,
			system: systemPrompt,
			stream: false,
			options: {
				temperature: request.temperature ?? 0.7,
				num_predict: request.maxOutputTokens,
			},
		};

		try {
			const baseUrl = this.config.api.toString();
			const response = await fetch(`${baseUrl}/api/generate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(ollamaRequest),
				signal: toAbortSignal(token),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data = await response.json() as OllamaGenerateResponse;

			return {
				requestId: `ollama-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				modelId: request.modelId,
				text: data.response || '',
				metadata: {
					total_duration: data.total_duration,
					load_duration: data.load_duration,
					prompt_eval_duration: data.prompt_eval_duration,
					eval_duration: data.eval_duration,
					prompt_eval_count: data.prompt_eval_count,
					eval_count: data.eval_count,
				},
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw error;
			}
			this.logService.error('[OllamaAdapter] Generate failed', error);
			throw new Error(`Ollama generation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Extract model name from model ID (e.g., "ollama:llama3.1" -> "llama3.1")
	 */
	private extractModelName(modelId: string): string | undefined {
		// Model ID format: "ollama:model-name" or just "model-name" if family is "ollama"
		if (this.config.family === 'ollama' || this.config.family === 'local') {
			if (modelId.includes(':')) {
				return modelId.split(':').slice(1).join(':');
			}
			return modelId;
		}
		return undefined;
	}

	/**
	 * Build system prompt from supplemental context
	 */
	private buildSystemPrompt(request: AICompletionRequest): string {
		const parts: string[] = [];

		if (request.supplementalContext && request.supplementalContext.length > 0) {
			parts.push('Context:');
			parts.push(...request.supplementalContext);
		}

		parts.push('You are a helpful AI coding assistant. Provide clear, concise, and accurate responses.');

		return parts.join('\n\n');
	}

	/**
	 * Check if this adapter can handle the given model
	 */
	static canHandle(config: AIModelConfiguration): boolean {
		const family = config.family?.toLowerCase();
		const apiStr = config.api.toString().toLowerCase();

		// Check if family is ollama/local or API endpoint contains ollama/localhost
		return family === 'ollama' ||
		       family === 'local' ||
		       apiStr.includes('localhost') ||
		       apiStr.includes('127.0.0.1') ||
		       apiStr.includes('ollama');
	}
}

