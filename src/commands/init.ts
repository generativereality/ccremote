import { existsSync, writeFileSync } from 'node:fs';
import { cancel, confirm, intro, isCancel, outro, select, text } from '@clack/prompts';
import { consola } from 'consola';
import { define } from 'gunshi';

export const initCommand = define({
	name: 'init',
	description: 'Initialize ccremote configuration interactively',
	args: {
		force: {
			type: 'boolean',
			description: 'Overwrite existing configuration file',
		},
	},
	async run(ctx) {
		const { force } = ctx.values;

		intro('🤖 ccremote configuration setup');

		// Ask where to create the config
		const configLocation = await select({
			message: 'Where should the configuration be created?',
			options: [
				{ value: 'user', label: 'For user (global): ~/.ccremote.env', hint: 'Recommended' },
				{ value: 'directory', label: 'For current directory: ./ccremote.env' },
			],
		});

		if (isCancel(configLocation)) {
			cancel('Configuration setup cancelled.');
			process.exit(1);
		}

		// Determine config file path
		const isGlobal = configLocation === 'user';
		const configPath = isGlobal
			? `${process.env.HOME}/.ccremote.env`
			: 'ccremote.env';

		// Show Discord setup instructions first
		const showInstructions = () => {
			consola.info('');
			consola.info('📱 Discord Bot Setup Instructions:');
			consola.info('ℹ️  Note: Create a Discord app and bot only for you to ensure privacy');
			consola.info('');
			consola.info('1. Go to https://discord.com/developers/applications');
			consola.info('2. Click "New Application" and give it a name');
			consola.info('3. Go to the "Bot" section in the sidebar');
			consola.info('4. Click "Add Bot" if not already created');
			consola.info('5. Enable this Privileged Gateway Intent:');
			consola.info('   - ✅ MESSAGE CONTENT INTENT (for approval commands)');
			consola.info('6. Copy the "Token" - this is your CCREMOTE_DISCORD_BOT_TOKEN');
			consola.info('7. For your Discord User ID:');
			consola.info('   - Open the Discord app (not the developer portal)');
			consola.info('   - Enable Developer Mode in Discord Settings > Advanced');
			consola.info('   - Right-click your username and select "Copy User ID"');
			consola.info('');
			consola.info('🚀 Next steps:');
			consola.info('1. Create a Discord server (optional) and invite your bot:');
			consola.info('   - You can create a new server just for ccremote (+ button in Discord > Create My Own)');
			consola.info('   - Or use an existing server where you have admin permissions');
			consola.info('   - To invite your bot: go back to Developer Portal > OAuth2 > URL Generator');
			consola.info('   - Select "bot" scope and these permissions:');
			consola.info('     • Administrator (recommended - for full channel management)');
			consola.info('     OR for minimal permissions:');
			consola.info('       • Manage Channels (to create private session channels)');
			consola.info('       • Manage Roles (to set channel permissions)');
			consola.info('       • Send Messages (to send notifications)');
			consola.info('       • Read Message History (to see approval responses)');
			consola.info('   - Visit the generated URL to invite your bot');
			consola.info('   - 💡 Note: If bot lacks Manage Channels permission, it will fall back to DMs');
			consola.info('2. (Optional) Run: ccremote setup-tmux for optimized tmux configuration');
			consola.info('3. Run: ccremote start');
			consola.info('');
		};

		// Check if file already exists
		if (existsSync(configPath) && !force) {
			showInstructions();

			const action = await select({
				message: `Configuration file already exists at ${configPath}. What would you like to do?`,
				options: [
					{ value: 'view', label: 'Just view instructions (done)', hint: 'Exit after showing instructions' },
					{ value: 'overwrite', label: 'Overwrite existing configuration', hint: 'Create new config file' },
				],
			});

			if (isCancel(action)) {
				cancel('Configuration setup cancelled.');
				process.exit(1);
			}

			if (action === 'view') {
				outro('✨ Instructions displayed. Your existing configuration is unchanged.');
				process.exit(0);
			}
		} else {
			showInstructions();
		}

		// Ask for Discord bot token
		const botToken = await text({
			message: 'Enter your Discord bot token:',
			placeholder: 'your_discord_bot_token_here',
			validate: (value) => {
				if (!value || value.trim().length === 0) {
					return 'Bot token is required';
				}
				if (value === 'your_discord_bot_token_here') {
					return 'Please enter your actual bot token';
				}
			},
		});

		if (isCancel(botToken)) {
			cancel('Configuration setup cancelled.');
			process.exit(1);
		}

		// Ask for Discord user ID
		const userId = await text({
			message: 'Enter your Discord user ID:',
			placeholder: 'your_discord_user_id_here',
			validate: (value) => {
				if (!value || value.trim().length === 0) {
					return 'User ID is required';
				}
				if (value === 'your_discord_user_id_here') {
					return 'Please enter your actual Discord user ID';
				}
				if (!/^\d+$/.test(value.trim())) {
					return 'User ID should only contain numbers';
				}
			},
		});

		if (isCancel(userId)) {
			cancel('Configuration setup cancelled.');
			process.exit(1);
		}

		// Ask for optional authorized users
		const authorizedUsers = await text({
			message: 'Enter additional authorized Discord user IDs (comma-separated, optional):',
			placeholder: 'user_id_1,user_id_2',
		});

		if (isCancel(authorizedUsers)) {
			cancel('Configuration setup cancelled.');
			process.exit(1);
		}

		try {
			// Create configuration content
			let configContent = `# ccremote Configuration
# Generated by ccremote init

# Required: Discord Bot Configuration
CCREMOTE_DISCORD_BOT_TOKEN=${botToken}
CCREMOTE_DISCORD_OWNER_ID=${userId}

`;

			if (authorizedUsers && authorizedUsers.trim().length > 0) {
				configContent += `# Optional: Additional authorized users (comma-separated Discord user IDs)
CCREMOTE_DISCORD_AUTHORIZED_USERS=${authorizedUsers.trim()}

`;
			}

			configContent += `# Optional: Monitoring Configuration
CCREMOTE_MONITORING_INTERVAL=2000    # Polling interval in milliseconds (default: 2000)
CCREMOTE_MAX_RETRIES=3               # Max retry attempts on error (default: 3)
CCREMOTE_AUTO_RESTART=true           # Auto-restart monitoring on failure (default: true)
`;

			// Write configuration file
			writeFileSync(configPath, configContent);

			outro(`✅ Configuration file created: ${configPath}`);
		}
		catch (error) {
			consola.error('Failed to create configuration file:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
