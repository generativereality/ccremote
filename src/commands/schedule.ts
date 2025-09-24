import type { DaemonConfig } from '../core/daemon.ts';
import { consola } from 'consola';
import { define } from 'gunshi';
import { loadConfig, validateConfig } from '../core/config.ts';
import { daemonManager } from '../core/daemon-manager.ts';
import { SessionManager } from '../core/session.ts';
import { TmuxManager } from '../core/tmux.ts';
import { generateQuotaMessage } from '../utils/quota.ts';

export const scheduleCommand = define({
	name: 'schedule',
	description: 'Schedule quota window alignment with early dummy commands',
	args: {
		time: {
			type: 'string',
			description: 'Time to start early quota window (e.g., "5:00", "5am", "17:30")',
		},
		session: {
			type: 'string',
			description: 'Session ID to schedule for (creates new session if not provided)',
		},
		list: {
			type: 'boolean',
			description: 'List all scheduled quota windows',
		},
		cancel: {
			type: 'string',
			description: 'Cancel a scheduled task by ID',
		},
	},
	async run(ctx) {
		const { time } = ctx.values;
		consola.start('Starting quota scheduling...');

		// Load and validate configuration (like start command)
		let config;
		try {
			config = loadConfig();
			validateConfig(config);
		}
		catch (error) {
			consola.error('Configuration error:', error instanceof Error ? error.message : error);
			consola.error('Run `ccremote init` to set up configuration first');
			process.exit(1);
		}

		if (!time) {
			consola.error('Time is required. Example: ccremote schedule --time "5:00"');
			process.exit(1);
		}

		// Parse time to get the next execution
		const executeAt = parseTimeToNextOccurrence(time);
		if (!executeAt) {
			consola.error(`Invalid time format: ${time}. Use format like "5:00", "5am", "17:30"`);
			process.exit(1);
		}

		try {
			// Initialize managers (like start command)
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();

			// Check if tmux is available
			if (!(await tmuxManager.isTmuxAvailable())) {
				consola.error('tmux is not installed or not available in PATH');
				consola.info('Install tmux first: brew install tmux (macOS) or sudo apt install tmux (Ubuntu)');
				process.exit(1);
			}

			await sessionManager.initialize();

			// Create session for quota scheduling
			const session = await sessionManager.createSession(`quota-${time.replace(/\D/g, '')}-${Date.now()}`);

			// Create tmux session and start Claude Code
			consola.info('Creating tmux session and starting Claude Code...');
			await tmuxManager.createSession(session.tmuxSession);

			// Calculate delay until execution time
			const now = new Date();
			const delayMs = executeAt.getTime() - now.getTime();
			const delayMinutes = Math.round(delayMs / (1000 * 60));

			// Define the command and add quota schedule metadata to session
			const command = generateQuotaMessage(executeAt);
			const stagingMessage = `# Quota window message scheduled for ${executeAt.toLocaleString()} (in ${delayMinutes} minutes)`;

			await sessionManager.updateSession(session.id, {
				quotaSchedule: {
					time,
					command,
					nextExecution: executeAt.toISOString(),
				},
			});

			// Just send the staging message initially - the actual command will be sent by the monitor
			await tmuxManager.sendKeys(session.tmuxSession, stagingMessage);
			await tmuxManager.sendKeys(session.tmuxSession, 'Enter');

			// Create log file path
			const { promises: fs } = await import('node:fs');
			const os = await import('node:os');
			const path = await import('node:path');

			const globalLogsDir = path.join(os.homedir(), '.ccremote', 'logs');
			const projectName = path.basename(process.cwd());
			const logFile = path.join(globalLogsDir, `${projectName}-${session.id}.log`);
			await fs.mkdir(globalLogsDir, { recursive: true });

			consola.success(`Created quota session: ${session.name} (${session.id})`);

			// Prepare daemon configuration
			const daemonConfig: DaemonConfig = {
				sessionId: session.id,
				logFile,
				discordBotToken: config.discordBotToken,
				discordOwnerId: config.discordOwnerId,
				discordAuthorizedUsers: config.discordAuthorizedUsers,
				monitoringOptions: {
					pollInterval: config.monitoringInterval,
					maxRetries: config.maxRetries,
					autoRestart: config.autoRestart,
				},
			};

			// Start daemon (like start command)
			consola.info('Starting background daemon...');
			const daemon = await daemonManager.spawnDaemon(daemonConfig);

			consola.success('Quota scheduling started successfully!');
			consola.info('');
			consola.info('Session Details:');
			consola.info(`  Name: ${session.name}`);
			consola.info(`  ID: ${session.id}`);
			consola.info(`  Tmux: ${session.tmuxSession}`);
			consola.info(`  Daemon PM2: ${daemon.pm2Id}`);
			consola.info(`  Next execution: ${executeAt.toLocaleString()}`);
			consola.info('');
			consola.info('💡 Usage:');
			consola.info('  ccremote list              # View sessions');
			consola.info('  ccremote stop <session>    # Stop quota scheduling');
			consola.info(`  tail -f ${logFile}         # Watch logs`);
			consola.info('');
			consola.info('🎯 The command will execute automatically at the scheduled time daily!');
			consola.info('');
			consola.info('⏳ Waiting 5 seconds before attaching to Claude Code session...');

			// Wait 5 seconds for Claude Code to initialize
			await new Promise(resolve => setTimeout(resolve, 5000));

			// Attach to tmux session (like start command)
			consola.info('🔗 Attaching to tmux session...');
			const { spawn } = await import('node:child_process');
			const attachProcess = spawn('tmux', ['attach-session', '-t', session.tmuxSession], {
				stdio: 'inherit',
			});

			attachProcess.on('exit', (code) => {
				process.exit(code || 0);
			});
		}
		catch (error) {
			consola.error('Failed to start quota scheduling:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});

/**
 * Parse time string to next occurrence (today if future, tomorrow if past)
 * Supports formats: "5:00", "5am", "17:30", "5:30pm"
 */
function parseTimeToNextOccurrence(timeStr: string): Date | null {
	try {
		const now = new Date();
		timeStr = timeStr.toLowerCase().trim();

		// Match patterns like "5:00", "5am", "17:30", "5:30pm"
		const timeMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
		if (!timeMatch) {
			return null;
		}

		const [, hours, minutes, period] = timeMatch;
		let numHours = Number.parseInt(hours, 10);
		const numMinutes = minutes ? Number.parseInt(minutes, 10) : 0;

		// Handle AM/PM conversion
		if (period) {
			if (period === 'pm' && numHours !== 12) {
				numHours += 12;
			}
			else if (period === 'am' && numHours === 12) {
				numHours = 0;
			}
		}

		// Validate time
		if (numHours < 0 || numHours > 23 || numMinutes < 0 || numMinutes > 59) {
			return null;
		}

		const executeAt = new Date(now);
		executeAt.setHours(numHours, numMinutes, 0, 0);

		// If the time has passed today, schedule for tomorrow
		if (executeAt <= now) {
			executeAt.setDate(executeAt.getDate() + 1);
		}

		return executeAt;
	}
	catch (error) {
		consola.error(`Failed to parse time: ${error} for input: ${timeStr}`);
		return null;
	}
}
