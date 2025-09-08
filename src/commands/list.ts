import { consola } from 'consola';
import { define } from 'gunshi';
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
				const statusIcon = session.status === 'active' ? '✅' : session.status === 'waiting' ? '⏳' : '❌';
				const tmuxIcon = tmuxActive ? '🖥️' : '💀';

				consola.info(`${statusIcon} ${session.name} (${session.id})`);
				consola.info(`   Status: ${session.status}`);
				consola.info(`   Tmux: ${session.tmuxSession} ${tmuxIcon}`);
				consola.info(`   Discord: ${session.channelId || 'Not assigned'}`);
				consola.info(`   Created: ${new Date(session.created).toLocaleString()}`);
				consola.info(`   Last Activity: ${new Date(session.lastActivity).toLocaleString()}`);
				consola.info('');
			}

			// Show cleanup suggestions
			const deadSessions = sessions.filter(s =>
				!activeTmuxSessions.includes(s.tmuxSession) && s.status === 'active',
			);

			if (deadSessions.length > 0) {
				consola.warn('Dead sessions found (tmux not running):');
				for (const session of deadSessions) {
					consola.warn(`   ${session.name} (${session.id})`);
				}
				consola.info('');
				consola.info('Clean up with: ccremote stop <session-id>');
			}
		}
		catch (error) {
			consola.error('Failed to list sessions:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
