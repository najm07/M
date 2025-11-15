/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize } from '../../../../nls.js';
import { IAIDiffReviewService } from '../../../../services/ai/common/aiDiffReviewService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.diffReview.accept',
			title: { value: localize('ai.diffReview.accept', 'Accept AI Changes'), original: 'Accept AI Changes' },
			category: localize('ai.category', 'AI'),
			icon: { id: 'check' },
		});
	}

	async run(accessor: ServicesAccessor, reviewId?: string): Promise<void> {
		const diffReviewService = accessor.get(IAIDiffReviewService);
		const notificationService = accessor.get(INotificationService);

		if (!reviewId) {
			// Show picker for pending reviews
			const pendingReviews = diffReviewService.getPendingReviews();
			if (pendingReviews.length === 0) {
				notificationService.info(localize('ai.diffReview.noPending', 'No pending AI diff reviews'));
				return;
			}

			const quickInputService = accessor.get(IQuickInputService);
			const items: IQuickPickItem[] = pendingReviews.map(review => ({
				label: review.diff.title || review.originalUri.path,
				description: review.diff.description,
				id: review.id,
			}));

			const selected = await quickInputService.pick(items, {
				placeHolder: localize('ai.diffReview.select', 'Select a review to accept'),
			});

			if (!selected || !selected.id) {
				return;
			}

			reviewId = selected.id;
		}

		try {
			await diffReviewService.acceptReview(reviewId);
			notificationService.info(localize('ai.diffReview.accepted', 'AI changes accepted'));
		} catch (error) {
			notificationService.error(localize('ai.diffReview.acceptFailed', 'Failed to accept changes: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.diffReview.reject',
			title: { value: localize('ai.diffReview.reject', 'Reject AI Changes'), original: 'Reject AI Changes' },
			category: localize('ai.category', 'AI'),
			icon: { id: 'x' },
		});
	}

	async run(accessor: ServicesAccessor, reviewId?: string): Promise<void> {
		const diffReviewService = accessor.get(IAIDiffReviewService);
		const notificationService = accessor.get(INotificationService);

		if (!reviewId) {
			const pendingReviews = diffReviewService.getPendingReviews();
			if (pendingReviews.length === 0) {
				notificationService.info(localize('ai.diffReview.noPending', 'No pending AI diff reviews'));
				return;
			}

			const quickInputService = accessor.get(IQuickInputService);
			const items: IQuickPickItem[] = pendingReviews.map(review => ({
				label: review.diff.title || review.originalUri.path,
				description: review.diff.description,
				id: review.id,
			}));

			const selected = await quickInputService.pick(items, {
				placeHolder: localize('ai.diffReview.selectReject', 'Select a review to reject'),
			});

			if (!selected || !selected.id) {
				return;
			}

			reviewId = selected.id;
		}

		try {
			await diffReviewService.rejectReview(reviewId);
			notificationService.info(localize('ai.diffReview.rejected', 'AI changes rejected'));
		} catch (error) {
			notificationService.error(localize('ai.diffReview.rejectFailed', 'Failed to reject changes: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ai.diffReview.showPending',
			title: { value: localize('ai.diffReview.showPending', 'Show Pending AI Reviews'), original: 'Show Pending AI Reviews' },
			category: localize('ai.category', 'AI'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const diffReviewService = accessor.get(IAIDiffReviewService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const pendingReviews = diffReviewService.getPendingReviews();
		if (pendingReviews.length === 0) {
			notificationService.info(localize('ai.diffReview.noPending', 'No pending AI diff reviews'));
			return;
		}

		const items: IQuickPickItem[] = pendingReviews.map(review => ({
			label: review.diff.title || review.originalUri.path,
			description: review.diff.description,
			id: review.id,
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: localize('ai.diffReview.selectToOpen', 'Select a review to open'),
		});

		if (selected && selected.id) {
			const review = diffReviewService.getReview(selected.id);
			if (review) {
				await diffReviewService.showDiffForReview(review.diff, { openInDiffEditor: true });
			}
		}
	}
});

