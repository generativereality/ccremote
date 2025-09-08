import { existsSync, writeFileSync } from 'node:fs';
import { consola } from 'consola';
import { define } from 'gunshi';
import { createExampleEnv } from '../core/config.js';

export const initCommand = define({
	name: 'init',
	description: 'Initialize ccremote configuration',
	args: {
		force: {
			type: 'boolean',
			description: 'Overwrite existing configuration file',
		},
		global: {
			type: 'boolean',
			description: 'Create global configuration in ~/.ccremote.env',
		},
	},
	async run(ctx) {
		const { force, global } = ctx.values;

		// Determine config file path
		const configPath = global
			? `${process.env.HOME}/.ccremote.env`
			: 'ccremote.env';

		// Check if file already exists
		if (existsSync(configPath) && !force) {
			consola.error(`Configuration file already exists: ${configPath}`);
			consola.error('Use --force to overwrite');
			process.exit(1);
		}

		try {
			// Create configuration file
			const exampleConfig = createExampleEnv();
			writeFileSync(configPath, exampleConfig);

			consola.success(`Configuration file created: ${configPath}`);
			consola.info('');
			consola.info('Next steps:');
			consola.info('1. Edit the configuration file and add your Discord bot token and user ID');
			consola.info('2. Run: ccremote start');
			consola.info('');
			consola.info('To create a Discord bot:');
			consola.info('1. Go to https://discord.com/developers/applications');
			consola.info('2. Create a new application and bot');
			consola.info('3. Copy the bot token and your Discord user ID');
		}
		catch (error) {
			consola.error('Failed to create configuration file:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
