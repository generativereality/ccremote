/**
 * md-queue: Markdown-Based Queue System
 *
 * A unified queue implementation using markdown files with YAML frontmatter
 * for state persistence. Works with both Bun (ccremote) and Node (Electron).
 *
 * @example
 * ```typescript
 * import { createQueue } from 'md-queue';
 *
 * // Initialize queue
 * const queue = createQueue({ basePath: '/path/to/vault' });
 *
 * // Find pending items
 * const pending = await queue.reconciler.findPending('_q/high');
 *
 * // Process items
 * for (const item of pending) {
 *   await queue.processor.processItem(item, async (item) => {
 *     // Your processing logic here
 *     console.log('Processing:', item.path);
 *   });
 * }
 * ```
 */

import type { Frontmatter, Lock, QueueConfig } from './types';
// Export all types
// Import managers for createQueue
import { AssetManager } from './AssetManager';
import { LockManager } from './LockManager';
import { Processor } from './Processor';
import { Reconciler } from './Reconciler';
import { StateManager } from './StateManager';

// Export managers
export { AssetManager } from './AssetManager';

export { LockManager } from './LockManager';
export { Processor } from './Processor';
export { Reconciler } from './Reconciler';
export { StateManager } from './StateManager';
export * from './types';

// Re-export commonly used types for convenience
export type {
	FilterOptions,
	Frontmatter,
	Lock,
	ModelResult,
	Phase,
	ProcessOptions,
	ProcessReport,
	QueueConfig,
	QueueItem,
	ReconciliationReport,
	Status,
} from './types';

/**
 * Queue instance with all managers
 */
export type Queue = {
	assetManager: AssetManager;
	lockManager: LockManager;
	stateManager: StateManager;
	reconciler: Reconciler;
	processor: Processor;
	config: QueueConfig;
};

/**
 * Create a fully initialized queue instance
 *
 * @param config - Queue configuration
 * @returns Queue instance with all managers
 *
 * @example
 * ```typescript
 * const queue = createQueue({
 *   basePath: '/Users/me/vault',
 *   lockTimeout: 5 * 60 * 1000, // 5 minutes
 *   maxRetries: 3
 * });
 * ```
 */
export function createQueue(config: QueueConfig): Queue {
	// Create managers
	const assetManager = new AssetManager();
	const lockManager = new LockManager(config);
	const stateManager = new StateManager();
	const reconciler = new Reconciler(assetManager, lockManager, stateManager, config);
	const processor = new Processor(assetManager, lockManager, stateManager, reconciler);

	return {
		assetManager,
		lockManager,
		stateManager,
		reconciler,
		processor,
		config,
	};
}

/**
 * Helper: Create a basic queue item frontmatter
 *
 * @param type - Item type (e.g., 'voice_memo', 'photo', 'rollup')
 * @param sourcePath - Path to source file (optional)
 * @returns Initialized frontmatter object
 */
export function createFrontmatter(
	type: string,
	sourcePath?: string,
): Frontmatter {
	return {
		type,
		status: {
			phase: 'pending',
			last_update: new Date().toISOString(),
			attempts: 0,
			lock: null,
		},
		source: sourcePath
			? {
					path: sourcePath,
				}
			: undefined,
		timestamp: new Date().toISOString(),
	};
}

/**
 * Helper: Parse lock string to Lock object
 *
 * @param lockString - Lock string (host:pid:timestamp)
 * @returns Parsed lock or null
 */
export function parseLock(lockString: string): Lock | null {
	const parts = lockString.split(':');
	if (parts.length !== 3) {
		return null;
	}

	const [host, pidStr, timestampStr] = parts;
	const pid = Number.parseInt(pidStr, 10);
	const timestamp = Number.parseInt(timestampStr, 10);

	if (Number.isNaN(pid) || Number.isNaN(timestamp)) {
		return null;
	}

	return { host, pid, timestamp };
}

/**
 * Helper: Check if a lock is stale
 *
 * @param lockString - Lock string to check
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @returns True if stale
 */
export function isLockStale(
	lockString: string,
	timeoutMs: number = 5 * 60 * 1000,
): boolean {
	const lock = parseLock(lockString);
	if (!lock) {
		return true; // Invalid lock is considered stale
	}

	const now = Date.now();
	return now - lock.timestamp > timeoutMs;
}
