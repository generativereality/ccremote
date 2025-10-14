#!/usr/bin/env node

/**
 * @fileoverview Main entry point for ccremote CLI tool
 *
 * This is the main entry point for the ccremote command-line interface tool.
 * It provides remote control for Claude Code sessions with Discord integration.
 *
 * @module index
 */

import type { Package } from 'update-notifier';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import consola from 'consola';
import updateNotifier from 'update-notifier';

import { run } from './commands/index.ts';

// Check for updates (runs in background, shows message on next run if update available)
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
	const packageJson = JSON.parse(
		readFileSync(join(__dirname, '../package.json'), 'utf-8'),
	) as Package;

	const notifier = updateNotifier({
		pkg: packageJson,
		updateCheckInterval: 1000 * 60 * 60 * 24, // Check once per day
	});
	notifier.notify({
		isGlobal: true,
		defer: false,
	});
}
catch (error) {
	// Log but don't block execution if update check fails
	consola.warn('Failed to check for updates:', error);
}

await run();
