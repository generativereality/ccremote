/**
 * @fileoverview Logging utilities for the ccremote application
 *
 * This module provides configured logger instances using consola for consistent
 * logging throughout the application with package name tagging and environment
 * variable control for silent mode during tmux attachment.
 *
 * @module logger
 */

import type { ConsolaInstance } from 'consola';
import process from 'node:process';
import { consola } from 'consola';
import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// Read package name from package.json
const packagePath = join(import.meta.dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
const packageName = packageJson.name || 'ccremote';

/**
 * Application logger instance with package name tag
 */
export const logger: ConsolaInstance = consola.withTag(packageName);

// Apply LOG_LEVEL environment variable if set
if (process.env.LOG_LEVEL != null) {
	const level = Number.parseInt(process.env.LOG_LEVEL, 10);
	if (!Number.isNaN(level)) {
		logger.level = level;
	}
}

/**
 * Direct console.log function for cases where logger formatting is not desired
 */
// eslint-disable-next-line no-console
export const log = console.log;

// Global state for file logging
let sessionLogFile: string | null = null;

/**
 * Set logger to silent mode (level 0) to suppress console output
 * This is used when attaching to tmux to avoid garbling the output
 */
export function setSilentMode(silent: boolean): void {
	logger.level = silent ? 0 : 3; // 0 = silent, 3 = info level (consola default)
}

/**
 * Configure session-specific file logging
 * All subsequent logger calls will also write to the specified file
 */
export function setSessionLogFile(logFile: string | null): void {
	sessionLogFile = logFile;
}

/**
 * Enhanced logger that writes to both console (when not silent) and session file
 */
export const sessionLogger = {
	async info(message: string): Promise<void> {
		logger.info(message);
		if (sessionLogFile) {
			await fs.appendFile(sessionLogFile, `${new Date().toISOString()} [INFO] ${message}\n`);
		}
	},

	async warn(message: string): Promise<void> {
		logger.warn(message);
		if (sessionLogFile) {
			await fs.appendFile(sessionLogFile, `${new Date().toISOString()} [WARN] ${message}\n`);
		}
	},

	async error(message: string): Promise<void> {
		logger.error(message);
		if (sessionLogFile) {
			await fs.appendFile(sessionLogFile, `${new Date().toISOString()} [ERROR] ${message}\n`);
		}
	},
};

if (import.meta.vitest) {
	const { describe, it, expect, beforeEach, afterEach } = await import('vitest');
	
	describe('logger', () => {
		beforeEach(() => {
			// Clear any existing session log file
			setSessionLogFile(null);
		});

		afterEach(() => {
			// Clean up after tests
			setSessionLogFile(null);
		});

		it('should support silent mode', () => {
			const originalLevel = logger.level;
			
			// Test enabling silent mode
			setSilentMode(true);
			expect(logger.level).toBe(0);
			
			// Test disabling silent mode
			setSilentMode(false);
			expect(logger.level).toBe(3);
			
			// Restore original level
			logger.level = originalLevel;
		});

		it('should support session log file configuration', async () => {
			const testLogFile = '/tmp/test-session.log';
			
			// Configure session log file
			setSessionLogFile(testLogFile);
			
			// Log a test message
			await sessionLogger.info('Test message');
			
			// Check if file exists and contains the message
			try {
				const content = await fs.readFile(testLogFile, 'utf-8');
				expect(content).toContain('Test message');
				expect(content).toContain('[INFO]');
			} finally {
				// Clean up test file
				try {
					await fs.unlink(testLogFile);
				} catch {
					// Ignore cleanup errors
				}
			}
		});
	});
}