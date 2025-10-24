/**
 * StateManager: State machine transitions for md-queue
 *
 * Handles transitions between phases: pending → processing → done/error
 * Supports reprocessing by resetting items back to pending.
 */

import type { AssetManager } from './AssetManager';
import type { Phase, PreviousAttempt, QueueItem } from './types';

/**
 * Manages state transitions for queue items
 */
export class StateManager {
	/**
	 * Transition an item to a new phase
	 *
	 * @param item - Queue item to transition
	 * @param newPhase - Target phase
	 * @param metadata - Additional metadata to merge into frontmatter
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async transition(
		item: QueueItem,
		newPhase: Phase,
		metadata: Record<string, any> = {},
		assetManager: AssetManager,
	): Promise<void> {
		// Validate transition is allowed
		this.validateTransition(item.frontmatter.status.phase, newPhase);

		// Update status
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				phase: newPhase,
				last_update: new Date().toISOString(),
			},
			...metadata,
		});
	}

	/**
	 * Mark item as done (successful processing)
	 *
	 * @param item - Queue item to mark done
	 * @param result - Optional result data to store in frontmatter
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async markDone(
		item: QueueItem,
		result: Record<string, any> = {},
		assetManager: AssetManager,
	): Promise<void> {
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				phase: 'done',
				lock: null,
				last_update: new Date().toISOString(),
			},
			...result,
		});
	}

	/**
	 * Mark item as error (processing failed)
	 *
	 * @param item - Queue item to mark error
	 * @param error - Error that occurred
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async markError(
		item: QueueItem,
		error: Error,
		assetManager: AssetManager,
	): Promise<void> {
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				phase: 'error',
				lock: null,
				last_update: new Date().toISOString(),
				last_error: error.message,
			},
		});
	}

	/**
	 * Reset item to pending (for reprocessing)
	 *
	 * @param item - Queue item to reset
	 * @param reason - Reason for reprocessing
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async resetToPending(
		item: QueueItem,
		reason: string,
		assetManager: AssetManager,
	): Promise<void> {
		// Archive current state to previous_attempts
		const previousAttempt = this.archiveCurrentAttempt(item);
		const previousAttempts = item.frontmatter.previous_attempts || [];

		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				phase: 'pending',
				lock: null,
				last_update: new Date().toISOString(),
				reprocess_reason: reason,
				attempts: 0, // Reset attempts for reprocessing
				last_error: undefined, // Clear error
			},
			previous_attempts: [...previousAttempts, previousAttempt],
		});
	}

	/**
	 * Archive current processing attempt to history
	 *
	 * @param item - Queue item to archive
	 * @returns Previous attempt record
	 */
	protected archiveCurrentAttempt(item: QueueItem): PreviousAttempt {
		const attempt: PreviousAttempt = {
			phase: item.frontmatter.status.phase,
			at: new Date().toISOString(),
		};

		// Include error message if phase is error
		if (item.frontmatter.status.phase === 'error' && item.frontmatter.status.last_error) {
			attempt.error = item.frontmatter.status.last_error;
		}

		// Include model information if available
		if (item.frontmatter.models) {
			// Check for whisper model
			if (item.frontmatter.models.whisper) {
				attempt.model = item.frontmatter.models.whisper.model;
				attempt.detected_language = item.frontmatter.models.whisper.detected_language;
				attempt.confidence = item.frontmatter.models.whisper.confidence;
			}
			// Check for vision_caption model
			else if (item.frontmatter.models.vision_caption) {
				attempt.model = item.frontmatter.models.vision_caption.model;
			}
		}

		return attempt;
	}

	/**
	 * Validate state transition is allowed
	 *
	 * @param currentPhase - Current phase
	 * @param newPhase - Target phase
	 * @throws Error if transition is not allowed
	 */
	protected validateTransition(currentPhase: Phase, newPhase: Phase): void {
		const validTransitions: Record<Phase, Phase[]> = {
			pending: ['processing'],
			processing: ['done', 'error'],
			done: ['pending'], // Allow reprocessing
			error: ['pending'], // Allow retry
		};

		const allowedTargets = validTransitions[currentPhase];
		if (!allowedTargets.includes(newPhase)) {
			throw new Error(
				`Invalid state transition: ${currentPhase} → ${newPhase}`,
			);
		}
	}

	/**
	 * Check if item has exceeded max retry attempts
	 *
	 * @param item - Queue item to check
	 * @param maxRetries - Maximum retry attempts (default: 3)
	 * @returns True if max retries exceeded
	 */
	hasExceededRetries(item: QueueItem, maxRetries: number = 3): boolean {
		return item.frontmatter.status.attempts > maxRetries;
	}

	/**
	 * Increment attempt counter
	 *
	 * @param item - Queue item to update
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async incrementAttempts(
		item: QueueItem,
		assetManager: AssetManager,
	): Promise<void> {
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				attempts: item.frontmatter.status.attempts + 1,
			},
		});
	}
}
