/**
 * @fileoverview Daemon process for ccremote background monitoring
 *
 * This module runs as a separate background process that handles:
 * - Session monitoring
 * - Discord bot integration
 * - Auto-continuation
 * - Approval request handling
 *
 * All output goes directly to session log files - no stdout/stderr pollution.
 */

import type { MonitorEvent, MonitoringOptions } from './monitor.ts';

export type DaemonConfig = {
	sessionId: string;
	logFile: string;
	discordBotToken: string;
	discordOwnerId: string;
	discordAuthorizedUsers?: string[];
	discordChannelId?: string;
	monitoringOptions: MonitoringOptions;
};

export class Daemon {
	private sessionManager: any;
	private tmuxManager: any;
	private discordBot: any;
	private monitor: any;
	private config: DaemonConfig;
	private logFile: string;
	private running = false;

	constructor(config: DaemonConfig) {
		this.config = config;
		this.logFile = config.logFile;
		// Managers will be initialized in start() method
	}

	/**
	 * Log to console (PM2 redirects to file)
	 */
	private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
		const timestamp = new Date().toISOString();
		const logEntry = `${timestamp} [DAEMON:${level}] ${message}`;

		// PM2 now redirects console output to the log file
		console.info(logEntry);
	}

	/**
	 * Start the daemon process
	 */
	async start(): Promise<void> {
		try {
			this.log('INFO', `Daemon starting for session ${this.config.sessionId} (PID: ${process.pid})`);
			this.log('INFO', `Working directory: ${process.cwd()}`);

			// Ensure logs directory exists
			const { promises: fs } = await import('node:fs');
			const { dirname } = await import('node:path');
			await fs.mkdir(dirname(this.logFile), { recursive: true });

			// Ensure we're in the correct directory for Discord.js package resolution
			// Since Discord.js looks for package.json in parent directories, we need to be in a dir with node_modules
			const originalCwd = process.cwd();

			// Import managers here to avoid early Discord.js loading
			const { SessionManager } = await import('./session.js');
			const { TmuxManager } = await import('./tmux.js');
			const { DiscordBot } = await import('./discord.js');
			const { Monitor } = await import('./monitor.js');

			// Initialize managers
			this.sessionManager = new SessionManager();
			this.tmuxManager = new TmuxManager();
			this.discordBot = new DiscordBot();
			this.monitor = new Monitor(
				this.sessionManager,
				this.tmuxManager,
				this.discordBot,
				this.config.monitoringOptions,
			);

			// Initialize session manager
			await this.sessionManager.initialize();

			// Verify session exists
			const session = await this.sessionManager.getSession(this.config.sessionId);
			if (!session) {
				throw new Error(`Session not found: ${this.config.sessionId}`);
			}

			// Start Discord bot
			this.log('INFO', 'Starting Discord bot...');
			await this.discordBot.start(
				this.config.discordBotToken,
				this.config.discordOwnerId,
				this.config.discordAuthorizedUsers || [],
			);

			// Set up Discord channel if provided
			if (this.config.discordChannelId) {
				await this.discordBot.assignChannelToSession(this.config.sessionId, this.config.discordChannelId);
			}
			else {
				const channelId = await this.discordBot.createOrGetChannel(this.config.sessionId, session.name);
				await this.sessionManager.updateSession(this.config.sessionId, { channelId });
			}

			// Set up monitoring event handlers
			this.monitor.on('limit_detected', (event: MonitorEvent) => {
				this.log('INFO', `Usage limit detected for session ${event.sessionId}`);
			});

			this.monitor.on('continuation_ready', (event: MonitorEvent) => {
				this.log('INFO', `Auto-continuing session ${event.sessionId}`);
			});

			this.monitor.on('approval_needed', (event: MonitorEvent) => {
				this.log('INFO', `Approval required for session ${event.sessionId}`);
			});

			this.monitor.on('error', (event: MonitorEvent) => {
				this.log('ERROR', `Monitor error for session ${event.sessionId}: ${event.data?.error || 'Unknown error'}`);
			});

			// Set up Discord option selection handler
			this.discordBot.onOptionSelected((sessionId: string, optionNumber: number) => {
				this.log('INFO', `Discord option selected: ${optionNumber} for session ${sessionId}`);

				// Handle async operations
				void (async () => {
					try {
						// Send the option selection to tmux session
						const sessionData = await this.sessionManager.getSession(sessionId);
						if (sessionData) {
							await this.tmuxManager.sendOptionSelection(sessionData.tmuxSession, optionNumber);

							// Update session status back to active
							await this.sessionManager.updateSession(sessionId, { status: 'active' });

							this.log('INFO', `Sent option ${optionNumber} to tmux session ${sessionData.tmuxSession}`);
						}
					}
					catch (error) {
						this.log('ERROR', `Failed to send option selection: ${error instanceof Error ? error.message : String(error)}`);
					}
				})();
			});

			// Start monitoring
			this.log('INFO', 'Starting session monitoring...');
			await this.monitor.startMonitoring(this.config.sessionId);

			// Set up graceful shutdown
			process.on('SIGTERM', () => {
				void this.shutdown('SIGTERM');
			});
			process.on('SIGINT', () => {
				void this.shutdown('SIGINT');
			});
			process.on('SIGHUP', () => {
				void this.shutdown('SIGHUP');
			});

			this.running = true;
			this.log('INFO', 'Daemon started successfully');

			// Keep the process alive
			await this.runLoop();
		}
		catch (error) {
			this.log('ERROR', `Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	}

	/**
	 * Main daemon loop - keeps process alive and handles periodic tasks
	 */
	private async runLoop(): Promise<void> {
		while (this.running) {
			try {
				// Check if session still exists
				const session = await this.sessionManager.getSession(this.config.sessionId);
				if (!session) {
					this.log('ERROR', 'Session no longer exists, shutting down daemon');
					break;
				}

				// Check if tmux session still exists
				const tmuxExists = await this.tmuxManager.sessionExists(session.tmuxSession);
				if (!tmuxExists) {
					this.log('INFO', `Tmux session ${session.tmuxSession} ended, gracefully shutting down daemon`);

					// Update session status to ended
					await this.sessionManager.updateSession(this.config.sessionId, { status: 'ended' });

					// Notify via Discord that session has ended
					try {
						await this.discordBot.sendNotification(this.config.sessionId, {
							type: 'session_ended',
							sessionId: this.config.sessionId,
							sessionName: session.name,
							message: `Session **${session.name}** has ended. The tmux session was closed.`,
						});
					}
					catch (error) {
						this.log('ERROR', `Failed to send session end notification: ${error instanceof Error ? error.message : String(error)}`);
					}

					break;
				}

				// Sleep for a while before next check
				await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
			}
			catch (error) {
				this.log('ERROR', `Error in daemon loop: ${error instanceof Error ? error.message : String(error)}`);
				await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
			}
		}

		await this.shutdown('LOOP_EXIT');
	}

	/**
	 * Graceful shutdown
	 */
	private async shutdown(reason: string): Promise<void> {
		if (!this.running) {
			return;
		}

		this.log('INFO', `Daemon shutting down (${reason})`);
		this.running = false;

		try {
			// Stop monitoring
			await this.monitor.stopAll();

			// Stop Discord bot
			await this.discordBot.stop();

			this.log('INFO', 'Daemon shut down successfully');
		}
		catch (error) {
			this.log('ERROR', `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
		}

		process.exit(0);
	}
}

/**
 * Main entry point for daemon process
 * Expects config as first argument (JSON string)
 */
export async function startDaemon(): Promise<void> {
	try {
		const sessionId = process.env.CCREMOTE_SESSION_ID;

		if (!sessionId) {
			console.error('CCREMOTE_SESSION_ID environment variable is required');
			process.exit(1);
		}

		// Load config from environment like any other ccremote process
		const { loadConfig } = await import('./config.js');
		const appConfig = await loadConfig();

		const config: DaemonConfig = {
			sessionId,
			logFile: `.ccremote/logs/session-${sessionId}.log`,
			discordBotToken: appConfig.discordBotToken,
			discordOwnerId: appConfig.discordOwnerId,
			discordAuthorizedUsers: appConfig.discordAuthorizedUsers,
			monitoringOptions: {
				pollInterval: appConfig.monitoringInterval,
				maxRetries: appConfig.maxRetries,
				autoRestart: appConfig.autoRestart,
			},
		};

		const daemon = new Daemon(config);
		await daemon.start();
	}
	catch (error) {
		console.error(`${new Date().toISOString()} [DAEMON:ERROR] Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

// Entry point is handled by src/daemon.ts - don't duplicate it here
