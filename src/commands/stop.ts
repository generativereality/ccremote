import { consola } from 'consola';
import { define } from 'gunshi';
import { daemonManager } from '../core/daemon-manager.ts';
import { SessionManager } from '../core/session.ts';
import { TmuxManager } from '../core/tmux.ts';

export const stopCommand = define({
	name: 'stop',
	description: 'Stop ccremote session',
	args: {
		session: {
			type: 'string',
			description: 'Session ID or name to stop',
			required: true,
		},
		force: {
			type: 'boolean',
			description: 'Force stop even if tmux session is still active',
		},
	},
	async run(ctx) {
		const { session: sessionId, force } = ctx.values;
		try {
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();

			await sessionManager.initialize();

			// Find session by ID or name
			let session = await sessionManager.getSession(sessionId);
			if (!session) {
				session = await sessionManager.getSessionByName(sessionId);
			}

			if (!session) {
				consola.error(`Session not found: ${sessionId}`);
				consola.error('Use "ccremote list" to see available sessions');
				process.exit(1);
			}

			consola.start(`Stopping session: ${session.name} (${session.id})`);

			// Load daemon manager
			await daemonManager.loadDaemonPids();

			// Check if daemon is running
			const daemon = daemonManager.getDaemon(session.id);
			const daemonRunning = daemon && daemonManager.isDaemonRunning(session.id);

			// Check if tmux session is still running
			const tmuxActive = await tmuxManager.sessionExists(session.tmuxSession);

			if ((tmuxActive || daemonRunning) && !force) {
				consola.warn('Session is still active:');
				if (tmuxActive) { consola.warn('   • Tmux session is running'); }
				if (daemonRunning) { consola.warn('   • Daemon process is running'); }
				consola.warn('   This will kill all components and any running Claude Code instance');
				consola.warn('   Use --force to proceed or stop the session manually first');
				process.exit(1);
			}

			// Stop daemon first
			if (daemonRunning) {
				consola.info(`Stopping daemon process (PM2: ${daemon.pm2Id})...`);
				const daemonStopped = await daemonManager.stopDaemon(session.id);
				if (!daemonStopped) {
					consola.warn('Daemon was not running or already stopped');
				}
			}

			// Kill tmux session if running
			if (tmuxActive) {
				consola.info('Killing tmux session...');
				await tmuxManager.killSession(session.tmuxSession);
			}

			// Remove session from storage
			await sessionManager.deleteSession(session.id);

			consola.success('Session stopped successfully!');
			consola.info('');
			consola.info('Session cleaned up:');
			consola.info(`  Name: ${session.name}`);
			consola.info(`  ID: ${session.id}`);
			consola.info(`  Tmux session: ${session.tmuxSession} ${tmuxActive ? '(killed)' : '(already dead)'}`);
			if (daemon) {
				consola.info(`  Daemon: PM2 ${daemon.pm2Id} ${daemonRunning ? '(stopped)' : '(already dead)'}`);
			}
		}
		catch (error) {
			consola.error('Failed to stop session:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	},
});
