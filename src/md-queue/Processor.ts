/**
 * Processor: Processing orchestration for md-queue
 *
 * Handles the claim → execute → update workflow for queue items.
 * Supports batch processing with concurrency control.
 */

import type { AssetManager } from './AssetManager';
import type { LockManager } from './LockManager';
import type { Reconciler } from './Reconciler';
import type { StateManager } from './StateManager';
import type { ProcessOptions, ProcessReport, QueueItem } from './types';

/**
 * Orchestrates queue item processing
 */
export class Processor {
	private assetManager: AssetManager;
	private lockManager: LockManager;
	private stateManager: StateManager;
	private reconciler: Reconciler;

	constructor(
		assetManager: AssetManager,
		lockManager: LockManager,
		stateManager: StateManager,
		reconciler: Reconciler,
	) {
		this.assetManager = assetManager;
		this.lockManager = lockManager;
		this.stateManager = stateManager;
		this.reconciler = reconciler;
	}

	/**
	 * Process a single queue item
	 *
	 * Workflow:
	 * 1. Claim: Acquire lock and transition to 'processing'
	 * 2. Execute: Run the handler function
	 * 3. Update: Mark as done or error based on result
	 *
	 * @param item - Queue item to process
	 * @param handler - Async function that processes the item
	 * @returns Result from handler
	 */
	async processItem<T>(
		item: QueueItem,
		handler: (item: QueueItem) => Promise<T>,
	): Promise<T> {
		// Claim the item
		const claimed = await this.claimItem(item);
		if (!claimed) {
			throw new Error(`Failed to acquire lock on item: ${item.path}`);
		}

		try {
			// Execute handler
			const result = await handler(item);

			// Mark as done
			await this.completeSuccess(item, result);

			return result;
		}
		catch (error) {
			// Mark as error
			await this.completeError(item, error as Error);

			// Re-throw the error
			throw error;
		}
	}

	/**
	 * Process all pending items in a directory
	 *
	 * @param directory - Directory to process
	 * @param handler - Handler function for each item
	 * @param options - Processing options
	 * @returns Processing report
	 */
	async processDirectory(
		directory: string,
		handler: (item: QueueItem) => Promise<void>,
		options?: ProcessOptions,
	): Promise<ProcessReport> {
		const started_at = new Date().toISOString();
		const startTime = Date.now();

		// Find processable items
		const items = await this.reconciler.findProcessable(directory);

		// Process items with concurrency control
		const maxConcurrent = options?.maxConcurrent || 1;
		const results = await this.processWithConcurrency(
			items,
			handler,
			maxConcurrent,
		);

		const finished_at = new Date().toISOString();
		const duration = Date.now() - startTime;

		return {
			...results,
			duration,
			started_at,
			finished_at,
		};
	}

	/**
	 * Process items with concurrency control
	 *
	 * @param items - Items to process
	 * @param handler - Handler function
	 * @param maxConcurrent - Maximum concurrent processing
	 * @returns Results object
	 */
	protected async processWithConcurrency(
		items: QueueItem[],
		handler: (item: QueueItem) => Promise<void>,
		maxConcurrent: number = 1,
	): Promise<{
		processed: number;
		failed: number;
		skipped: number;
	}> {
		const results = {
			processed: 0,
			failed: 0,
			skipped: 0,
		};

		// Process items in chunks to control concurrency
		for (let i = 0; i < items.length; i += maxConcurrent) {
			const chunk = items.slice(i, i + maxConcurrent);

			// Process chunk concurrently
			await Promise.all(
				chunk.map(async (item) => {
					try {
						await this.processItem(item, handler);
						results.processed++;
					}
					catch (error) {
						// Check if this was a lock acquisition failure
						if (
							error instanceof Error
							&& error.message.includes('Failed to acquire lock')
						) {
							results.skipped++;
						}
						else {
							results.failed++;
						}
					}
				}),
			);
		}

		return results;
	}

	/**
	 * Claim an item for processing
	 *
	 * Acquires lock and transitions to 'processing' phase.
	 *
	 * @param item - Queue item to claim
	 * @returns True if claimed successfully
	 */
	protected async claimItem(item: QueueItem): Promise<boolean> {
		// Try to acquire lock
		const acquired = await this.lockManager.acquireLock(
			item,
			this.assetManager,
		);

		return acquired;
	}

	/**
	 * Execute handler with retry logic
	 *
	 * @param item - Queue item being processed
	 * @param handler - Handler function
	 * @param maxRetries - Maximum retry attempts
	 * @returns Handler result
	 */
	protected async executeWithRetry<T>(
		item: QueueItem,
		handler: (item: QueueItem) => Promise<T>,
		maxRetries: number = 3,
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await handler(item);
			}
			catch (error) {
				lastError = error as Error;

				if (attempt < maxRetries) {
					// Wait before retry (exponential backoff)
					const waitTime = 2 ** attempt * 1000; // 1s, 2s, 4s, 8s...
					await new Promise(resolve => setTimeout(resolve, waitTime));
				}
			}
		}

		// All retries exhausted
		throw lastError;
	}

	/**
	 * Complete processing successfully
	 *
	 * @param item - Queue item that was processed
	 * @param result - Processing result (e.g., transcript, caption)
	 */
	protected async completeSuccess(
		item: QueueItem,
		result: any,
	): Promise<void> {
		await this.stateManager.markDone(item, result, this.assetManager);
	}

	/**
	 * Complete processing with error
	 *
	 * @param item - Queue item that failed
	 * @param error - Error that occurred
	 */
	protected async completeError(
		item: QueueItem,
		error: Error,
	): Promise<void> {
		await this.stateManager.markError(item, error, this.assetManager);
	}

	/**
	 * Process items in batches with concurrency limit
	 *
	 * @param items - Items to process
	 * @param batchSize - Number of items per batch
	 * @param handler - Handler function
	 * @returns Processing counts
	 */
	protected async processBatches(
		items: QueueItem[],
		batchSize: number,
		handler: (item: QueueItem) => Promise<void>,
	): Promise<{
		processed: number;
		failed: number;
		skipped: number;
	}> {
		return this.processWithConcurrency(items, handler, batchSize);
	}
}
