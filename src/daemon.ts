#!/usr/bin/env node

/**
 * @fileoverview Standalone daemon entry point
 *
 * This is the entry point for daemon processes spawned by the main CLI.
 * It runs completely independently with all output going to session log files.
 */

import { startDaemon } from './core/daemon.js';

// If this module is run directly or through PM2, start the daemon
// PM2 uses ProcessContainerFork.js wrapper, so we check if this is the main module
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].includes('ProcessContainerFork.js')) {
	void startDaemon();
}
