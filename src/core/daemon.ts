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

import type { MonitoringOptions } from './monitor.js';
import { promises as fs } from 'node:fs';

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
	 * Log to the session log file (daemon output only goes here)
	 */
	private async log(level: 'INFO' | 'WARN' | 'ERROR', message: string): Promise<void> {
		const timestamp = new Date().toISOString();
		const logEntry = `${timestamp} [DAEMON:${level}] ${message}\n`;
		await fs.appendFile(this.logFile, logEntry);
	}

	/**
	 * Start the daemon process
	 */
	async start(): Promise<void> {
		try {
			await this.log('INFO', `Daemon starting for session ${this.config.sessionId} (PID: ${process.pid})`);
			await this.log('INFO', `Working directory: ${process.cwd()}`);

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
			await this.log('INFO', 'Starting Discord bot...');
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
			this.monitor.on('limit_detected', (event) => {
				void this.log('INFO', `Usage limit detected for session ${event.sessionId}`);
			});

			this.monitor.on('continuation_ready', (event) => {
				void this.log('INFO', `Auto-continuing session ${event.sessionId}`);
			});

			this.monitor.on('approval_needed', (event) => {
				void this.log('INFO', `Approval required for session ${event.sessionId}`);
			});

			this.monitor.on('error', (event) => {
				void this.log('ERROR', `Monitor error for session ${event.sessionId}: ${event.data?.error || 'Unknown error'}`);
			});

			// Set up Discord approval handler - this was missing!
			this.discordBot.onApproval((sessionId: string, approved: boolean) => {
				void this.log('INFO', `Discord approval: ${approved ? 'approved' : 'denied'} for session ${sessionId}`);

				// Handle async operations
				void (async () => {
					try {
						// Send the approval response to tmux session
						const sessionData = await this.sessionManager.getSession(sessionId);
						if (sessionData) {
							await this.tmuxManager.sendApprovalResponse(sessionData.tmuxSession, approved);
							
							// Update session status back to active
							await this.sessionManager.updateSession(sessionId, { status: 'active' });
							
							await this.log('INFO', `Sent ${approved ? '1' : '2'} to tmux session ${sessionData.tmuxSession}`);
						}
					}
					catch (error) {
						await this.log('ERROR', `Failed to send approval response: ${error instanceof Error ? error.message : String(error)}`);
					}
				})();
			});

			// Start monitoring
			await this.log('INFO', 'Starting session monitoring...');
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
			await this.log('INFO', 'Daemon started successfully');

			// Keep the process alive
			await this.runLoop();
		}
		catch (error) {
			await this.log('ERROR', `Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
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
					await this.log('ERROR', 'Session no longer exists, shutting down daemon');
					break;
				}

				// Check if tmux session still exists
				const tmuxExists = await this.tmuxManager.sessionExists(session.tmuxSession);
				if (!tmuxExists) {
					await this.log('INFO', 'Tmux session ended, shutting down daemon');
					await this.sessionManager.updateSession(this.config.sessionId, { status: 'ended' });
					break;
				}

				// Sleep for a while before next check
				await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
			}
			catch (error) {
				await this.log('ERROR', `Error in daemon loop: ${error instanceof Error ? error.message : String(error)}`);
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

		await this.log('INFO', `Daemon shutting down (${reason})`);
		this.running = false;

		try {
			// Stop monitoring
			await this.monitor.stopAll();

			// Stop Discord bot
			await this.discordBot.stop();

			await this.log('INFO', 'Daemon shut down successfully');
		}
		catch (error) {
			await this.log('ERROR', `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
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
		const configArg = process.argv[2];
		if (!configArg) {
			console.info('Usage: daemon <config-json>');
			process.exit(1);
		}

		const config: DaemonConfig = JSON.parse(configArg);
		
		const daemon = new Daemon(config);
		await daemon.start();
	}
	catch (error) {
		// Try to log to file if we have config, otherwise console
		const configArg = process.argv[2];
		if (configArg) {
			try {
				const config: DaemonConfig = JSON.parse(configArg);
				await fs.appendFile(config.logFile, `${new Date().toISOString()} [DAEMON:ERROR] Failed to start daemon: ${error instanceof Error ? error.message : String(error)}\n`);
			} catch {
				console.info(`Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else {
			console.info(`Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
		}
		process.exit(1);
	}
}

// If this module is run directly, start the daemon
if (import.meta.url === `file://${process.argv[1]}`) {
	void startDaemon();
}
