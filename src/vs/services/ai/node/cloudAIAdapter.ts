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

/**
 * Cloud AI adapter for OpenAI, Anthropic, and other cloud-based AI providers
 */
export class CloudAIAdapter extends Disposable {
	constructor(
		private readonly config: AIModelConfiguration,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Generate completion using cloud AI API
	 */
	async generate(request: AICompletionRequest, token?: CancellationToken): Promise<AICompletionResponse> {
		const family = this.config.family?.toLowerCase() || 'openai';

		switch (family) {
			case 'openai':
				return this.generateOpenAI(request, token);
			case 'anthropic':
				return this.generateAnthropic(request, token);
			default:
				throw new Error(`Unsupported cloud AI family: ${family}`);
		}
	}

	private async generateOpenAI(request: AICompletionRequest, token?: CancellationToken): Promise<AICompletionResponse> {
		const apiKey = this.config.apiKey;
		if (!apiKey) {
			throw new Error('OpenAI API key is required');
		}

		const modelName = this.extractModelName(request.modelId);
		const messages = this.buildMessages(request);

		try {
			const baseUrl = this.config.api.toString();
			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: modelName,
					messages,
					temperature: request.temperature ?? 0.7,
					max_tokens: request.maxOutputTokens,
				}),
				signal: toAbortSignal(token),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data = await response.json() as any;
			const content = data.choices?.[0]?.message?.content || '';

			return {
				requestId: data.id || `openai-${Date.now()}`,
				modelId: request.modelId,
				text: content,
				metadata: {
					usage: data.usage,
					model: data.model,
				},
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw error;
			}
			this.logService.error('[CloudAIAdapter] OpenAI generation failed', error);
			throw new Error(`OpenAI generation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async generateAnthropic(request: AICompletionRequest, token?: CancellationToken): Promise<AICompletionResponse> {
		const apiKey = this.config.apiKey;
		if (!apiKey) {
			throw new Error('Anthropic API key is required');
		}

		const modelName = this.extractModelName(request.modelId);
		const messages = this.buildMessages(request);

		try {
			const baseUrl = this.config.api.toString();
			const response = await fetch(`${baseUrl}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
				},
				body: JSON.stringify({
					model: modelName,
					messages,
					max_tokens: request.maxOutputTokens ?? 4096,
					temperature: request.temperature ?? 0.7,
				}),
				signal: toAbortSignal(token),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data = await response.json() as any;
			const content = data.content?.[0]?.text || '';

			return {
				requestId: data.id || `anthropic-${Date.now()}`,
				modelId: request.modelId,
				text: content,
				metadata: {
					usage: data.usage,
					model: data.model,
				},
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw error;
			}
			this.logService.error('[CloudAIAdapter] Anthropic generation failed', error);
			throw new Error(`Anthropic generation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private extractModelName(modelId: string): string {
		// Extract model name from ID (e.g., "openai:gpt-4" -> "gpt-4")
		if (modelId.includes(':')) {
			return modelId.split(':').slice(1).join(':');
		}
		return modelId;
	}

	private buildMessages(request: AICompletionRequest): Array<{ role: string; content: string }> {
		const messages: Array<{ role: string; content: string }> = [];

		// Add system context if available
		if (request.supplementalContext && request.supplementalContext.length > 0) {
			messages.push({
				role: 'system',
				content: request.supplementalContext.join('\n\n'),
			});
		}

		// Add user prompt
		if (request.prompt) {
			messages.push({
				role: 'user',
				content: request.prompt,
			});
		}

		return messages;
	}

	/**
	 * Check if this adapter can handle the given model
	 */
	static canHandle(config: AIModelConfiguration): boolean {
		const family = config.family?.toLowerCase();
		return family === 'openai' || family === 'anthropic';
	}
}

