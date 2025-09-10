#!/usr/bin/env node

/**
 * @fileoverview Standalone daemon entry point
 *
 * This is the entry point for daemon processes spawned by the main CLI.
 * It runs completely independently with all output going to session log files.
 */

import { startDaemon } from './core/daemon.js';

// If this module is run directly, start the daemon
if (import.meta.url === `file://${process.argv[1]}`) {
	void startDaemon();
}