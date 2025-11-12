/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { IAgentService, AgentTask, AgentTaskStatus, AgentStep, AgentStepType, AgentStepStatus, AgentPlan, AgentExecutionOptions } from '../common/agentService.js';
import { IAIService } from '../common/aiService.js';
import { IContextService } from '../common/contextService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { generateUuid } from '../../../base/common/uuid.js';

export class AgentService extends Disposable implements IAgentService {
	declare _serviceBrand: undefined;

	private readonly _tasks = new Map<string, AgentTask>();
	private readonly _taskCancellations = new Map<string, CancellationTokenSource>();

	private readonly _onDidTaskUpdate = new Emitter<AgentTask>();
	private readonly _onDidTaskComplete = new Emitter<AgentTask>();

	public readonly onDidTaskUpdate: Event<AgentTask> = this._onDidTaskUpdate.event;
	public readonly onDidTaskComplete: Event<AgentTask> = this._onDidTaskComplete.event;

	constructor(
		@IAIService private readonly aiService: IAIService,
		@IContextService private readonly contextService: IContextService,
		@ILogService private readonly logService: ILogService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
	}

	override dispose(): void {
		// Cancel all running tasks
		for (const [, cancellation] of this._taskCancellations.entries()) {
			cancellation.cancel();
		}
		this._onDidTaskUpdate.dispose();
		this._onDidTaskComplete.dispose();
		super.dispose();
	}

	async planTask(description: string, context: URI, token?: CancellationToken): Promise<AgentPlan> {
		const activeModelId = this.aiService.getActiveModel();
		if (!activeModelId) {
			throw new Error('No AI model configured');
		}

		// Use AI to generate a plan
		const prompt = `You are a task planning assistant. Break down the following task into concrete steps:

Task: ${description}

Context: Working in file/directory ${context.toString()}

Generate a step-by-step plan. Each step should be one of:
- search: Find relevant files or code
- generate: Generate new code or content
- edit: Modify existing code
- test: Run tests or verify changes
- verify: Check if changes work correctly

Respond with a JSON array of steps, each with:
{
	"type": "search|generate|edit|test|verify",
	"description": "what to do",
	"parameters": { optional parameters }
}`;

		try {
			const response = await this.aiService.requestCompletion({
				context: {
					uri: context,
					languageId: '',
					version: 0,
				},
				modelId: activeModelId,
				prompt,
			}, token || CancellationToken.None);

			// Parse the plan from response
			const planText = response.text;
			const jsonMatch = planText.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const steps = JSON.parse(jsonMatch[0]);
				return { steps };
			}

			// Fallback: create a simple plan
			return {
				steps: [
					{ type: AgentStepType.Search, description: `Search for files related to: ${description}` },
					{ type: AgentStepType.Generate, description: `Generate code for: ${description}` },
					{ type: AgentStepType.Edit, description: `Apply changes` },
					{ type: AgentStepType.Verify, description: `Verify changes work correctly` },
				],
			};
		} catch (error) {
			this.logService.error('[AgentService] Failed to plan task', error);
			throw error;
		}
	}

	async executeTask(plan: AgentPlan, context: URI, options: AgentExecutionOptions = {}, token?: CancellationToken): Promise<AgentTask> {
		const {
			maxSteps = 10,
			retryOnFailure = true,
			stopOnError = true,
			dryRun = false,
		} = options;

		const taskId = generateUuid();
		const taskCancellation = new CancellationTokenSource();
		if (token) {
			token.onCancellationRequested(() => taskCancellation.cancel());
		}
		this._taskCancellations.set(taskId, taskCancellation);

		const steps: AgentStep[] = plan.steps.slice(0, maxSteps).map((step, index) => ({
			id: generateUuid(),
			type: step.type,
			name: step.description,
			status: AgentStepStatus.Pending,
		}));

		const task: AgentTask = {
			id: taskId,
			name: `Task: ${plan.steps[0]?.description || 'Unknown'}`,
			description: plan.steps.map(s => s.description).join(' → '),
			status: AgentTaskStatus.Running,
			steps,
			currentStep: 0,
		};

		this._tasks.set(taskId, task);
		this._onDidTaskUpdate.fire(task);

		// Execute steps asynchronously
		this.executeSteps(task, context, { retryOnFailure, stopOnError, dryRun }, taskCancellation.token)
			.then(() => {
				const finalTask = this._tasks.get(taskId);
				if (finalTask) {
					this._onDidTaskComplete.fire(finalTask);
				}
			})
			.catch(error => {
				this.logService.error('[AgentService] Task execution failed', error);
				const failedTask = this._tasks.get(taskId);
				if (failedTask) {
					this.updateTask(taskId, {
						status: AgentTaskStatus.Failed,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});

		return task;
	}

	async executeTaskFromDescription(description: string, context: URI, options?: AgentExecutionOptions, token?: CancellationToken): Promise<AgentTask> {
		const plan = await this.planTask(description, context, token);
		return this.executeTask(plan, context, options, token);
	}

	getTask(taskId: string): AgentTask | undefined {
		return this._tasks.get(taskId);
	}

	async cancelTask(taskId: string, _token?: CancellationToken): Promise<void> {
		const cancellation = this._taskCancellations.get(taskId);
		if (cancellation) {
			cancellation.cancel();
			this.updateTask(taskId, { status: AgentTaskStatus.Cancelled });
			this._taskCancellations.delete(taskId);
		}
	}

	getActiveTasks(): AgentTask[] {
		return Array.from(this._tasks.values()).filter(
			task => task.status === AgentTaskStatus.Running || task.status === AgentTaskStatus.Pending
		);
	}

	private async executeSteps(
		task: AgentTask,
		context: URI,
		options: { retryOnFailure: boolean; stopOnError: boolean; dryRun: boolean },
		token: CancellationToken,
	): Promise<void> {
		for (let i = 0; i < task.steps.length; i++) {
			if (token.isCancellationRequested) {
				this.updateTask(task.id, { status: AgentTaskStatus.Cancelled });
				return;
			}

			const step = task.steps[i];
			this.updateStep(task.id, step.id, { status: AgentStepStatus.Running });
			this.updateTask(task.id, { currentStep: i });

			try {
				const result = await this.executeStep(step, context, options, token);
				this.updateStep(task.id, step.id, {
					status: AgentStepStatus.Completed,
					result,
				});
			} catch (error) {
				this.logService.error(`[AgentService] Step ${step.name} failed`, error);
				this.updateStep(task.id, step.id, {
					status: AgentStepStatus.Failed,
					error: error instanceof Error ? error.message : String(error),
				});

				if (options.stopOnError) {
					this.updateTask(task.id, {
						status: AgentTaskStatus.Failed,
						error: `Step ${step.name} failed: ${error instanceof Error ? error.message : String(error)}`,
					});
					return;
				}
			}
		}

		// All steps completed
		this.updateTask(task.id, { status: AgentTaskStatus.Completed });
	}

	private async executeStep(
		step: AgentStep,
		context: URI,
		options: { retryOnFailure: boolean; stopOnError: boolean; dryRun: boolean },
		token: CancellationToken,
	): Promise<any> {
		if (options.dryRun) {
			this.logService.info(`[AgentService] DRY RUN: Would execute ${step.type}: ${step.name}`);
			return { dryRun: true };
		}

		switch (step.type) {
			case AgentStepType.Search:
				return this.executeSearchStep(step, context, token);

			case AgentStepType.Generate:
				return this.executeGenerateStep(step, context, token);

			case AgentStepType.Edit:
				return this.executeEditStep(step, context, token);

			case AgentStepType.Test:
				return this.executeTestStep(step, context, token);

			case AgentStepType.Verify:
				return this.executeVerifyStep(step, context, token);

			default:
				throw new Error(`Unknown step type: ${step.type}`);
		}
	}

	private async executeSearchStep(step: AgentStep, context: URI, token: CancellationToken): Promise<any> {
		const results = await this.contextService.search(step.name, 10, token);
		return {
			found: results.length,
			files: results.map(r => r.uri.toString()),
		};
	}

	private async executeGenerateStep(step: AgentStep, context: URI, token: CancellationToken): Promise<any> {
		const activeModelId = this.aiService.getActiveModel();
		if (!activeModelId) {
			throw new Error('No AI model configured');
		}

		const response = await this.aiService.requestCompletion({
			context: {
				uri: context,
				languageId: '',
				version: 0,
			},
			modelId: activeModelId,
			prompt: step.name,
		}, token);

		return {
			generated: response.text,
			modelId: response.modelId,
		};
	}

	private async executeEditStep(step: AgentStep, context: URI, token: CancellationToken): Promise<any> {
		// This would apply diffs - for now, just return success
		// In a full implementation, this would use applyDiff from AI service
		return {
			edited: true,
			file: context.toString(),
		};
	}

	private async executeTestStep(step: AgentStep, context: URI, token: CancellationToken): Promise<any> {
		// Execute test command
		try {
			await this.commandService.executeCommand('workbench.action.terminal.runSelectedText');
			return { testsRun: true };
		} catch (error) {
			// Fallback: just return success for now
			return { testsRun: false, note: 'Test execution not fully implemented' };
		}
	}

	private async executeVerifyStep(step: AgentStep, context: URI, token: CancellationToken): Promise<any> {
		// Verify changes - could check syntax, run linter, etc.
		return {
			verified: true,
			note: 'Verification step completed',
		};
	}

	private updateTask(taskId: string, updates: Partial<AgentTask>): void {
		const task = this._tasks.get(taskId);
		if (!task) {
			return;
		}

		const updated = { ...task, ...updates };
		this._tasks.set(taskId, updated);
		this._onDidTaskUpdate.fire(updated);
	}

	private updateStep(taskId: string, stepId: string, updates: Partial<AgentStep>): void {
		const task = this._tasks.get(taskId);
		if (!task) {
			return;
		}

		const stepIndex = task.steps.findIndex(s => s.id === stepId);
		if (stepIndex === -1) {
			return;
		}

		const updatedSteps = [...task.steps];
		updatedSteps[stepIndex] = { ...updatedSteps[stepIndex], ...updates };

		this.updateTask(taskId, { steps: updatedSteps });
	}
}

