import { promises as fs } from 'node:fs';
import { consola } from 'consola';
import { define } from 'gunshi';
import { daemonManager } from '../core/daemon-manager.ts';
import { SessionManager } from '../core/session.ts';
import { TmuxManager } from '../core/tmux.ts';
import { getSessionLogPath } from '../utils/paths.ts';

/**
 * Read the last N lines from a file
 */
async function readLastLines(filePath: string, lines: number = 5): Promise<string[]> {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		const allLines = content.split('\n').filter(line => line.trim() !== '');
		return allLines.slice(-lines);
	}
	catch {
		return [];
	}
}

export const listCommand = define({
	name: 'list',
	description: 'List ccremote sessions for current project',
	args: {
		all: {
			type: 'boolean',
			description: 'Show sessions from all projects',
		},
	},
	async run(ctx) {
		const { all } = ctx.values;
		try {
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();

			await sessionManager.initialize();
			await daemonManager.loadDaemonPids();

			const sessions = all ? await sessionManager.listSessions() : await sessionManager.listSessionsForProject();
			const activeTmuxSessions = await tmuxManager.listSessions();

			if (sessions.length === 0) {
				if (all) {
					consola.info('No sessions found globally.');
				}
				else {
					consola.info('No sessions found for current project.');
					consola.info('Use --all to see sessions from all projects.');
				}
				consola.info('Create a session with: ccremote start');
				return;
			}

			if (all) {
				consola.info('All ccremote Sessions:');
			}
			else {
				consola.info(`ccremote Sessions for ${process.cwd()}:`);
			}
			consola.info('');

			for (const session of sessions) {
				const tmuxActive = activeTmuxSessions.some(tmuxSession => tmuxSession.name === session.tmuxSession);
				const daemon = daemonManager.getDaemon(session.id);
				const daemonActive = daemon && daemonManager.isDaemonRunning(session.id);

				const statusIcon = session.status === 'active' ? '✅' : session.status === 'waiting' ? '⏳' : '❌';
				const tmuxIcon = tmuxActive ? '🖥️' : '💀';
				const daemonIcon = daemonActive ? '🔄' : '💀';

				// Get log file path and last lines
				const logFilePath = daemon?.logFile || getSessionLogPath(session.id);
				const lastLines = await readLastLines(logFilePath, 5);

				consola.info(`${statusIcon} ${session.name} (${session.id})`);
				consola.info(`   Status: ${session.status}`);
				consola.info(`   Project: ${session.projectPath || 'Unknown'}`);
				consola.info(`   Tmux: ${session.tmuxSession} ${tmuxIcon}`);
				consola.info(`   Daemon: ${daemon ? `PM2 ${daemon.pm2Id}` : 'Not running'} ${daemonIcon}`);
				consola.info(`   Discord: ${session.channelId || 'Not assigned'}`);
				consola.info(`   Log File: ${logFilePath}`);
				consola.info(`   Created: ${new Date(session.created).toLocaleString()}`);
				consola.info(`   Last Activity: ${new Date(session.lastActivity).toLocaleString()}`);

				if (lastLines.length > 0) {
					consola.info(`   Last ${lastLines.length} log lines:`);
					for (const line of lastLines) {
						consola.info(`     ${line}`);
					}
				}
				else {
					consola.info('   No log data available');
				}
				consola.info('');
			}

			// Show cleanup suggestions
			const deadSessions = sessions.filter((s) => {
				const daemon = daemonManager.getDaemon(s.id);
				const daemonActive = daemon && daemonManager.isDaemonRunning(s.id);
				const tmuxActive = activeTmuxSessions.some(tmuxSession => tmuxSession.name === s.tmuxSession);
				return (!tmuxActive && !daemonActive) && s.status === 'active';
			});

			if (deadSessions.length > 0) {
				consola.warn('Dead sessions found (tmux and daemon not running):');
				for (const session of deadSessions) {
					consola.warn(`   ${session.name} (${session.id})`);
				}
				consola.info('');
				consola.info('Clean up with: ccremote stop --session <session-id>');
			}
		}
		catch (error) {
			consola.error('Failed to list sessions:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
