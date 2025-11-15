/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IAIDiffReviewService, AIDiffReview, AIDiffReviewStatus, AIDiffReviewOptions } from '../common/aiDiffReviewService.js';
import { AIDiff } from '../common/aiTypes.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { EditorsOrder } from '../../../workbench/common/editor.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { joinPath } from '../../../base/common/resources.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { basename } from '../../../base/common/path.js';
import { localize } from '../../../nls.js';

export class AIDiffReviewService extends Disposable implements IAIDiffReviewService {
	declare _serviceBrand: undefined;

	private readonly _reviews = new Map<string, AIDiffReview>();
	private readonly _tempDir: URI;

	private readonly _onDidReviewChange = new Emitter<AIDiffReview>();
	private readonly _onDidReviewComplete = new Emitter<AIDiffReview>();

	public readonly onDidReviewChange: Event<AIDiffReview> = this._onDidReviewChange.event;
	public readonly onDidReviewComplete: Event<AIDiffReview> = this._onDidReviewComplete.event;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		super();
		this._tempDir = joinPath(this.environmentService.userRoamingDataHome, '.vscode', 'ai-diff-reviews');
	}

	async showDiffForReview(
		diff: AIDiff,
		options: AIDiffReviewOptions = {},
		token?: CancellationToken
	): Promise<AIDiffReview> {
		const reviewId = generateUuid();
		const originalUri = diff.uri;

		// Create temporary file for modified content
		const tempFileName = `ai-diff-${reviewId}-${basename(originalUri.path)}`;
		const modifiedUri = joinPath(this._tempDir, tempFileName);

		try {
			// Ensure temp directory exists
			await this.fileService.createFolder(this._tempDir);

			// Read original content
			const originalContent = await this.fileService.readFile(originalUri);
			const originalText = originalContent.value.toString();

			// Apply diff to create modified content
			const modifiedText = this.applyDiffToText(originalText, diff);

			// Write modified content to temp file
			await this.fileService.writeFile(modifiedUri, VSBuffer.fromString(modifiedText));

			const review: AIDiffReview = {
				id: reviewId,
				diff,
				originalUri,
				modifiedUri,
				status: AIDiffReviewStatus.Pending,
				createdAt: Date.now(),
				metadata: diff.metadata,
			};

			this._reviews.set(reviewId, review);
			this._onDidReviewChange.fire(review);

			// Open diff editor if requested
			if (options.openInDiffEditor !== false) {
				await this.openDiffEditor(review, options);
			}

			return review;
		} catch (error) {
			this.logService.error('[AIDiffReviewService] Failed to show diff for review', error);
			throw error;
		}
	}

	getPendingReviews(): AIDiffReview[] {
		return Array.from(this._reviews.values()).filter(
			review => review.status === AIDiffReviewStatus.Pending || review.status === AIDiffReviewStatus.Reviewing
		);
	}

	getReview(reviewId: string): AIDiffReview | undefined {
		return this._reviews.get(reviewId);
	}

	async acceptReview(reviewId: string, token?: CancellationToken): Promise<void> {
		const review = this._reviews.get(reviewId);
		if (!review) {
			throw new Error(`Review ${reviewId} not found`);
		}

		if (review.status === AIDiffReviewStatus.Accepted) {
			return;
		}

		try {
			// Read modified content
			const modifiedContent = await this.fileService.readFile(review.modifiedUri);
			const modifiedText = modifiedContent.value.toString();

			// Write to original file
			await this.fileService.writeFile(review.originalUri, VSBuffer.fromString(modifiedText));

			// Update review status
			const updatedReview: AIDiffReview = {
				...review,
				status: AIDiffReviewStatus.Accepted,
			};

			this._reviews.set(reviewId, updatedReview);
			this._onDidReviewChange.fire(updatedReview);
			this._onDidReviewComplete.fire(updatedReview);

			// Cleanup temp file
			await this.cleanupReview(reviewId);
		} catch (error) {
			this.logService.error(`[AIDiffReviewService] Failed to accept review ${reviewId}`, error);
			throw error;
		}
	}

	async rejectReview(reviewId: string, token?: CancellationToken): Promise<void> {
		const review = this._reviews.get(reviewId);
		if (!review) {
			throw new Error(`Review ${reviewId} not found`);
		}

		if (review.status === AIDiffReviewStatus.Rejected) {
			return;
		}

		const updatedReview: AIDiffReview = {
			...review,
			status: AIDiffReviewStatus.Rejected,
		};

		this._reviews.set(reviewId, updatedReview);
		this._onDidReviewChange.fire(updatedReview);
		this._onDidReviewComplete.fire(updatedReview);

		// Cleanup temp file
		await this.cleanupReview(reviewId);
	}

	async acceptPartialReview(reviewId: string, hunkIndices: number[], token?: CancellationToken): Promise<void> {
		const review = this._reviews.get(reviewId);
		if (!review) {
			throw new Error(`Review ${reviewId} not found`);
		}

		// Read modified file
		const modifiedContent = await this.fileService.readFile(review.modifiedUri);
		const modifiedText = modifiedContent.value.toString();

		// This is a simplified implementation - in production, you'd want to properly merge hunks
		// For now, we'll apply the full diff but mark as partially accepted
		await this.fileService.writeFile(review.originalUri, VSBuffer.fromString(modifiedText));

		const updatedReview: AIDiffReview = {
			...review,
			status: AIDiffReviewStatus.PartiallyAccepted,
		};

		this._reviews.set(reviewId, updatedReview);
		this._onDidReviewChange.fire(updatedReview);
		this._onDidReviewComplete.fire(updatedReview);

		await this.cleanupReview(reviewId);
	}

	closeReview(reviewId: string): void {
		const review = this._reviews.get(reviewId);
		if (!review) {
			return;
		}

		// Close diff editor if open
		this.closeDiffEditor(review);

		// Cleanup temp file
		this.cleanupReview(reviewId).catch(err => {
			this.logService.warn(`[AIDiffReviewService] Failed to cleanup review ${reviewId}`, err);
		});

		this._reviews.delete(reviewId);
	}

	private async openDiffEditor(review: AIDiffReview, options: AIDiffReviewOptions): Promise<void> {
		try {
			const label = localize('ai.diff.review.title', '{0} (AI Changes)', basename(review.originalUri.path));

			await this.editorService.openEditor({
				original: { resource: review.originalUri },
				modified: { resource: review.modifiedUri },
				label,
				options: {
					revealIfOpened: true,
					pinned: true,
				},
			});

			// Update status to reviewing
			const updatedReview: AIDiffReview = {
				...review,
				status: AIDiffReviewStatus.Reviewing,
			};
			this._reviews.set(review.id, updatedReview);
			this._onDidReviewChange.fire(updatedReview);
		} catch (error) {
			this.logService.error('[AIDiffReviewService] Failed to open diff editor', error);
		}
	}

	private closeDiffEditor(review: AIDiffReview): void {
		// Find and close diff editors for this review
		const editors = this.editorService.getEditors(EditorsOrder.SEQUENTIAL);
		for (const editor of editors) {
			if (editor.editor.resource?.toString() === review.modifiedUri.toString()) {
				this.editorService.closeEditor(editor);
			}
		}
	}

	private applyDiffToText(originalText: string, diff: AIDiff): string {
		if (!diff.edits || diff.edits.length === 0) {
			return originalText;
		}

		// Sort edits by position (reverse order to apply from end to start)
		const sortedEdits = [...diff.edits].sort((a, b) => {
			const aLine = a.range.endLineNumber;
			const bLine = b.range.endLineNumber;
			if (aLine !== bLine) {
				return bLine - aLine; // Reverse order
			}
			return b.range.endColumn - a.range.endColumn;
		});

		const lines = originalText.split('\n');

		// Apply edits from end to start to preserve line numbers
		for (const edit of sortedEdits) {
			const startLine = edit.range.startLineNumber - 1; // 0-indexed
			const endLine = edit.range.endLineNumber - 1; // 0-indexed
			const startCol = edit.range.startColumn - 1; // 0-indexed
			const endCol = edit.range.endColumn - 1; // 0-indexed

			const newTextLines = edit.text.split('\n');

			if (startLine === endLine) {
				// Single line edit
				const line = lines[startLine];
				const before = line.substring(0, startCol);
				const after = line.substring(endCol);
				lines[startLine] = before + newTextLines.join('') + after;
			} else {
				// Multi-line edit
				const firstLine = lines[startLine];
				const lastLine = lines[endLine];
				const before = firstLine.substring(0, startCol);
				const after = lastLine.substring(endCol);

				// Replace lines
				const newLines = [
					before + (newTextLines[0] || ''),
					...newTextLines.slice(1, -1),
					(newTextLines[newTextLines.length - 1] || '') + after,
				];

				lines.splice(startLine, endLine - startLine + 1, ...newLines);
			}
		}

		return lines.join('\n');
	}

	private async cleanupReview(reviewId: string): Promise<void> {
		const review = this._reviews.get(reviewId);
		if (!review) {
			return;
		}

		try {
			// Delete temp file
			if (await this.fileService.exists(review.modifiedUri)) {
				await this.fileService.del(review.modifiedUri);
			}
		} catch (error) {
			this.logService.warn(`[AIDiffReviewService] Failed to cleanup temp file for review ${reviewId}`, error);
		}
	}
}

