import { consola } from 'consola';
import { define } from 'gunshi';
import { loadConfig, validateConfig } from '../core/config.js';
import { DiscordBot } from '../core/discord.js';
import { Monitor } from '../core/monitor.js';
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
		consola.start('Starting ccremote session...');

		// Load and validate configuration
		let config;
		try {
			config = loadConfig();
			validateConfig(config);
		}
		catch (error) {
			consola.error('Configuration error:', error instanceof Error ? error.message : error);
			consola.error('');
			consola.error('Please ensure you have set the required environment variables:');
			consola.error('   CCREMOTE_DISCORD_BOT_TOKEN - Your Discord bot token');
			consola.error('   CCREMOTE_DISCORD_OWNER_ID - Your Discord user ID');
			consola.error('');
			consola.error('You can set these in:');
			consola.error('   - Environment variables');
			consola.error('   - Project ccremote.env file');
			consola.error('   - Project .env file');
			consola.error('   - Global ~/.ccremote.env file');
			process.exit(1);
		}

		try {
		// Initialize managers
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();
			const discordBot = new DiscordBot();
			const monitor = new Monitor(sessionManager, tmuxManager, discordBot, {
				pollInterval: config.monitoringInterval,
				maxRetries: config.maxRetries,
				autoRestart: config.autoRestart,
			});

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
			await discordBot.start(config.discordBotToken, config.discordOwnerId, config.discordAuthorizedUsers);

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
			consola.info('  2. Use Claude Code normally - ccremote will monitor for limits and approvals');
			consola.info('  3. Check Discord for notifications and approval requests');
			consola.info(`  4. Stop session when done: ccremote stop ${session.id}`);
			consola.info('');
			consola.info('Note: Keep this process running for monitoring to work!');

			// Set up monitoring event handlers
			monitor.on('limit_detected', (event) => {
				consola.warn(`🚫 Usage limit detected for ${event.sessionId}`);
			});

			monitor.on('continuation_ready', (event) => {
				consola.info(`✅ Auto-continuing session ${event.sessionId}`);
			});

			monitor.on('error', (event) => {
				consola.error(`❌ Monitor error for ${event.sessionId}:`, event.data?.error);
			});

			// Start monitoring
			consola.info('Starting monitoring system...');
			await monitor.startMonitoring(session.id);

			process.on('SIGINT', () => {
				consola.info('\nShutting down...');
				void monitor.stopAll();
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
