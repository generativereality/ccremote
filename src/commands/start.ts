import type { DaemonConfig } from '../core/daemon.js';
import { consola } from 'consola';
import { define } from 'gunshi';
import { loadConfig, validateConfig } from '../core/config.js';
import { daemonManager } from '../core/daemon-manager.js';
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
			// Initialize managers (only what we need for setup)
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();

			await sessionManager.initialize();

			// Create session
			const session = await sessionManager.createSession(name, channel);
			const logFile = `.ccremote/session-${session.id}.log`;
			consola.success(`Created session: ${session.name} (${session.id})`);

			// Check if tmux session already exists (cleanup from previous run)
			if (await tmuxManager.sessionExists(session.tmuxSession)) {
				consola.info(`Tmux session ${session.tmuxSession} already exists, killing it...`);
				await tmuxManager.killSession(session.tmuxSession);
			}

			// Create tmux session with Claude Code
			consola.info('Creating tmux session and starting Claude Code...');
			await tmuxManager.createSession(session.tmuxSession);

			// Prepare daemon configuration
			const daemonConfig: DaemonConfig = {
				sessionId: session.id,
				logFile,
				discordBotToken: config.discordBotToken,
				discordOwnerId: config.discordOwnerId,
				discordAuthorizedUsers: config.discordAuthorizedUsers,
				discordChannelId: channel,
				monitoringOptions: {
					pollInterval: config.monitoringInterval,
					maxRetries: config.maxRetries,
					autoRestart: config.autoRestart,
				},
			};

			// Spawn daemon process
			consola.info('Starting background daemon...');
			const daemon = await daemonManager.spawnDaemon(daemonConfig);

			consola.success('Session started successfully!');
			consola.info('');
			consola.info('Session Details:');
			consola.info(`  Name: ${session.name}`);
			consola.info(`  ID: ${session.id}`);
			consola.info(`  Tmux: ${session.tmuxSession}`);
			consola.info(`  Daemon PID: ${daemon.pid}`);
			consola.info('');
			consola.info('💡 Usage:');
			consola.info('  • Use Claude Code normally - daemon will monitor for limits and approvals');
			consola.info('  • Check Discord for notifications and approval requests');
			consola.info(`  • Stop session when done: ccremote stop --session ${session.id}`);
			consola.info('');

			// Set up graceful shutdown
			process.on('SIGINT', () => {
				consola.info('\nShutting down...');
				void (async () => {
					await daemonManager.stopDaemon(session.id);
					process.exit(0);
				})();
			});

			// Give user a moment to read the info, then attach
			consola.info('🔄 Attaching to Claude Code session in 3 seconds...');
			consola.info('   (Press Ctrl+B then D to detach - daemon continues in background)');
			consola.info(`   View daemon logs: tail -f ${logFile}`);

			await new Promise(resolve => setTimeout(resolve, 3000));

			// Attach to the tmux session (clean process with no daemon interference)
			const { spawn } = await import('node:child_process');
			const attachProcess = spawn('tmux', ['attach-session', '-t', session.tmuxSession], {
				stdio: 'inherit',
			});

			attachProcess.on('exit', (code) => {
				if (code === 0) {
					consola.info('');
					consola.info('👋 Detached from tmux session');
					consola.info(`   Session ${session.id} daemon continues running (PID: ${daemon.pid})`);
					consola.info(`   Reattach anytime with: tmux attach -t ${session.tmuxSession}`);
					consola.info(`   Stop session with: ccremote stop --session ${session.id}`);
					consola.info(`   View logs: tail -f ${logFile}`);
					consola.info('');
					consola.success('Session detached successfully - daemon monitoring continues!');
					process.exit(0);
				}
				else {
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
