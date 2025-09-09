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
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { consola } from 'consola';

// Read package name from package.json
const packagePath = join(import.meta.dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as { name?: string };
const packageName: string = packageJson.name || 'ccremote';

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

// Store original stdout/stderr and console methods for restoration
let originalStdout: typeof process.stdout.write | null = null;
let originalStderr: typeof process.stderr.write | null = null;
let originalConsoleLog: typeof console.log | null = null;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;
let originalConsoleInfo: typeof console.info | null = null;
let silentModeActive = false;
let unhandledExceptionListener: ((error: Error) => void) | null = null;
let unhandledRejectionListener: ((reason: any) => void) | null = null;

/**
 * Write any output to the session log file instead of console
 */
function writeToLogFile(chunk: any): void {
	if (sessionLogFile && chunk) {
		const message = chunk.toString();
		if (message.trim()) {
			// Write to log file asynchronously, don't wait for it
			// Add more context to help debug what's being captured
			void fs.appendFile(sessionLogFile, `${new Date().toISOString()} [STDOUT/STDERR] ${message}`);
		}
	}
}

/**
 * Check if silent mode is currently active (for debugging)
 */
export function isSilentModeActive(): boolean {
	return silentModeActive;
}

/**
 * Set logger to silent mode and redirect ALL process output
 * This is used when attaching to tmux to avoid garbling the output
 */
export function setSilentMode(silent: boolean): void {
	logger.level = silent ? 0 : 3; // 0 = silent, 3 = info level (consola default)

	if (silent && !silentModeActive) {
		// Store original methods
		originalStdout = process.stdout.write;
		originalStderr = process.stderr.write;
		originalConsoleLog = console.log;
		originalConsoleError = console.error;
		originalConsoleWarn = console.warn;
		originalConsoleInfo = console.info;

		// Redirect stdout to log file or suppress entirely
		process.stdout.write = function (chunk: any, encoding?: any, callback?: any): boolean {
			writeToLogFile(chunk);
			// Call callback if provided to maintain compatibility
			if (typeof encoding === 'function') {
				encoding(); // encoding is actually the callback
			}
			else if (callback) {
				callback();
			}
			return true; // Always return true to indicate success
		} as any;

		// Redirect stderr to log file or suppress entirely
		process.stderr.write = function (chunk: any, encoding?: any, callback?: any): boolean {
			writeToLogFile(chunk);
			// Call callback if provided to maintain compatibility
			if (typeof encoding === 'function') {
				encoding(); // encoding is actually the callback
			}
			else if (callback) {
				callback();
			}
			return true; // Always return true to indicate success
		} as any;

		// Set up comprehensive exception handlers to log to file instead of stderr
		unhandledExceptionListener = (error: Error) => {
			if (sessionLogFile) {
				void fs.appendFile(sessionLogFile, `${new Date().toISOString()} [UNCAUGHT EXCEPTION] ${error.stack || error.message}\n`);
			}
			// Prevent the default handler from printing to stderr by not re-throwing
			// Note: This will NOT crash the process - just silently log the error
		};

		unhandledRejectionListener = (reason: any) => {
			if (sessionLogFile) {
				const message = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
				void fs.appendFile(sessionLogFile, `${new Date().toISOString()} [UNHANDLED REJECTION] ${message}\n`);
			}
			// Prevent the default handler from printing to stderr
		};

		process.on('uncaughtException', unhandledExceptionListener);
		process.on('unhandledRejection', unhandledRejectionListener);

		// Hijack console methods to redirect to log file
		console.log = function(...args: any[]) {
			const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
			writeToLogFile(`[console.log] ${message}\n`);
		};

		console.error = function(...args: any[]) {
			const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
			writeToLogFile(`[console.error] ${message}\n`);
		};

		console.warn = function(...args: any[]) {
			const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
			writeToLogFile(`[console.warn] ${message}\n`);
		};

		console.info = function(...args: any[]) {
			const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
			writeToLogFile(`[console.info] ${message}\n`);
		};

		silentModeActive = true;
	}
	else if (!silent && silentModeActive) {
		// Restore original stdout/stderr
		if (originalStdout) {
			process.stdout.write = originalStdout;
		}
		if (originalStderr) {
			process.stderr.write = originalStderr;
		}

		// Remove exception handlers
		if (unhandledExceptionListener) {
			process.removeListener('uncaughtException', unhandledExceptionListener);
			unhandledExceptionListener = null;
		}
		if (unhandledRejectionListener) {
			process.removeListener('unhandledRejection', unhandledRejectionListener);
			unhandledRejectionListener = null;
		}

		// Restore console methods
		if (originalConsoleLog) {
			console.log = originalConsoleLog;
		}
		if (originalConsoleError) {
			console.error = originalConsoleError;
		}
		if (originalConsoleWarn) {
			console.warn = originalConsoleWarn;
		}
		if (originalConsoleInfo) {
			console.info = originalConsoleInfo;
		}

		silentModeActive = false;
		originalStdout = null;
		originalStderr = null;
		originalConsoleLog = null;
		originalConsoleError = null;
		originalConsoleWarn = null;
		originalConsoleInfo = null;
	}
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
			}
			finally {
				// Clean up test file
				try {
					await fs.unlink(testLogFile);
				}
				catch {
					// Ignore cleanup errors
				}
			}
		});
	});
}
