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
			consola.info('Creating tmux session and starting Claude Code...');
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
			consola.info('💡 Usage:');
			consola.info('  • Use Claude Code normally - ccremote will monitor for limits and approvals');
			consola.info('  • Check Discord for notifications and approval requests');
			consola.info(`  • Stop session when done: ccremote stop ${session.id}`);
			consola.info('');
			consola.info('Note: Monitoring continues in the background!');

			// Create log file for monitoring output
			const logFile = `.ccremote/session-${session.id}.log`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(logFile, `ccremote session ${session.id} started at ${new Date().toISOString()}\n`);

			// Set up monitoring event handlers (write to log instead of console after attach)
			let attachedToTmux = false;
			
			monitor.on('limit_detected', (event) => {
				const message = `🚫 Usage limit detected for ${event.sessionId}`;
				if (attachedToTmux) {
					void fs.appendFile(logFile, `${new Date().toISOString()} ${message}\n`);
				} else {
					consola.warn(message);
				}
			});

			monitor.on('continuation_ready', (event) => {
				const message = `✅ Auto-continuing session ${event.sessionId}`;
				if (attachedToTmux) {
					void fs.appendFile(logFile, `${new Date().toISOString()} ${message}\n`);
				} else {
					consola.info(message);
				}
			});

			monitor.on('error', (event) => {
				const message = `❌ Monitor error for ${event.sessionId}: ${event.data?.error}`;
				if (attachedToTmux) {
					void fs.appendFile(logFile, `${new Date().toISOString()} ${message}\n`);
				} else {
					consola.error(message);
				}
			});

			// Start monitoring in the background
			void monitor.startMonitoring(session.id);

			process.on('SIGINT', () => {
				consola.info('\nShutting down...');
				void monitor.stopAll();
				void discordBot.stop();
				process.exit(0);
			});

			// Give user a moment to read the info, then attach
			consola.info('');
			consola.info('🔄 Attaching to Claude Code session in 3 seconds...');
			consola.info('   (Press Ctrl+B then D to detach and return to monitoring)');
			consola.info(`   Monitoring logs: ${logFile}`);
			
			await new Promise(resolve => setTimeout(resolve, 3000));
			
			// Set flag to redirect output to logs
			attachedToTmux = true;
			
			// Attach to the tmux session
			const { spawn } = await import('node:child_process');
			
			// Use spawn to attach interactively
			const attachProcess = spawn('tmux', ['attach-session', '-t', session.tmuxSession], {
				stdio: 'inherit',
			});
			
			attachProcess.on('exit', (code) => {
				attachedToTmux = false; // Resume console output when detached
				
				if (code === 0) {
					consola.info('');
					consola.info('👋 Detached from tmux session');
					consola.info(`   Session ${session.id} is still running and being monitored`);
					consola.info(`   Reattach anytime with: tmux attach -t ${session.tmuxSession}`);
					consola.info(`   Stop session with: ccremote stop ${session.id}`);
					consola.info(`   View logs: tail -f ${logFile}`);
					consola.info('');
					consola.info('🔄 Monitoring continues...');
					
					// Keep process alive for monitoring
					return new Promise<void>(() => {}); // Wait forever
				} else {
					consola.error('Failed to attach to tmux session');
					process.exit(1);
				}
			});
		}
		catch (error) {
			consola.error('Failed to start session:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
