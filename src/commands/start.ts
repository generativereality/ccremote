import type { DaemonConfig } from '../core/daemon.js';
import { consola } from 'consola';
import { define } from 'gunshi';
import { confirm, cancel, isCancel } from '@clack/prompts';
import { loadConfig, validateConfig } from '../core/config.js';
import { daemonManager } from '../core/daemon-manager.js';
import { SessionManager } from '../core/session.js';
import { TmuxManager } from '../core/tmux.js';
import { initCommand } from './init.js';

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
			consola.info('💡 ccremote needs to be configured before starting a session.');
			consola.info('   The interactive setup will guide you through creating the configuration.');
			consola.info('');

			// Ask if user wants to run init
			const shouldInit = await confirm({
				message: 'Would you like to run the configuration setup now?',
				initialValue: true,
			});

			if (isCancel(shouldInit) || !shouldInit) {
				cancel('Setup cancelled. You can run configuration setup later with: ccremote init');
				process.exit(1);
			}

			// Run init command
			consola.info('');
			consola.info('🚀 Starting configuration setup...');
			try {
				await initCommand.run({ values: { force: false } });
			}
			catch (initError) {
				consola.error('Configuration setup failed:', initError instanceof Error ? initError.message : initError);
				process.exit(1);
			}

			// After successful init, confirm Discord bot setup
			consola.info('');
			consola.info('⚠️  Important: Before continuing, make sure you have:');
			consola.info('   1. ✅ Created your Discord bot and copied the token');
			consola.info('   2. ✅ Invited the bot to your Discord server with proper permissions');
			consola.info('   3. ✅ The bot appears online in your server member list');
			consola.info('');
			
			const botSetupComplete = await confirm({
				message: 'Have you completed the Discord bot setup and verified the bot is online?',
				initialValue: false,
			});

			if (isCancel(botSetupComplete) || !botSetupComplete) {
				consola.info('');
				consola.info('💡 Please complete the Discord bot setup before starting a session:');
				consola.info('   • Review the instructions shown above');
				consola.info('   • Invite your bot to a Discord server');
				consola.info('   • Verify the bot appears online');
				consola.info('   • Then run: ccremote start');
				cancel('Session start cancelled - complete Discord bot setup first');
				process.exit(1);
			}

			// After successful init and confirmation, load the config again
			try {
				config = loadConfig();
				validateConfig(config);
				consola.success('Configuration loaded and Discord bot setup confirmed!');
				consola.info('');
			}
			catch (configError) {
				consola.error('Failed to load configuration after setup:', configError instanceof Error ? configError.message : configError);
				process.exit(1);
			}
		}

		try {
			// Initialize managers (only what we need for setup)
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();

			// Check if tmux is available
			if (!(await tmuxManager.isTmuxAvailable())) {
				consola.error('tmux is not installed or not available in PATH');
				consola.info('');
				consola.info('💡 ccremote requires tmux to manage Claude Code sessions.');
				consola.info('');
				consola.info('📋 Installation instructions:');
				consola.info('  macOS:   brew install tmux');
				consola.info('  Ubuntu:  sudo apt install tmux');
				consola.info('  CentOS:  sudo yum install tmux');
				consola.info('  Arch:    sudo pacman -S tmux');
				consola.info('');
				consola.info('After installing tmux, run this command again.');
				process.exit(1);
			}

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
