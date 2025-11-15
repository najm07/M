/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILanguageModelsService, ChatMessageRole, IChatResponsePart } from '../../chat/common/languageModels.js';
import { IAIService } from '../../../../services/ai/common/aiService.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelChatProvider } from '../../chat/common/languageModels.js';
import { AIModelConfiguration } from '../../../../services/ai/common/aiTypes.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';

const AI_VENDOR_ID = 'ai-custom';
const AI_VENDOR_DISPLAY_NAME = 'Custom AI Models';

/**
 * Bridge that exposes AI models from config.json as language models
 * so they appear in the chat UI alongside Copilot models.
 *
 * This allows users to:
 * - Use their configured AI models (OpenAI, Anthropic, Ollama, etc.) in chat
 * - Switch between custom models and Copilot seamlessly
 * - Have all models available in the same chat interface
 */
class AIModelsLanguageModelsBridge extends Disposable implements IWorkbenchContribution {

	private readonly _onDidChange = this._register(new Emitter<void>());
	private readonly _providerDisposable = this._register(new DisposableStore());

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IAIService private readonly aiService: IAIService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Watch for model registry changes
		this._register(this.aiService.onDidUpdateModelRegistry(() => {
			this._onDidChange.fire();
		}));

		// Register the vendor and provider
		this._registerVendor();
		this._registerProvider();
	}

	/**
	 * Register the vendor by directly adding it to the service's internal vendors map.
	 * This is necessary because vendors are typically registered via extension points,
	 * but we're building this into VS Code itself.
	 */
	private _registerVendor(): void {
		// Access the internal _vendors map via any casting
		// This is a workaround since we can't use extension points for built-in features
		const service = this.languageModelsService as any;

		if (service && service._vendors) {
			// Check if vendor already exists
			if (!service._vendors.has(AI_VENDOR_ID)) {
				// Add vendor directly to the internal map
				service._vendors.set(AI_VENDOR_ID, {
					vendor: AI_VENDOR_ID,
					displayName: AI_VENDOR_DISPLAY_NAME,
				});
				this.logService.info(`[AIBridge] Registered vendor ${AI_VENDOR_ID} directly`);
			} else {
				this.logService.debug(`[AIBridge] Vendor ${AI_VENDOR_ID} already registered`);
			}
		} else {
			this.logService.warn(`[AIBridge] Could not access vendors map, vendor registration may fail`);
		}
	}

	/**
	 * Register the language model provider that bridges our AI service to the chat system
	 */
	private _registerProvider(): void {
		const provider: ILanguageModelChatProvider = {
			onDidChange: this._onDidChange.event,

			provideLanguageModelChatInfo: async (options, token) => {
				const models = this.aiService.getModels();
				if (models.length === 0) {
					return [];
				}

				return models.map((model: AIModelConfiguration) => {
					const metadata: ILanguageModelChatMetadata = {
						extension: new ExtensionIdentifier('builtin'),
						name: model.id,
						id: model.id,
						vendor: AI_VENDOR_ID,
						version: '1.0',
						family: model.family || 'custom',
						maxInputTokens: (model.metadata?.maxInputTokens as number) || 8192,
						maxOutputTokens: (model.metadata?.maxOutputTokens as number) || 4096,
						isUserSelectable: true,
						isDefault: model.isDefault,
						modelPickerCategory: {
							label: AI_VENDOR_DISPLAY_NAME,
							order: 100, // Show after Copilot
						},
						capabilities: {
							toolCalling: true,
							agentMode: true,
							vision: model.metadata?.vision === true,
						},
					};
					return {
						metadata,
						identifier: model.id,
					} satisfies ILanguageModelChatMetadataAndIdentifier;
				});
			},

			sendChatRequest: async (modelId, messages, from, options, token) => {
				// Convert IChatMessage[] to a prompt string
				// Handle system, user, and assistant messages properly
				const promptParts: string[] = [];

				for (const msg of messages) {
					if (msg.role === ChatMessageRole.System) {
						// System messages go first
						const systemText = msg.content
							.filter(part => part.type === 'text')
							.map(part => part.value)
							.join('');
						if (systemText) {
							promptParts.push(`System: ${systemText}`);
						}
					} else if (msg.role === ChatMessageRole.User) {
						// User messages
						const userText = msg.content
							.filter(part => part.type === 'text')
							.map(part => part.value)
							.join('');
						if (userText) {
							promptParts.push(`User: ${userText}`);
						}
					} else if (msg.role === ChatMessageRole.Assistant) {
						// Assistant messages (for context)
						const assistantText = msg.content
							.filter(part => part.type === 'text')
							.map(part => part.value)
							.join('');
						if (assistantText) {
							promptParts.push(`Assistant: ${assistantText}`);
						}
					}
				}

				const prompt = promptParts.join('\n\n');

				// Check if streaming is requested
				const useStreaming = options?.stream === true || options?.streaming === true;

				if (useStreaming) {
					// Use streaming API
					const streamHandle = this.aiService.streamResponse({
						modelId,
						prompt,
						stream: true,
						context: {
							uri: URI.file(''),
							languageId: '',
							version: 0,
						},
					}, token);

					// Convert streaming response to chat format
					const logService = this.logService;
					const stream = (async function* (): AsyncIterable<IChatResponsePart> {
						try {
							for await (const chunk of streamHandle) {
								if (chunk.type === 'text') {
									yield { type: 'text', value: chunk.value as string };
								} else if (chunk.type === 'tool_call') {
									// Handle tool calls if needed
									const toolCall = chunk.value as any;
									yield {
										type: 'tool_use',
										name: toolCall.name,
										toolCallId: `tool-${Date.now()}-${Math.random()}`,
										parameters: toolCall.arguments || {},
									};
								}
							}
						} catch (error) {
							logService.error('[AIBridge] Streaming error', error);
							throw error;
						}
					})();

					// Collect full response for result promise
					let fullText = '';
					const resultPromise = (async () => {
						for await (const part of stream) {
							if (part.type === 'text') {
								fullText += part.value;
							}
						}
						return fullText;
					})();

					return {
						stream,
						result: resultPromise,
					};
				} else {
					// Use non-streaming API
					const response = await this.aiService.requestCompletion({
						modelId,
						prompt,
						context: {
							uri: URI.file(''),
							languageId: '',
							version: 0,
						},
					}, token);

					// Convert AICompletionResponse to ILanguageModelChatResponse
					const stream = (async function* (): AsyncIterable<IChatResponsePart> {
						yield { type: 'text', value: response.text };
					})();

					return {
						stream,
						result: Promise.resolve(response.text),
					};
				}
			},

			provideTokenCount: async (modelId, message, token) => {
				// Simple estimation: ~4 characters per token for most models
				// This is a rough estimate; real implementations would use model-specific tokenizers
				let text: string;
				if (typeof message === 'string') {
					text = message;
				} else {
					// Extract text from IChatMessage
					text = message.content
						.filter(part => part.type === 'text')
						.map(part => part.value)
						.join('');
				}
				// Rough estimate: 4 chars per token, but adjust for code (tends to be more tokens)
				return Math.ceil(text.length / 3.5);
			},
		};

		// Try to register the provider
		// Note: The vendor must be registered first via extension point or internal registration
		try {
			this._providerDisposable.add(
				this.languageModelsService.registerLanguageModelProvider(AI_VENDOR_ID, provider)
			);
			this.logService.info(`[AIBridge] Successfully registered language model provider for vendor ${AI_VENDOR_ID}`);
		} catch (error) {
			// Vendor not registered - this happens if the vendor isn't in the extension registry
			// We'll need to register it via a built-in extension or handle it differently
			this.logService.warn(`[AIBridge] Failed to register provider: ${error instanceof Error ? error.message : String(error)}`);
			this.logService.info(`[AIBridge] Vendor ${AI_VENDOR_ID} needs to be registered via extension point`);

			// Retry registration after a delay (in case extension points haven't loaded yet)
			setTimeout(() => {
				try {
					this._providerDisposable.add(
						this.languageModelsService.registerLanguageModelProvider(AI_VENDOR_ID, provider)
					);
					this.logService.info(`[AIBridge] Successfully registered provider on retry`);
				} catch (retryError) {
					this.logService.error(`[AIBridge] Retry registration failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
				}
			}, 2000);
		}
	}

	override dispose(): void {
		this._providerDisposable.dispose();
		super.dispose();
	}
}

// Register the contribution
registerWorkbenchContribution2(
	'workbench.contrib.aiModelsLanguageModelsBridge',
	AIModelsLanguageModelsBridge,
	WorkbenchPhase.Eventually
);

