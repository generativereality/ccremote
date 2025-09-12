/**
 * @fileoverview Daemon process spawning and management
 *
 * Handles spawning, monitoring, and lifecycle management of daemon processes.
 * Each session gets its own daemon process that runs in the background.
 */

import type { DaemonConfig } from './daemon.js';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export type DaemonProcess = {
	sessionId: string;
	pm2Id: string;
	logFile: string;
	startTime: Date;
};

export class DaemonManager {
	private daemons = new Map<string, DaemonProcess>();
	private daemonPidsFile: string;

	constructor() {
		this.daemonPidsFile = join(process.cwd(), '.ccremote', 'daemon-pids.json');
	}

	/**
	 * Spawn a new daemon process for a session using PM2
	 */
	async spawnDaemon(config: DaemonConfig): Promise<DaemonProcess> {
		const pm2Name = `${config.sessionId}-daemon`;
		
		// Find daemon script - either in development or installed package
		let daemonScript: string;
		try {
			// Try local development path first
			daemonScript = join(process.cwd(), 'dist/daemon.js');
			await fs.access(daemonScript);
		} catch {
			// Fallback to installed package path
			daemonScript = join(import.meta.dirname, '../../dist/daemon.js');
		}
		
		// Use direct PM2 command with environment variables - simple and reliable
		// Don't specify log files to avoid race conditions - daemon handles its own logging
		const pm2Args = [
			'pm2', 'start', daemonScript,
			'--name', pm2Name,
			'--no-autorestart' // We'll handle restarts ourselves
		];

		// Start with PM2 using environment variables for config
		return new Promise((resolve, reject) => {
			const pm2Process = spawn('npx', pm2Args, {
				stdio: ['ignore', 'pipe', 'pipe'],
				cwd: process.cwd(),
				env: {
					...process.env,
					NODE_ENV: 'production',
					CCREMOTE_SESSION_ID: config.sessionId, // Pass session ID via environment
				}
			});

			let stdout = '';
			let stderr = '';

			pm2Process.stdout?.on('data', (data) => {
				stdout += data.toString();
			});

			pm2Process.stderr?.on('data', (data) => {
				stderr += data.toString();
			});

			pm2Process.on('close', async (code) => {
				if (code !== 0) {
					reject(new Error(`PM2 start failed: ${stderr || stdout}`));
					return;
				}

				// Get process info from PM2
				const listProcess = spawn('npx', ['pm2', 'list', pm2Name, '--format'], {
					stdio: ['ignore', 'pipe', 'pipe'],
				});

				let listOutput = '';
				listProcess.stdout?.on('data', (data) => {
					listOutput += data.toString();
				});

				listProcess.on('close', async (listCode) => {
					// Don't fail if we can't get exact PID - PM2 handles process management
					// We'll use a placeholder PID and rely on PM2 for process tracking
					const daemon: DaemonProcess = {
						sessionId: config.sessionId,
						pm2Id: pm2Name,
						logFile: config.logFile,
						startTime: new Date(),
					};

					// Store in memory
					this.daemons.set(config.sessionId, daemon);

					// Persist to file
					await this.saveDaemonPids();

					resolve(daemon);
				});
			});
		});
	}

	/**
	 * Stop a daemon process using PM2
	 */
	async stopDaemon(sessionId: string): Promise<boolean> {
		const daemon = this.daemons.get(sessionId);
		if (!daemon) {
			return false;
		}

		return new Promise((resolve) => {
			const stopProcess = spawn('npx', ['pm2', 'stop', daemon.pm2Id], {
				stdio: 'ignore',
			});

			stopProcess.on('close', async (code) => {
				// Delete the process from PM2
				const deleteProcess = spawn('npx', ['pm2', 'delete', daemon.pm2Id], {
					stdio: 'ignore',
				});

				deleteProcess.on('close', async () => {
					// Remove from tracking  
					this.daemons.delete(sessionId);
					await this.saveDaemonPids();

					resolve(true);
				});
			});
		});
	}

	/**
	 * Check if a daemon is running for a session
	 */
	isDaemonRunning(sessionId: string): boolean {
		const daemon = this.daemons.get(sessionId);
		if (!daemon) {
			return false;
		}

		try {
			// Check if process still exists
			process.kill(daemon.pid, 0);
			return true;
		}
		catch {
			// Process doesn't exist
			this.daemons.delete(sessionId);
			void this.saveDaemonPids();
			return false;
		}
	}

	/**
	 * Get daemon info for a session
	 */
	getDaemon(sessionId: string): DaemonProcess | undefined {
		return this.daemons.get(sessionId);
	}

	/**
	 * Get all running daemons
	 */
	getAllDaemons(): DaemonProcess[] {
		return Array.from(this.daemons.values()).filter((daemon) => {
			// Filter out dead processes
			try {
				process.kill(daemon.pid, 0);
				return true;
			}
			catch {
				this.daemons.delete(daemon.sessionId);
				void this.saveDaemonPids();
				return false;
			}
		});
	}

	/**
	 * Stop all daemons
	 */
	async stopAllDaemons(): Promise<void> {
		const sessionIds = Array.from(this.daemons.keys());
		await Promise.all(sessionIds.map(async id => this.stopDaemon(id)));
	}

	/**
	 * Load daemon PIDs from file (for recovery after restart)
	 */
	async loadDaemonPids(): Promise<void> {
		try {
			const data = await fs.readFile(this.daemonPidsFile, 'utf-8');
			const pids: Array<{ sessionId: string; pm2Id?: string; logFile: string; startTime: string }> = JSON.parse(data);

			for (const pidInfo of pids) {
				if (!pidInfo.pm2Id) continue; // Skip invalid entries
				
				try {
					// Check if PM2 process exists
					const checkProcess = spawn('npx', ['pm2', 'describe', pidInfo.pm2Id], {
						stdio: ['ignore', 'pipe', 'ignore'],
					});

					checkProcess.on('close', (code) => {
						if (code === 0) {
							// PM2 process exists - recreate daemon entry
							this.daemons.set(pidInfo.sessionId, {
								sessionId: pidInfo.sessionId,
								pm2Id: pidInfo.pm2Id!,
								logFile: pidInfo.logFile,
								startTime: new Date(pidInfo.startTime),
							});
						}
					});
				}
				catch {
					// Process doesn't exist, skip it
				}
			}
		}
		catch {
			// File doesn't exist or is invalid, start fresh
		}
	}

	/**
	 * Save daemon PIDs to file
	 */
	private async saveDaemonPids(): Promise<void> {
		try {
			// Ensure directory exists
			await fs.mkdir(join(process.cwd(), '.ccremote'), { recursive: true });

			const pids = Array.from(this.daemons.values()).map(daemon => ({
				sessionId: daemon.sessionId,
				pm2Id: daemon.pm2Id,
				logFile: daemon.logFile,
				startTime: daemon.startTime.toISOString(),
			}));

			await fs.writeFile(this.daemonPidsFile, JSON.stringify(pids, null, 2));
		}
		catch (error) {
			// Log error but don't fail the operation
			console.info('Failed to save daemon PIDs:', error);
		}
	}
}

// Global daemon manager instance
export const daemonManager = new DaemonManager();
