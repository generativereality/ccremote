import process from 'node:process';
import { cli } from 'gunshi';
import { description, name, version } from '../../package.json';
import { initCommand } from './init.js';
import { listCommand } from './list.js';
import { setupTmuxCommand } from './setup-tmux.js';
import { startCommand } from './start.js';
import { statusCommand } from './status.js';
import { stopCommand } from './stop.js';

// Re-export all commands for easy importing
export { initCommand, listCommand, setupTmuxCommand, startCommand, statusCommand, stopCommand };

/**
 * Command entries as tuple array
 */
export const subCommandUnion = [
	['init', initCommand],
	['setup-tmux', setupTmuxCommand],
	['start', startCommand],
	['list', listCommand],
	['stop', stopCommand],
	['status', statusCommand],
] as const;

/**
 * Available command names extracted from union
 */
export type CommandName = typeof subCommandUnion[number][0];

/**
 * Map of available CLI subcommands
 */
const subCommands = new Map();
for (const [name, command] of subCommandUnion) {
	subCommands.set(name, command);
}

/**
 * Default command when no subcommand is specified (defaults to list)
 */
const mainCommand = listCommand;

export async function run(): Promise<void> {
	await cli(process.argv.slice(2), mainCommand, {
		name,
		version,
		description,
		subCommands,
		renderHeader: null,
	});
}
