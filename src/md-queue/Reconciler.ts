/**
 * Reconciler: Directory sweep and reconciliation for md-queue
 *
 * Finds queue items in directories, identifies stale locks,
 * and provides reconciliation reports.
 */

import type { AssetManager } from './AssetManager';
import type { LockManager } from './LockManager';
import type { StateManager } from './StateManager';
import type {
	FilterOptions,
	QueueConfig,
	QueueItem,
	ReconciliationReport,
} from './types';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Handles directory sweeps and reconciliation
 */
export class Reconciler {
	private assetManager: AssetManager;
	private lockManager: LockManager;
	private stateManager: StateManager;

	constructor(
		assetManager: AssetManager,
		lockManager: LockManager,
		stateManager: StateManager,
		config?: Partial<QueueConfig>,
	) {
		this.assetManager = assetManager;
		this.lockManager = lockManager;
		this.stateManager = stateManager;
	}

	/**
	 * Find all markdown files in a directory (recursive)
	 *
	 * @param directory - Directory to search
	 * @param filter - Optional filter criteria
	 * @returns Array of queue items
	 */
	async findItems(
		directory: string,
		filter?: FilterOptions,
	): Promise<QueueItem[]> {
		// Find all markdown files
		const markdownFiles = await this.findMarkdownFiles(directory);

		// Read and parse each file
		const items: QueueItem[] = [];
		for (const filePath of markdownFiles) {
			try {
				const item = await this.assetManager.read(filePath);
				if (item && this.matchesFilter(item, filter)) {
					items.push(item);
				}
			}
			catch (error) {
				// Skip files that can't be parsed
				console.error(`Failed to read ${filePath}:`, error);
			}
		}

		// Apply limit if specified
		if (filter?.limit) {
			return items.slice(0, filter.limit);
		}

		return items;
	}

	/**
	 * Find items in pending phase
	 *
	 * @param directory - Directory to search
	 * @returns Array of pending items
	 */
	async findPending(directory: string): Promise<QueueItem[]> {
		return this.findItems(directory, { phase: 'pending' });
	}

	/**
	 * Find items with stale locks
	 *
	 * @param directory - Directory to search
	 * @param timeoutMs - Lock timeout (optional, uses default)
	 * @returns Array of items with stale locks
	 */
	async findStale(
		directory: string,
		timeoutMs?: number,
	): Promise<QueueItem[]> {
		// Find all items in processing phase
		const processingItems = await this.findItems(directory, { phase: 'processing' });

		// Filter by stale locks
		return processingItems.filter((item) => {
			const lock = item.frontmatter.status.lock;
			return lock && this.lockManager.isStale(lock, timeoutMs);
		});
	}

	/**
	 * Find items in error phase
	 *
	 * @param directory - Directory to search
	 * @returns Array of error items
	 */
	async findErrors(directory: string): Promise<QueueItem[]> {
		return this.findItems(directory, { phase: 'error' });
	}

	/**
	 * Reconcile a directory (find and reset stale locks)
	 *
	 * @param directory - Directory to reconcile
	 * @returns Reconciliation report
	 */
	async reconcile(directory: string): Promise<ReconciliationReport> {
		// Find all items
		const allItems = await this.findItems(directory);

		// Count by phase
		const stats = {
			pending: 0,
			processing: 0,
			done: 0,
			error: 0,
			staleReset: 0,
		};

		for (const item of allItems) {
			const phase = item.frontmatter.status.phase;
			stats[phase]++;
		}

		// Find and reset stale locks
		const staleItems = await this.findStale(directory);
		for (const item of staleItems) {
			await this.lockManager.resetStaleLock(item, this.assetManager);
			stats.staleReset++;
		}

		return {
			...stats,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Find items that can be processed now
	 *
	 * Returns items in pending phase that are not locked.
	 *
	 * @param directory - Directory to search
	 * @param limit - Maximum items to return
	 * @returns Array of processable items
	 */
	async findProcessable(
		directory: string,
		limit?: number,
	): Promise<QueueItem[]> {
		// Find pending items
		const pendingItems = await this.findPending(directory);

		// Filter out items locked by other processes
		const processable = pendingItems.filter(
			item => !this.lockManager.isLockedByOther(item),
		);

		// Apply limit if specified
		if (limit) {
			return processable.slice(0, limit);
		}

		return processable;
	}

	/**
	 * Get queue statistics for a directory
	 *
	 * @param directory - Directory to analyze
	 * @returns Statistics object
	 */
	async getStats(directory: string): Promise<{
		total: number;
		pending: number;
		processing: number;
		done: number;
		error: number;
		stale: number;
	}> {
		// Find all items
		const allItems = await this.findItems(directory);

		// Initialize counts
		const stats = {
			total: allItems.length,
			pending: 0,
			processing: 0,
			done: 0,
			error: 0,
			stale: 0,
		};

		// Count by phase and stale locks
		for (const item of allItems) {
			const phase = item.frontmatter.status.phase;
			stats[phase]++;

			// Check for stale lock
			if (phase === 'processing') {
				const lock = item.frontmatter.status.lock;
				if (lock && this.lockManager.isStale(lock)) {
					stats.stale++;
				}
			}
		}

		return stats;
	}

	/**
	 * Recursively find all .md files in a directory
	 *
	 * @param directory - Directory to search
	 * @returns Array of absolute file paths
	 */
	protected async findMarkdownFiles(directory: string): Promise<string[]> {
		const results: string[] = [];

		try {
			// Check if directory exists
			await fs.access(directory);

			// Read directory contents
			const entries = await fs.readdir(directory, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(directory, entry.name);

				if (entry.isDirectory()) {
					// Recurse into subdirectories
					const subResults = await this.findMarkdownFiles(fullPath);
					results.push(...subResults);
				}
				else if (entry.isFile() && entry.name.endsWith('.md')) {
					// Exclude .tmp files
					if (!entry.name.endsWith('.tmp')) {
						results.push(fullPath);
					}
				}
			}
		}
		catch (error: any) {
			// If directory doesn't exist, return empty array
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}

		return results;
	}

	/**
	 * Apply filter criteria to an item
	 *
	 * @param item - Queue item to check
	 * @param filter - Filter criteria
	 * @returns True if item matches filter
	 */
	protected matchesFilter(
		item: QueueItem,
		filter?: FilterOptions,
	): boolean {
		if (!filter) {
			return true;
		}

		// Check phase filter
		if (filter.phase) {
			const phases = Array.isArray(filter.phase) ? filter.phase : [filter.phase];
			if (!phases.includes(item.frontmatter.status.phase)) {
				return false;
			}
		}

		// Check type filter
		if (filter.type) {
			const types = Array.isArray(filter.type) ? filter.type : [filter.type];
			if (!types.includes(item.frontmatter.type)) {
				return false;
			}
		}

		// Check priority filter
		if (filter.priority && item.frontmatter.priority !== filter.priority) {
			return false;
		}

		// Check includeDone filter
		if (filter.includeDone === false && item.frontmatter.status.phase === 'done') {
			return false;
		}

		// Check includeError filter
		if (filter.includeError === false && item.frontmatter.status.phase === 'error') {
			return false;
		}

		return true;
	}
}
