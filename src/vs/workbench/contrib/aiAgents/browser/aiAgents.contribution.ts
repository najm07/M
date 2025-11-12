/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IAgentService } from '../../../../services/ai/common/agentService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';

class AIAgentsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aiAgents';

	constructor() {
		super();
	}
}

registerWorkbenchContribution2(AIAgentsContribution.ID, AIAgentsContribution, WorkbenchPhase.Eventually);

// Command: Execute AI Agent Task
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.agent.execute',
			title: { value: localize('ai.agent.execute', 'Execute AI Agent Task'), original: 'Execute AI Agent Task' },
			category: localize('ai.category', 'AI'),
		});
	}

	async run(accessor: ServicesAccessor, description?: string): Promise<void> {
		const agentService = accessor.get(IAgentService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const progressService = accessor.get(IProgressService);
		const logService = accessor.get(ILogService);

		const workspace = workspaceContextService.getWorkspace();
		if (workspace.folders.length === 0) {
			notificationService.warn(localize('ai.agent.noWorkspace', 'No workspace open'));
			return;
		}

		const workspaceRoot = workspace.folders[0].uri;

		// Get task description
		let taskDescription = description;
		if (!taskDescription) {
			const input = await quickInputService.input({
				placeHolder: localize('ai.agent.description', 'Describe the task you want the AI agent to perform'),
				prompt: localize('ai.agent.description.prompt', 'Example: "Refactor API routes to TypeScript"'),
			});

			if (!input) {
				return;
			}

			taskDescription = input;
		}

		// Show progress
		progressService.withProgress(
			{
				location: 'workbench.view.problems',
				title: localize('ai.agent.running', 'Running AI Agent Task'),
			},
			async (progress) => {
				try {
					const task = await agentService.executeTaskFromDescription(taskDescription!, workspaceRoot, {
						maxSteps: 10,
						retryOnFailure: true,
						stopOnError: false,
					});

					// Monitor task progress
					const updateListener = agentService.onDidTaskUpdate((updatedTask) => {
						if (updatedTask.id === task.id) {
							if (updatedTask.currentStep !== undefined && updatedTask.steps.length > 0) {
								const stepProgress = (updatedTask.currentStep + 1) / updatedTask.steps.length;
								progress.report({
									message: updatedTask.steps[updatedTask.currentStep]?.name || '',
									increment: stepProgress * 100,
								});
							}
						}
					});

					// Wait for completion
					return new Promise<void>((resolve) => {
						const completeListener = agentService.onDidTaskComplete((completedTask) => {
							if (completedTask.id === task.id) {
								updateListener.dispose();
								completeListener.dispose();

								if (completedTask.status === 'completed') {
									notificationService.info(
										localize('ai.agent.completed', 'AI Agent task completed: {0}', completedTask.name)
									);
								} else {
									notificationService.error(
										localize('ai.agent.failed', 'AI Agent task failed: {0}', completedTask.error || 'Unknown error')
									);
								}

								resolve();
							}
						});
					});
				} catch (error) {
					logService.error('[AIAgents] Task execution failed', error);
					notificationService.error(
						localize('ai.agent.error', 'AI Agent task failed: {0}', error instanceof Error ? error.message : String(error))
					);
				}
			}
		);
	}
});

// Command: View Active Agent Tasks
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.agent.viewTasks',
			title: { value: localize('ai.agent.viewTasks', 'View Active AI Agent Tasks'), original: 'View Active AI Agent Tasks' },
			category: localize('ai.category', 'AI'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agentService = accessor.get(IAgentService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		const activeTasks = agentService.getActiveTasks();
		if (activeTasks.length === 0) {
			notificationService.info(localize('ai.agent.noTasks', 'No active AI agent tasks'));
			return;
		}

		const items = activeTasks.map(task => ({
			label: task.name,
			description: task.status,
			detail: task.description,
			taskId: task.id,
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('ai.agent.selectTask', 'Select a task to view details'),
		});

		if (selected) {
			const task = agentService.getTask(selected.taskId);
			if (task) {
				notificationService.info(
					localize('ai.agent.taskDetails', 'Task: {0}\nStatus: {1}\nSteps: {2}/{3}',
						task.name,
						task.status,
						task.currentStep !== undefined ? task.currentStep + 1 : 0,
						task.steps.length
					)
				);
			}
		}
	}
});

// Command: Cancel Agent Task
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.agent.cancel',
			title: { value: localize('ai.agent.cancel', 'Cancel AI Agent Task'), original: 'Cancel AI Agent Task' },
			category: localize('ai.category', 'AI'),
		});
	}

	async run(accessor: ServicesAccessor, taskId?: string): Promise<void> {
		const agentService = accessor.get(IAgentService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		let targetTaskId = taskId;

		if (!targetTaskId) {
			const activeTasks = agentService.getActiveTasks();
			if (activeTasks.length === 0) {
				notificationService.info(localize('ai.agent.noTasks', 'No active AI agent tasks'));
				return;
			}

			const items = activeTasks.map(task => ({
				label: task.name,
				description: task.status,
				taskId: task.id,
			}));

			const selected = await quickInputService.pick(items, {
				placeHolder: localize('ai.agent.selectTaskToCancel', 'Select a task to cancel'),
			});

			if (!selected) {
				return;
			}

			targetTaskId = selected.taskId;
		}

		await agentService.cancelTask(targetTaskId);
		notificationService.info(localize('ai.agent.cancelled', 'AI Agent task cancelled'));
	}
});

