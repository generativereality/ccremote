/**
 * @fileoverview Logging utilities for the ccremote application
 *
 * This module provides configured logger instances using consola for consistent
 * logging throughout the application with package name tagging.
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

// The logger is now simplified - daemon processes handle their own file logging directly