/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Range } from '../../../../editor/common/core/range.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IAIService } from '../../../../services/ai/common/aiService.js';
import { AICompletionResponse } from '../../../../services/ai/common/aiTypes.js';
import { IContextService } from '../../../../services/ai/common/contextService.js';
import { IProjectGraphService } from '../../../../services/ai/common/projectGraphService.js';
import { AdaptivePromptBuilder } from '../../../../services/ai/common/adaptivePromptBuilder.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { AIInlineCommandParser } from '../../../../editor/contrib/aiCommands/browser/aiInlineCommandParser.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';

// Register CodeLens provider
import { AICommandsCodeLensProvider } from '../../../../editor/contrib/aiCommands/browser/aiCommandsCodeLensProvider.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

class AICommandsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aiCommands';

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super();
		// Register CodeLens provider
		this._register(instantiationService.createInstance(AICommandsCodeLensProvider));
	}
}

registerWorkbenchContribution2(AICommandsContribution.ID, AICommandsContribution, WorkbenchPhase.Eventually);

// Command: Open AI command palette
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.command.palette',
			title: { value: localize('ai.command.palette', 'AI Command Palette'), original: 'AI Command Palette' },
			category: localize('ai.category', 'AI'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Slash,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);

		const editorControl = editorService.activeTextEditorControl;
		const editor = isCodeEditor(editorControl) ? editorControl : undefined;
		if (!editor || !editor.getModel()) {
			return;
		}

		const items: IQuickPickItem[] = [
			{
				label: localize('ai.command.explain', 'Explain'),
				description: localize('ai.command.explain.desc', 'Explain the selected code'),
				id: 'explain',
			},
			{
				label: localize('ai.command.refactor', 'Refactor'),
				description: localize('ai.command.refactor.desc', 'Refactor the selected code'),
				id: 'refactor',
			},
			{
				label: localize('ai.command.fix', 'Fix'),
				description: localize('ai.command.fix.desc', 'Fix issues in the selected code'),
				id: 'fix',
			},
			{
				label: localize('ai.command.test', 'Generate Tests'),
				description: localize('ai.command.test.desc', 'Generate unit tests'),
				id: 'test',
			},
			{
				label: localize('ai.command.doc', 'Document'),
				description: localize('ai.command.doc.desc', 'Add documentation'),
				id: 'doc',
			},
			{
				label: localize('ai.command.optimize', 'Optimize'),
				description: localize('ai.command.optimize.desc', 'Optimize performance'),
				id: 'optimize',
			},
		];

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('ai.command.palette.placeholder', 'Select an AI command'),
		});

		if (selected && selected.id) {
			const commandService = accessor.get(ICommandService);
			await commandService.executeCommand(`ai.command.${selected.id}`, editor);
		}
	}
});

// Base handler for AI commands
async function handleAICommand(
	accessor: ServicesAccessor,
	command: string,
	editor: ICodeEditor,
	prompt?: string,
): Promise<void> {
	const aiService = accessor.get(IAIService);
	const contextService = accessor.get(IContextService);
	const projectGraphService = accessor.get(IProjectGraphService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const fileService = accessor.get(IFileService);
	const notificationService = accessor.get(INotificationService);
	const logService = accessor.get(ILogService);

	const model = editor.getModel();
	if (!model) {
		return;
	}

	const selection = editor.getSelection();
	const selectedText = selection ? model.getValueInRange(selection) : '';
	const contextRange = selection || new Range(1, 1, model.getLineCount(), 1);
	const contextText = model.getValueInRange(contextRange);

	// Get workspace folder
	const workspace = workspaceContextService.getWorkspace();
	const workspaceFolder = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;

	// Build adaptive prompt
	const promptBuilder = new AdaptivePromptBuilder(
		projectGraphService,
		contextService,
		fileService,
	);

	const editorContext = {
		uri: model.uri,
		languageId: model.getLanguageId(),
		version: model.getVersionId(),
		selection: selection ? {
			startLineNumber: selection.startLineNumber,
			startColumn: selection.startColumn,
			endLineNumber: selection.endLineNumber,
			endColumn: selection.endColumn,
		} : undefined,
		content: contextText,
		workspaceFolder,
	};

	const userPromptText = prompt || buildUserPrompt(command, selectedText, contextText, prompt);
	const adaptivePrompt = await promptBuilder.buildPrompt(editorContext, userPromptText, {
		maxContextFiles: 10,
		includeRelatedFiles: true,
		includeCallChain: true,
		includeDependencies: true,
	});

	// Get active model
	const activeModelId = aiService.getActiveModel();
	if (!activeModelId) {
		notificationService.warn(localize('ai.noModel', 'No AI model configured. Please configure a model in ~/.void/config.json'));
		return;
	}

	// Request completion with adaptive prompt
	const tokenSource = new CancellationTokenSource();
	try {
		const response = await aiService.requestCompletion({
			context: editorContext,
			modelId: activeModelId,
			prompt: `${adaptivePrompt.systemPrompt}\n\n${adaptivePrompt.userPrompt}`,
			supplementalContext: adaptivePrompt.contextFiles.map(f => `${f.uri.toString()}: ${f.reason}`),
		}, tokenSource.token);

		// Handle response based on command type
		await handleAIResponse(accessor, command, editor, response, selectedText);
	} catch (error) {
		notificationService.error(localize('ai.error', 'AI command failed: {0}', error instanceof Error ? error.message : String(error)));
		logService.error('[AICommands] Command failed', error);
	} finally {
		tokenSource.dispose();
	}
}

function buildUserPrompt(command: string, selectedText: string, contextText: string, userPrompt?: string): string {
	if (userPrompt) {
		return userPrompt;
	}

	if (selectedText) {
		return `Please ${command} the following code:\n\n\`\`\`\n${selectedText}\n\`\`\``;
	}

	return `Please ${command} the following code:\n\n\`\`\`\n${contextText.substring(0, 2000)}\n\`\`\``;
}

async function handleAIResponse(
	accessor: ServicesAccessor,
	command: string,
	editor: ICodeEditor,
	response: AICompletionResponse,
	originalText: string,
): Promise<void> {
	const notificationService = accessor.get(INotificationService);

	// For now, show the response in a notification
	// In Phase 2, we'll implement diff mode to apply changes
	if (response && response.text) {
		notificationService.info(localize('ai.response', 'AI Response: {0}', response.text.substring(0, 200)));
	}
}

// Register individual commands
for (const command of ['explain', 'refactor', 'fix', 'test', 'doc', 'optimize']) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: `ai.command.${command}`,
				title: { value: localize(`ai.command.${command}`, command.charAt(0).toUpperCase() + command.slice(1)), original: command },
				category: localize('ai.category', 'AI'),
			});
		}

		async run(accessor: ServicesAccessor, editor?: ICodeEditor, prompt?: string): Promise<void> {
			const editorService = accessor.get(IEditorService);
			const editorControl = editor || editorService.activeTextEditorControl;
			const activeEditor = isCodeEditor(editorControl) ? editorControl : undefined;
			if (!activeEditor || !activeEditor.getModel()) {
				return;
			}

			await handleAICommand(accessor, command, activeEditor, prompt);
		}
	});
}

// Register inline command handler (for // /fix, // /refactor, etc.)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.command.inline',
			title: { value: localize('ai.command.inline', 'Execute Inline AI Command'), original: 'Execute Inline AI Command' },
			category: localize('ai.category', 'AI'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorControl = editorService.activeTextEditorControl;
		const editor = isCodeEditor(editorControl) ? editorControl : undefined;
		if (!editor || !editor.getModel()) {
			return;
		}

		const model = editor.getModel();
		if (!model) {
			return;
		}

		const position = editor.getPosition();
		if (!position) {
			return;
		}

		const inlineCommand = AIInlineCommandParser.findCommandAtPosition(model, position);
		if (!inlineCommand) {
			return;
		}

		const commandService = accessor.get(ICommandService);
		await commandService.executeCommand(`ai.command.${inlineCommand.command}`, editor, inlineCommand.prompt);
	}
});

