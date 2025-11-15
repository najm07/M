/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import { AIDiff } from './aiTypes.js';

export const IAIDiffReviewService = createDecorator<IAIDiffReviewService>('aiDiffReviewService');

export interface AIDiffReview {
	readonly id: string;
	readonly diff: AIDiff;
	readonly originalUri: URI;
	readonly modifiedUri: URI;
	readonly status: AIDiffReviewStatus;
	readonly createdAt: number;
	readonly metadata?: Record<string, unknown>;
}

export enum AIDiffReviewStatus {
	Pending = 'pending',
	Reviewing = 'reviewing',
	Accepted = 'accepted',
	Rejected = 'rejected',
	PartiallyAccepted = 'partiallyAccepted',
}

export interface AIDiffReviewOptions {
	readonly openInDiffEditor?: boolean;
	readonly sideBySide?: boolean;
	readonly showAcceptRejectButtons?: boolean;
	readonly autoFocus?: boolean;
}

export interface IAIDiffReviewService {
	readonly _serviceBrand: undefined;

	readonly onDidReviewChange: Event<AIDiffReview>;
	readonly onDidReviewComplete: Event<AIDiffReview>;

	/**
	 * Show a diff for review before applying AI changes
	 */
	showDiffForReview(
		diff: AIDiff,
		options?: AIDiffReviewOptions,
		token?: CancellationToken
	): Promise<AIDiffReview>;

	/**
	 * Get all pending reviews
	 */
	getPendingReviews(): AIDiffReview[];

	/**
	 * Get a specific review by ID
	 */
	getReview(reviewId: string): AIDiffReview | undefined;

	/**
	 * Accept a diff review (apply changes)
	 */
	acceptReview(reviewId: string, token?: CancellationToken): Promise<void>;

	/**
	 * Reject a diff review (discard changes)
	 */
	rejectReview(reviewId: string, token?: CancellationToken): Promise<void>;

	/**
	 * Accept only specific hunks from a diff
	 */
	acceptPartialReview(reviewId: string, hunkIndices: number[], token?: CancellationToken): Promise<void>;

	/**
	 * Close a review without accepting or rejecting
	 */
	closeReview(reviewId: string): void;
}

