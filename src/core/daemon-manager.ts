/**
 * @fileoverview Daemon process spawning and management
 *
 * Handles spawning, monitoring, and lifecycle management of daemon processes.
 * Each session gets its own daemon process that runs in the background.
 */

import type { DaemonConfig } from './daemon.js';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
	 * Get the PM2 binary path from the bundled package
	 */
	private getPm2BinaryPath(): string {
		// Get the directory where this file is located
		const currentFileUrl = import.meta.url;
		const currentFilePath = fileURLToPath(currentFileUrl);
		const currentDir = dirname(currentFilePath);
		
		// Try to find PM2 in several locations
		const possiblePaths = [
			// In development: ccremote/src/core/daemon-manager.ts -> ccremote/node_modules/pm2/bin/pm2
			join(currentDir, '../../node_modules/pm2/bin/pm2'),
			// In bundled dist: ccremote/dist/daemon-manager.js -> ccremote/node_modules/pm2/bin/pm2
			join(currentDir, '../node_modules/pm2/bin/pm2'),
			// When installed via global symlink: resolve from symlink target
			join(dirname(process.argv[1]), '../node_modules/pm2/bin/pm2'),
			// When packaged: relative to package root
			join(dirname(currentDir), 'node_modules/pm2/bin/pm2'),
		];

		// Test each path and return the first one that exists
		for (const path of possiblePaths) {
			try {
				require('fs').accessSync(path, require('fs').constants.F_OK);
				return path;
			}
			catch {
				// Try next path
			}
		}

		throw new Error('PM2 binary not found. Please ensure PM2 is properly installed.');
	}

	/**
	 * Prepare PM2 command arguments and binary
	 */
	private preparePm2Command(args: string[]): { binary: string; args: string[] } {
		const pm2Binary = this.getPm2BinaryPath();
		
		return {
			binary: pm2Binary,
			args: args
		};
	}

	/**
	 * Get the daemon script path
	 */
	private async getDaemonScriptPath(): Promise<string> {
		// Get the directory where this file is located
		const currentFileUrl = import.meta.url;
		const currentFilePath = fileURLToPath(currentFileUrl);
		const currentDir = dirname(currentFilePath);
		
		// Try different locations for the daemon script
		const possiblePaths = [
			// In development: ccremote/src/core/daemon-manager.ts -> ccremote/dist/daemon.js
			join(currentDir, '../../dist/daemon.js'),
			// In bundled dist: ccremote/dist/core/daemon-manager.js -> ccremote/dist/daemon.js  
			join(currentDir, '../daemon.js'),
			// As fallback, try the same directory
			join(currentDir, 'daemon.js'),
		];

		for (const path of possiblePaths) {
			try {
				await fs.access(path);
				return path;
			}
			catch {
				// Try next path
			}
		}

		throw new Error('Could not find daemon.js script');
	}

	/**
	 * Spawn a new daemon process for a session using PM2
	 */
	async spawnDaemon(config: DaemonConfig): Promise<DaemonProcess> {
		const pm2Name = `${config.sessionId}-daemon`;

		// Get the daemon script path
		const daemonScript = await this.getDaemonScriptPath();
		
		// Prepare PM2 command with log redirection
		const pm2Command = this.preparePm2Command([
			'start',
			daemonScript,
			'--name',
			pm2Name,
			'--no-autorestart', // We'll handle restarts ourselves
			'--output',
			config.logFile, // Redirect stdout to daemon log file
			'--error', 
			config.logFile, // Redirect stderr to daemon log file
			'--merge-logs', // Merge stdout and stderr into single file
		]);

		// Start with PM2 using environment variables for config
		return new Promise((resolve, reject) => {
			const pm2Process = spawn(pm2Command.binary, pm2Command.args, {
				stdio: ['ignore', 'pipe', 'pipe'],
				cwd: process.cwd(),
				env: {
					...process.env,
					NODE_ENV: 'production',
					CCREMOTE_SESSION_ID: config.sessionId, // Pass session ID via environment
				},
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
				const listCommand = this.preparePm2Command(['list', pm2Name, '--format']);
				const listProcess = spawn(listCommand.binary, listCommand.args, {
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
			const stopCommand = this.preparePm2Command(['stop', daemon.pm2Id]);
			const stopProcess = spawn(stopCommand.binary, stopCommand.args, {
				stdio: 'ignore',
			});

			stopProcess.on('close', async (code) => {
				// Delete the process from PM2
				const deleteCommand = this.preparePm2Command(['delete', daemon.pm2Id]);
				const deleteProcess = spawn(deleteCommand.binary, deleteCommand.args, {
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

		// For PM2 managed processes, we assume they're running if they're in our tracking
		// PM2 handles process lifecycle management and restarts
		return true;
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
		// Return all tracked daemons - PM2 manages their lifecycle
		return Array.from(this.daemons.values());
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
				if (!pidInfo.pm2Id) { continue; } // Skip invalid entries

				try {
					// Check if PM2 process exists
					const describeCommand = this.preparePm2Command(['describe', pidInfo.pm2Id]);
					const checkProcess = spawn(describeCommand.binary, describeCommand.args, {
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
