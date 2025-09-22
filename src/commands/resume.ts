import type { DaemonConfig } from '../core/daemon.ts';
import { consola } from 'consola';
import { define } from 'gunshi';
import { loadConfig, validateConfig } from '../core/config.ts';
import { daemonManager } from '../core/daemon-manager.ts';
import { SessionManager } from '../core/session.ts';
import { TmuxManager } from '../core/tmux.ts';

export const resumeCommand = define({
	name: 'resume',
	description: 'Reattach to existing tmux session and restart monitoring',
	args: {
		'session': {
			type: 'string',
			description: 'Resume specific session by ID (required when multiple sessions available)',
		},
		'dry-run': {
			type: 'boolean',
			description: 'Show what would be resumed without starting monitoring',
		},
	},
	async run(ctx) {
		const { session, 'dry-run': dryRun } = ctx.values;
		consola.start('Resuming ccremote sessions...');

		// Load and validate configuration
		let config;
		try {
			config = loadConfig();
			validateConfig(config);
		}
		catch (error) {
			consola.error('Configuration error:', error instanceof Error ? error.message : error);
			consola.error('Run "ccremote init" to configure ccremote first.');
			process.exit(1);
		}

		const sessionManager = new SessionManager();
		const tmuxManager = new TmuxManager();

		await sessionManager.initialize();

		// Get sessions for current project
		const allSessions = await sessionManager.listSessionsForProject();

		// Get active tmux sessions
		const activeTmuxSessions = await tmuxManager.listSessions();
		const activeTmuxIds = new Set(activeTmuxSessions.map(s => s.name));

		// Find sessions that can be resumed
		let resumableSessions = allSessions.filter((session) => {
			// Session must exist in tmux and be in a resumable state
			return activeTmuxIds.has(session.tmuxSession)
				&& (session.status === 'active' || session.status === 'waiting' || session.status === 'waiting_approval');
		});

		// Filter by specific session if requested
		if (session) {
			const specificSession = resumableSessions.find(s => s.id === session);
			if (!specificSession) {
				if (allSessions.find(s => s.id === session)) {
					consola.error(`Session ${session} exists but cannot be resumed (tmux session not found or ended)`);
				}
				else {
					consola.error(`Session not found: ${session}`);
				}
				process.exit(1);
			}
			resumableSessions = [specificSession];
		}
		else if (resumableSessions.length > 1) {
			// If multiple sessions, show them and ask user to specify
			consola.info('Multiple sessions can be resumed:');
			resumableSessions.forEach((session) => {
				consola.info(`  ${session.id}: ${session.name} (${session.status})`);
			});
			consola.info('\nUse --session <id> to resume a specific session.');
			process.exit(0);
		}

		if (resumableSessions.length === 0) {
			consola.info('No sessions to resume.');
			consola.info('\nActive tmux sessions:');
			activeTmuxSessions.forEach((session) => {
				consola.info(`  ${session.name}`);
			});

			const endedSessions = allSessions.filter(s => !activeTmuxIds.has(s.tmuxSession));
			if (endedSessions.length > 0) {
				consola.info('\nSessions with ended tmux sessions (use "ccremote clean" to remove):');
				endedSessions.forEach((session) => {
					consola.info(`  ${session.id}: ${session.name} (tmux session ${session.tmuxSession} not found)`);
				});
			}
			process.exit(0);
		}

		if (dryRun) {
			consola.info('Would resume the following sessions:');
			resumableSessions.forEach((session) => {
				consola.info(`  ${session.id}: ${session.name} (${session.status}) -> reattach to ${session.tmuxSession}`);
			});
			process.exit(0);
		}

		// Resume command should only handle single sessions for reattachment
		if (resumableSessions.length > 1) {
			consola.error('Cannot resume multiple sessions at once for reattachment.');
			consola.info('\nAvailable sessions to resume:');
			resumableSessions.forEach((session) => {
				consola.info(`  ccremote resume --session ${session.id}  # ${session.name}`);
			});
			process.exit(1);
		}

		const sessionToResume = resumableSessions[0];

		try {
			consola.info(`Resuming session: ${sessionToResume.name} (${sessionToResume.id})`);

			// Check if daemon is already running for this session
			const isDaemonRunning = daemonManager.isDaemonRunning(sessionToResume.id);
			if (isDaemonRunning) {
				consola.info('Daemon already running for this session, stopping it first...');
				await daemonManager.stopDaemon(sessionToResume.id);
				// Give it a moment to shut down
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			// Update session status to reflect it's being monitored again
			await sessionManager.updateSession(sessionToResume.id, {
				status: 'active',
				lastActivity: new Date().toISOString(),
			});

			// Ensure logs directory exists - use global but project-specific subdirectory
			const { promises: fs } = await import('node:fs');
			const { homedir } = await import('node:os');
			const nodePath = await import('node:path');

			const globalLogsDir = nodePath.join(homedir(), '.ccremote', 'logs');
			const projectName = nodePath.basename(process.cwd());
			const logFile = nodePath.join(globalLogsDir, `${projectName}-${sessionToResume.id}.log`);
			await fs.mkdir(globalLogsDir, { recursive: true });

			// Prepare daemon configuration
			const daemonConfig: DaemonConfig = {
				sessionId: sessionToResume.id,
				logFile,
				discordBotToken: config.discordBotToken,
				discordOwnerId: config.discordOwnerId,
				discordAuthorizedUsers: config.discordAuthorizedUsers,
				discordChannelId: sessionToResume.channelId,
				monitoringOptions: {
					pollInterval: config.monitoringInterval,
					maxRetries: config.maxRetries,
					autoRestart: config.autoRestart,
				},
			};

			// Spawn daemon process
			consola.info('Starting background daemon...');
			const daemon = await daemonManager.spawnDaemon(daemonConfig);

			consola.success('Session resumed successfully!');
			consola.info('');
			consola.info('Session Details:');
			consola.info(`  Name: ${sessionToResume.name}`);
			consola.info(`  ID: ${sessionToResume.id}`);
			consola.info(`  Tmux: ${sessionToResume.tmuxSession}`);
			consola.info(`  Daemon PM2: ${daemon.pm2Id}`);
			consola.info('');
			consola.info('💡 Usage:');
			consola.info('  • Use Claude Code normally - daemon will monitor for limits and approvals');
			consola.info('  • Check Discord for notifications and approval requests');
			consola.info(`  • Stop session when done: ccremote stop --session ${sessionToResume.id}`);
			consola.info('');

			// Set up graceful shutdown
			process.on('SIGINT', () => {
				consola.info('\nShutting down...');
				void (async (): Promise<void> => {
					await daemonManager.stopDaemon(sessionToResume.id);
					process.exit(0);
				})();
			});

			// Give user a moment to read the info, then attach
			consola.info('🔄 Attaching to existing tmux session in 3 seconds...');
			consola.info('   (Press Ctrl+B then D to detach - daemon continues in background)');
			consola.info(`   View daemon logs: tail -f ${logFile}`);

			await new Promise(resolve => setTimeout(resolve, 3000));

			// Attach to the existing tmux session
			const { spawn } = await import('node:child_process');
			const attachProcess = spawn('tmux', ['attach-session', '-t', sessionToResume.tmuxSession], {
				stdio: 'inherit',
			});

			attachProcess.on('exit', (code) => {
				if (code === 0) {
					consola.info('');
					consola.info('👋 Detached from tmux session');
					consola.info(`   Session ${sessionToResume.id} daemon continues running (PM2: ${daemon.pm2Id})`);
					consola.info(`   Reattach anytime with: tmux attach -t ${sessionToResume.tmuxSession}`);
					consola.info(`   Stop session with: ccremote stop --session ${sessionToResume.id}`);
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
			consola.error('Failed to resume session:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
