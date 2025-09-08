#!/usr/bin/env node

/**
 * @fileoverview Main entry point for ccremote CLI tool
 *
 * This is the main entry point for the ccremote command-line interface tool.
 * It provides remote control for Claude Code sessions with Discord integration.
 *
 * @module index
 */

import { run } from './commands/index.js';

await run();
