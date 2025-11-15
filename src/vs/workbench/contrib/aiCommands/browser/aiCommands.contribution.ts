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

// Command: Switch AI Model
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.model.switch',
			title: { value: localize('ai.model.switch', 'Switch AI Model'), original: 'Switch AI Model' },
			category: localize('ai.category', 'AI'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyM,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiService = accessor.get(IAIService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		const models = aiService.getModels();
		if (models.length === 0) {
			notificationService.warn(localize('ai.noModels', 'No AI models configured. Please configure models in ~/.void/config.json'));
			return;
		}

		const activeModelId = aiService.getActiveModel();
		const items: IQuickPickItem[] = models.map(model => ({
			label: model.id,
			description: model.family || model.api.toString(),
			id: model.id,
			picked: model.id === activeModelId,
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('ai.model.select', 'Select an AI model'),
		});

		if (selected && selected.id) {
			await aiService.setActiveModel(selected.id);
			notificationService.info(localize('ai.model.switched', 'Switched to model: {0}', selected.id));
		}
	}
});

// Command: Open AI Config File
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.config.open',
			title: { value: localize('ai.config.open', 'Open AI Configuration File'), original: 'Open AI Configuration File' },
			category: { value: localize('ai.category', 'AI'), original: 'AI' },
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiService = accessor.get(IAIService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);

		try {
			const configUri = aiService.getConfigUri();
			await editorService.openEditor({
				resource: configUri,
				options: { revealIfOpened: true, pinned: true },
			});
		} catch (error) {
			notificationService.error(localize('ai.config.openError', 'Failed to open configuration file: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
});

// Command: Add AI Model
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.model.add',
			title: { value: localize('ai.model.add', 'Add AI Model'), original: 'Add AI Model' },
			category: { value: localize('ai.category', 'AI'), original: 'AI' },
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiService = accessor.get(IAIService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);

		try {
			// Step 1: Model ID
			const modelId = await quickInputService.input({
				title: localize('ai.model.add.step1', 'Add AI Model (1/4)'),
				placeHolder: localize('ai.model.id.placeholder', 'Enter a unique model ID (e.g., ollama-llama3)'),
				validateInput: async (value) => {
					if (!value || value.trim().length === 0) {
						return localize('ai.model.id.required', 'Model ID is required');
					}
					if (aiService.getModels().some(m => m.id === value.trim())) {
						return localize('ai.model.id.exists', 'A model with this ID already exists');
					}
					return undefined;
				},
			});

			if (!modelId) {
				return;
			}

			// Step 2: API URL
			const apiUrl = await quickInputService.input({
				title: localize('ai.model.add.step2', 'Add AI Model (2/4)'),
				placeHolder: localize('ai.model.api.placeholder', 'Enter API URL (e.g., http://localhost:11434 or https://api.openai.com/v1)'),
				validateInput: async (value) => {
					if (!value || value.trim().length === 0) {
						return localize('ai.model.api.required', 'API URL is required');
					}
					try {
						new URL(value.trim());
					} catch {
						return localize('ai.model.api.invalid', 'Invalid URL format');
					}
					return undefined;
				},
			});

			if (!apiUrl) {
				return;
			}

			// Step 3: Family (optional)
			const familyItems: IQuickPickItem[] = [
				{ label: localize('ai.model.family.ollama', 'Ollama'), id: 'ollama' },
				{ label: localize('ai.model.family.openai', 'OpenAI'), id: 'openai' },
				{ label: localize('ai.model.family.anthropic', 'Anthropic'), id: 'anthropic' },
				{ label: localize('ai.model.family.custom', 'Custom'), id: 'custom' },
				{ label: localize('ai.model.family.skip', 'Skip (Optional)'), id: '' },
			];

			const familySelected = await quickInputService.pick(familyItems, {
				placeHolder: localize('ai.model.family.placeholder', 'Select model family (optional)'),
			});

			const family = familySelected?.id || undefined;

			// Step 4: API Key (optional, for cloud APIs)
			let apiKey: string | undefined;
			const needsApiKey = apiUrl.includes('api.openai.com') || apiUrl.includes('api.anthropic.com') || family === 'openai' || family === 'anthropic';

			if (needsApiKey) {
				const apiKeyInput = await quickInputService.input({
					title: localize('ai.model.add.step4', 'Add AI Model (4/4)'),
					placeHolder: localize('ai.model.key.placeholder', 'Enter API key (optional, can be set later)'),
					password: true,
				});
				apiKey = apiKeyInput || undefined;
			}

			// Step 5: Set as default?
			const defaultItems: IQuickPickItem[] = [
				{ label: localize('ai.model.default.yes', 'Yes, set as default'), id: 'yes' },
				{ label: localize('ai.model.default.no', 'No'), id: 'no' },
			];

			const defaultSelected = await quickInputService.pick(defaultItems, {
				placeHolder: localize('ai.model.default.placeholder', 'Set as default model?'),
			});

			const isDefault = defaultSelected?.id === 'yes';

			// Add the model
			await aiService.addModel({
				id: modelId.trim(),
				api: apiUrl.trim(),
				apiKey,
				family,
				isDefault,
			});

			notificationService.info(localize('ai.model.added', 'Successfully added model: {0}', modelId.trim()));
		} catch (error) {
			logService.error('[AICommands] Failed to add model', error);
			notificationService.error(localize('ai.model.addError', 'Failed to add model: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
});

// Command: Manage AI Models
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.model.manage',
			title: { value: localize('ai.model.manage', 'Manage AI Models'), original: 'Manage AI Models' },
			category: { value: localize('ai.category', 'AI'), original: 'AI' },
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiService = accessor.get(IAIService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const commandService = accessor.get(ICommandService);

		const models = aiService.getModels();
		const activeModelId = aiService.getActiveModel();

		if (models.length === 0) {
			const addModel = await quickInputService.pick([{
				label: localize('ai.model.add.first', 'Add your first AI model'),
				id: 'add',
			}], {
				placeHolder: localize('ai.model.none', 'No models configured. Would you like to add one?'),
			});

			if (addModel?.id === 'add') {
				await commandService.executeCommand('ai.model.add');
			}
			return;
		}

		const items: IQuickPickItem[] = models.map(model => ({
			label: model.id,
			description: `${model.family || 'Unknown'} • ${model.id === activeModelId ? localize('ai.model.active', 'Active') : ''}`,
			id: model.id,
			buttons: [{
				iconClass: 'codicon codicon-trash',
				tooltip: localize('ai.model.delete', 'Delete'),
			}],
		}));

		items.push({
			label: `$(plus) ${localize('ai.model.add.new', 'Add New Model')}`,
			id: '__add__',
			alwaysShow: true,
		});

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('ai.model.manage.placeholder', 'Select a model to manage'),
		});

		if (!selected) {
			return;
		}

		if (selected.id === '__add__') {
			await commandService.executeCommand('ai.model.add');
			return;
		}

		// Show model actions
		const model = models.find(m => m.id === selected.id);
		if (!model) {
			return;
		}

		const actions: IQuickPickItem[] = [
			{ label: localize('ai.model.switch', 'Switch to this model'), id: 'switch' },
			{ label: localize('ai.model.setDefault', 'Set as default'), id: 'default' },
			{ label: localize('ai.model.delete', 'Delete'), id: 'delete' },
		];

		const action = await quickInputService.pick(actions, {
			placeHolder: localize('ai.model.actions.placeholder', 'What would you like to do?'),
		});

		if (!action) {
			return;
		}

		try {
			switch (action.id) {
				case 'switch':
					await aiService.setActiveModel(model.id);
					notificationService.info(localize('ai.model.switched', 'Switched to model: {0}', model.id));
					break;
				case 'default':
					await aiService.updateModel(model.id, { isDefault: true });
					notificationService.info(localize('ai.model.setDefault.success', 'Set {0} as default model', model.id));
					break;
				case 'delete':
					await aiService.removeModel(model.id);
					notificationService.info(localize('ai.model.deleted', 'Deleted model: {0}', model.id));
					break;
			}
		} catch (error) {
			logService.error('[AICommands] Failed to manage model', error);
			notificationService.error(localize('ai.model.manageError', 'Failed to {0} model: {1}', action.id, error instanceof Error ? error.message : String(error)));
		}
	}
});

