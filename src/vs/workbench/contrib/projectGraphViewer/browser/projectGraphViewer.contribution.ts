/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { IProjectGraphService } from '../../../../services/ai/common/projectGraphService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ProjectGraphViewer } from './projectGraphViewer.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';

class ProjectGraphViewerService {
	constructor(
		@IWebviewService private readonly webviewOverlayService: IWebviewService,
		@IProjectGraphService private readonly projectGraphService: IProjectGraphService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async showGraph(): Promise<void> {
		const viewer = new ProjectGraphViewer(
			this.webviewOverlayService,
			this.projectGraphService,
			this.workspaceContextService,
			this.logService,
			this.editorService,
			this.instantiationService
		);
		await viewer.showGraph();
	}
}

registerAction2(class ShowProjectGraphAction extends Action2 {
	constructor() {
		super({
			id: 'ai.showProjectGraph',
			title: {
				value: localize('showProjectGraph', 'Show Project Graph'),
				original: 'Show Project Graph'
			},
			category: {
				value: localize('ai', 'AI'),
				original: 'AI'
			},
			f1: true,
			keybinding: {
				weight: 100,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const instantiationService = accessor.get(IInstantiationService);
		const viewerService = instantiationService.createInstance(ProjectGraphViewerService);
		await viewerService.showGraph();
	}
});

