import process from 'node:process';
import { cli } from 'gunshi';
import { description, name, version } from '../../package.json';
import { cleanCommand } from './clean.ts';
import { initCommand } from './init.ts';
import { listCommand } from './list.ts';
import { resumeCommand } from './resume.ts';
import { setupTmuxCommand } from './setup-tmux.ts';
import { startCommand } from './start.ts';
import { statusCommand } from './status.ts';
import { stopCommand } from './stop.ts';

// Re-export all commands for easy importing
export { cleanCommand, initCommand, listCommand, resumeCommand, setupTmuxCommand, startCommand, statusCommand, stopCommand };

/**
 * Command entries as tuple array
 */
export const subCommandUnion = [
	['init', initCommand],
	['setup-tmux', setupTmuxCommand],
	['start', startCommand],
	['resume', resumeCommand],
	['list', listCommand],
	['stop', stopCommand],
	['status', statusCommand],
	['clean', cleanCommand],
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
 * Default command when no subcommand is specified (defaults to start)
 */
const mainCommand = startCommand;

export async function run(): Promise<void> {
	await cli(process.argv.slice(2), mainCommand, {
		name,
		version,
		description,
		subCommands,
		renderHeader: null,
	});
}
