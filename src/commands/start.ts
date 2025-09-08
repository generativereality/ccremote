import { consola } from 'consola';
import { define } from 'gunshi';
import { DiscordBot } from '../core/discord.js';
import { SessionManager } from '../core/session.js';
import { TmuxManager } from '../core/tmux.js';

export const startCommand = define({
	name: 'start',
	description: 'Start monitored Claude Code session',
	args: {
		name: {
			type: 'string',
			description: 'Session name (auto-generated if not provided)',
		},
		channel: {
			type: 'string',
			description: 'Discord channel ID (optional)',
		},
	},
	async run(ctx) {
		const { name, channel } = ctx.values;
		consola.start('Starting CCRemote session...');

		// Check environment variables
		const discordToken = process.env.DISCORD_BOT_TOKEN;
		const discordOwnerId = process.env.DISCORD_OWNER_ID;

		if (!discordToken || !discordOwnerId) {
			consola.error('Missing required environment variables:');
			consola.error('   DISCORD_BOT_TOKEN - Your Discord bot token');
			consola.error('   DISCORD_OWNER_ID - Your Discord user ID');
			consola.error('');
			consola.error('Create a .env file with these values or set them as environment variables');
			process.exit(1);
		}

		try {
		// Initialize managers
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();
			const discordBot = new DiscordBot();

			await sessionManager.initialize();

			// Create session
			const session = await sessionManager.createSession(name, channel);
			consola.success(`Created session: ${session.name} (${session.id})`);

			// Check if tmux session already exists (cleanup from previous run)
			if (await tmuxManager.sessionExists(session.tmuxSession)) {
				consola.info(`Tmux session ${session.tmuxSession} already exists, killing it...`);
				await tmuxManager.killSession(session.tmuxSession);
			}

			// Create tmux session with Claude Code
			consola.info('Creating tmux session with Claude Code...');
			await tmuxManager.createSession(session.tmuxSession);

			// Start Discord bot
			consola.info('Starting Discord bot...');
			const authorizedUsers = process.env.DISCORD_AUTHORIZED_USERS?.split(',') || [];
			await discordBot.start(discordToken, discordOwnerId, authorizedUsers);

			// Set up Discord channel
			let channelId = channel;
			if (!channelId) {
				channelId = await discordBot.createOrGetChannel(session.id, session.name);
			}
			else {
				await discordBot.assignChannelToSession(session.id, channelId);
			}

			// Update session with channel
			await sessionManager.updateSession(session.id, { channelId });

			consola.success('Session started successfully!');
			consola.info('');
			consola.info('Session Details:');
			consola.info(`  Name: ${session.name}`);
			consola.info(`  ID: ${session.id}`);
			consola.info(`  Tmux: ${session.tmuxSession}`);
			consola.info(`  Discord Channel: ${channelId}`);
			consola.info('');
			consola.info('Next steps:');
			consola.info(`  1. Attach to tmux session: tmux attach -t ${session.tmuxSession}`);
			consola.info('  2. Use Claude Code normally - CCRemote will monitor for limits and approvals');
			consola.info('  3. Check Discord for notifications and approval requests');
			consola.info(`  4. Stop session when done: ccremote stop ${session.id}`);
			consola.info('');
			consola.info('Note: Keep this process running for monitoring to work!');

			// For now, just keep the process alive
			// In the future, this would start the monitoring daemon
			process.on('SIGINT', () => {
				consola.info('\nShutting down...');
				void discordBot.stop();
				process.exit(0);
			});

			// Keep process alive
			await new Promise<void>(() => {}); // Wait forever
		}
		catch (error) {
			consola.error('Failed to start session:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
