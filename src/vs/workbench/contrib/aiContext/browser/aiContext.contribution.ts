/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { FileChangesEvent, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IContextService } from '../../../../services/ai/common/contextService.js';
import { ITextFileSaveEvent, ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';

export class AIContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aiContext';

	private readonly _indexScheduler = new Map<string, RunOnceScheduler>();

	constructor(
		@ITextFileService private readonly textFileService: ITextFileService,
		@IContextService private readonly contextService: IContextService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Index files on save
		this._register(this.textFileService.files.onDidSave((e: ITextFileSaveEvent) => {
			this.scheduleIndex(e.model.resource);
		}));

		// Index files on create and remove on delete
		this._register(this.fileService.onDidFilesChange((e: FileChangesEvent) => {
			// Handle file creation
			for (const uri of e.rawAdded) {
				if (this.shouldIndex(uri)) {
					this.scheduleIndex(uri);
				}
			}

			// Handle file deletion
			for (const uri of e.rawDeleted) {
				this.contextService.removeFile(uri);
			}
		}));

		// Rebuild index when workspace opens
		const workspace = this.workspaceContextService.getWorkspace();
		if (workspace.folders.length > 0) {
			// Initial index build happens asynchronously
			for (const folder of workspace.folders) {
				void this.contextService.rebuildIndex(folder.uri);
			}
		}
	}

	private scheduleIndex(uri: URI): void {
		if (!this.shouldIndex(uri)) {
			return;
		}

		const uriStr = uri.toString();
		let scheduler = this._indexScheduler.get(uriStr);
		if (!scheduler) {
			scheduler = new RunOnceScheduler(async () => {
				try {
					const content = await this.fileService.readFile(uri);
					await this.contextService.indexFile(uri, content.value.toString());
				} catch (error) {
					this.logService.debug(`[AIContext] Failed to index ${uri.toString()}`, error);
				} finally {
					this._indexScheduler.delete(uriStr);
				}
			}, 1000); // Debounce by 1 second
			this._indexScheduler.set(uriStr, scheduler);
			this._register(scheduler);
		}
		scheduler.schedule();
	}

	private shouldIndex(uri: URI): boolean {
		const path = uri.path.toLowerCase();
		const excludePatterns = [
			'node_modules',
			'.git',
			'out',
			'dist',
			'build',
			'.vscode',
			'package-lock.json',
			'yarn.lock',
		];

		if (excludePatterns.some(pattern => path.includes(pattern))) {
			return false;
		}

		// Index common code file extensions
		const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.rb', '.php'];
		return codeExtensions.some(ext => path.endsWith(ext));
	}
}

registerWorkbenchContribution2(AIContextContribution.ID, AIContextContribution, WorkbenchPhase.Eventually);
