/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';

export const IAgentService = createDecorator<IAgentService>('agentService');

export interface AgentTask {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly status: AgentTaskStatus;
	readonly steps: AgentStep[];
	readonly currentStep?: number;
	readonly error?: string;
	readonly metadata?: Record<string, unknown>;
}

export enum AgentTaskStatus {
	Pending = 'pending',
	Running = 'running',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled',
}

export interface AgentStep {
	readonly id: string;
	readonly type: AgentStepType;
	readonly name: string;
	readonly status: AgentStepStatus;
	readonly command?: string;
	readonly result?: any;
	readonly error?: string;
}

export enum AgentStepType {
	Search = 'search',
	Generate = 'generate',
	Edit = 'edit',
	Test = 'test',
	Verify = 'verify',
	Custom = 'custom',
}

export enum AgentStepStatus {
	Pending = 'pending',
	Running = 'running',
	Completed = 'completed',
	Failed = 'failed',
	Skipped = 'skipped',
}

export interface AgentPlan {
	readonly steps: Array<{
		readonly type: AgentStepType;
		readonly description: string;
		readonly parameters?: Record<string, unknown>;
	}>;
}

export interface AgentExecutionOptions {
	readonly maxSteps?: number;
	readonly retryOnFailure?: boolean;
	readonly stopOnError?: boolean;
	readonly dryRun?: boolean;
}

export interface IAgentService {
	readonly _serviceBrand: undefined;

	readonly onDidTaskUpdate: Event<AgentTask>;
	readonly onDidTaskComplete: Event<AgentTask>;

	/**
	 * Plan a multi-step task based on a natural language description.
	 */
	planTask(description: string, context: URI, token?: CancellationToken): Promise<AgentPlan>;

	/**
	 * Execute a planned task.
	 */
	executeTask(plan: AgentPlan, context: URI, options?: AgentExecutionOptions, token?: CancellationToken): Promise<AgentTask>;

	/**
	 * Execute a task from a natural language description (plan + execute).
	 */
	executeTaskFromDescription(description: string, context: URI, options?: AgentExecutionOptions, token?: CancellationToken): Promise<AgentTask>;

	/**
	 * Get the status of a running task.
	 */
	getTask(taskId: string): AgentTask | undefined;

	/**
	 * Cancel a running task.
	 */
	cancelTask(taskId: string, token?: CancellationToken): Promise<void>;

	/**
	 * Get all active tasks.
	 */
	getActiveTasks(): AgentTask[];
}

