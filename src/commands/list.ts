import { consola } from 'consola';
import { define } from 'gunshi';
import { daemonManager } from '../core/daemon-manager.js';
import { SessionManager } from '../core/session.js';
import { TmuxManager } from '../core/tmux.js';

export const listCommand = define({
	name: 'list',
	description: 'List all ccremote sessions',
	async run() {
		try {
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();

			await sessionManager.initialize();
			await daemonManager.loadDaemonPids();

			const sessions = await sessionManager.listSessions();
			const activeTmuxSessions = await tmuxManager.listSessions();

			if (sessions.length === 0) {
				consola.info('No sessions found.');
				consola.info('Create a session with: ccremote start');
				return;
			}

			consola.info('ccremote Sessions:');
			consola.info('');

			for (const session of sessions) {
				const tmuxActive = activeTmuxSessions.includes(session.tmuxSession);
				const daemon = daemonManager.getDaemon(session.id);
				const daemonActive = daemon && daemonManager.isDaemonRunning(session.id);

				const statusIcon = session.status === 'active' ? '✅' : session.status === 'waiting' ? '⏳' : '❌';
				const tmuxIcon = tmuxActive ? '🖥️' : '💀';
				const daemonIcon = daemonActive ? '🔄' : '💀';

				consola.info(`${statusIcon} ${session.name} (${session.id})`);
				consola.info(`   Status: ${session.status}`);
				consola.info(`   Tmux: ${session.tmuxSession} ${tmuxIcon}`);
				consola.info(`   Daemon: ${daemon ? `PID ${daemon.pid}` : 'Not running'} ${daemonIcon}`);
				consola.info(`   Discord: ${session.channelId || 'Not assigned'}`);
				consola.info(`   Created: ${new Date(session.created).toLocaleString()}`);
				consola.info(`   Last Activity: ${new Date(session.lastActivity).toLocaleString()}`);
				consola.info('');
			}

			// Show cleanup suggestions
			const deadSessions = sessions.filter((s) => {
				const daemon = daemonManager.getDaemon(s.id);
				const daemonActive = daemon && daemonManager.isDaemonRunning(s.id);
				const tmuxActive = activeTmuxSessions.includes(s.tmuxSession);
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
