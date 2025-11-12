/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IRange } from '../../../editor/common/core/range.js';
import { Position } from '../../../editor/common/core/position.js';
import { TextEdit } from '../../../editor/common/languages.js';

export interface EditorContext {
	readonly uri: URI;
	readonly languageId: string;
	readonly version: number;
	readonly selection?: IRange;
	readonly cursor?: Position;
	readonly surroundingText?: {
		readonly before: string;
		readonly after: string;
	};
	readonly content?: string;
	readonly workspaceFolder?: URI;
	readonly metadata?: Record<string, unknown>;
}

export interface AIDiff {
	readonly uri: URI;
	readonly edits: ReadonlyArray<TextEdit>;
	readonly title?: string;
	readonly description?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface AICompletionChunk {
	readonly type: 'text' | 'tool_call' | 'control';
	readonly value: string | AIModelToolCall | AIControlMessage;
}

export interface AIControlMessage {
	readonly kind: 'start' | 'end' | 'error';
	readonly data?: any;
}

export interface AIModelToolCall {
	readonly name: string;
	readonly arguments: Record<string, any>;
}

export interface AICompletionResponse {
	readonly requestId: string;
	readonly modelId: string;
	readonly text: string;
	readonly raw?: unknown;
	readonly usedContext?: ReadonlyArray<AIContextHit>;
	readonly metadata?: Record<string, unknown>;
}

export interface AIStreamHandle {
	cancel(): void;
	readonly requestId: string;
	[Symbol.asyncIterator](): AsyncIterator<AICompletionChunk>;
}

export interface AIContextHit {
	readonly uri: URI;
	readonly score: number;
	readonly text: string;
	readonly ranges?: ReadonlyArray<IRange>;
}

export interface AIModelConfiguration {
	readonly id: string;
	readonly api: URI;
	readonly apiKey?: string;
	readonly family?: string;
	readonly isDefault?: boolean;
	readonly metadata?: Record<string, unknown>;
}

export interface AIModelProviderMetadata {
	readonly id: string;
	readonly displayName: string;
	readonly provider: string;
	readonly supportsStreaming: boolean;
	readonly capabilities: {
		readonly vision?: boolean;
		readonly toolUse?: boolean;
		readonly codeEdit?: boolean;
	};
}


