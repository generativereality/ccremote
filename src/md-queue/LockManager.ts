/**
 * LockManager: Soft lock management for md-queue
 *
 * Implements soft locks using host:pid:timestamp format stored in frontmatter.
 * Supports stale lock detection and automatic cleanup.
 */

import type { AssetManager } from './AssetManager';
import type { Lock, QueueConfig, QueueItem } from './types';
import { hostname } from 'node:os';

/**
 * Manages soft locks for coordinating processing across workers
 */
export class LockManager {
	private hostname: string;
	private defaultLockTimeout: number;

	constructor(config?: Partial<QueueConfig>) {
		this.hostname = config?.hostname || this.detectHostname();
		this.defaultLockTimeout = config?.lockTimeout || 5 * 60 * 1000; // 5 minutes
	}

	/**
	 * Create a lock string for the current process
	 *
	 * @returns Lock string in format: hostname:pid:timestamp
	 */
	createLock(): string {
		return `${this.hostname}:${process.pid}:${Date.now()}`;
	}

	/**
	 * Parse a lock string into components
	 *
	 * @param lockString - Lock string to parse
	 * @returns Parsed lock object or null if invalid
	 */
	parseLock(lockString: string): Lock | null {
		const parts = lockString.split(':');
		if (parts.length !== 3) {
			return null;
		}

		const [host, pidStr, timestampStr] = parts;
		const pid = Number.parseInt(pidStr, 10);
		const timestamp = Number.parseInt(timestampStr, 10);

		if (isNaN(pid) || isNaN(timestamp)) {
			return null;
		}

		return { host, pid, timestamp };
	}

	/**
	 * Check if a lock is stale (exceeded timeout)
	 *
	 * @param lockString - Lock string to check
	 * @param timeoutMs - Optional timeout override (defaults to config)
	 * @returns True if lock is stale
	 */
	isStale(lockString: string, timeoutMs?: number): boolean {
		const lock = this.parseLock(lockString);
		if (!lock) {
			return true; // Invalid lock is considered stale
		}

		const timeout = timeoutMs ?? this.defaultLockTimeout;
		const now = Date.now();
		return now - lock.timestamp > timeout;
	}

	/**
	 * Check if a lock belongs to the current process
	 *
	 * @param lockString - Lock string to check
	 * @returns True if lock is owned by current process
	 */
	isOwnLock(lockString: string): boolean {
		const lock = this.parseLock(lockString);
		if (!lock) {
			return false;
		}

		return lock.host === this.hostname && lock.pid === process.pid;
	}

	/**
	 * Attempt to acquire a lock on an item
	 *
	 * @param item - Queue item to lock
	 * @param assetManager - AssetManager for updating frontmatter
	 * @returns True if lock was acquired, false if already locked
	 */
	async acquireLock(
		item: QueueItem,
		assetManager: AssetManager,
	): Promise<boolean> {
		const currentLock = item.frontmatter.status.lock;

		// Check if already locked by another process
		if (currentLock) {
			// Check if it's our own lock
			if (this.isOwnLock(currentLock)) {
				// Already have the lock, nothing to do
				return true;
			}

			// Check if the lock is stale
			if (!this.isStale(currentLock)) {
				// Lock is held by another process and not stale
				return false;
			}
		}

		// Create new lock
		const newLock = this.createLock();

		// Update item frontmatter with lock and processing status
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				lock: newLock,
				phase: 'processing',
				last_update: new Date().toISOString(),
				attempts: item.frontmatter.status.attempts + 1,
			},
		});

		return true;
	}

	/**
	 * Release a lock on an item
	 *
	 * @param item - Queue item to unlock
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async releaseLock(
		item: QueueItem,
		assetManager: AssetManager,
	): Promise<void> {
		const currentLock = item.frontmatter.status.lock;

		if (!currentLock) {
			// No lock to release
			return;
		}

		// Verify we own the lock
		if (!this.isOwnLock(currentLock)) {
			throw new Error(
				`Cannot release lock owned by another process: ${currentLock}`,
			);
		}

		// Release the lock
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				lock: null,
			},
		});
	}

	/**
	 * Reset a stale lock (for reconciliation)
	 *
	 * @param item - Queue item with stale lock
	 * @param assetManager - AssetManager for updating frontmatter
	 */
	async resetStaleLock(
		item: QueueItem,
		assetManager: AssetManager,
	): Promise<void> {
		const currentLock = item.frontmatter.status.lock;

		if (!currentLock) {
			return;
		}

		// Verify lock is actually stale
		if (!this.isStale(currentLock)) {
			throw new Error(`Cannot reset non-stale lock: ${currentLock}`);
		}

		// Reset to pending state
		await assetManager.updateFrontmatter(item.path, {
			status: {
				...item.frontmatter.status,
				lock: null,
				phase: 'pending',
				last_update: new Date().toISOString(),
			},
		});
	}

	/**
	 * Check if an item is currently locked by another process
	 *
	 * @param item - Queue item to check
	 * @returns True if locked by another process (not stale)
	 */
	isLockedByOther(item: QueueItem): boolean {
		const currentLock = item.frontmatter.status.lock;

		if (!currentLock) {
			return false;
		}

		// Check if it's our own lock
		if (this.isOwnLock(currentLock)) {
			return false;
		}

		// Check if the lock is stale
		if (this.isStale(currentLock)) {
			return false;
		}

		// Locked by another process and not stale
		return true;
	}

	/**
	 * Detect hostname for locks
	 *
	 * @returns Hostname string
	 */
	private detectHostname(): string {
		try {
			return hostname();
		}
		catch {
			return 'unknown';
		}
	}
}
