import type { SessionState } from '../types/index.ts';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { consola } from 'consola';
import { define } from 'gunshi';
import { daemonManager } from '../core/daemon-manager.ts';
import { DiscordBot } from '../core/discord.ts';
import { SessionManager } from '../core/session.ts';
import { TmuxManager } from '../core/tmux.ts';

export const cleanCommand = define({
	name: 'clean',
	description: 'Remove ended and dead sessions, archive log files',
	args: {
		'dry-run': {
			type: 'boolean',
			description: 'Show what would be cleaned without making changes',
		},
	},
	async run(ctx) {
		const { 'dry-run': dryRun } = ctx.values;

		if (dryRun) {
			consola.info('🔍 Running in dry-run mode - no changes will be made');
		}

		consola.start('Cleaning up sessions...');

		try {
			// Initialize managers
			const sessionManager = new SessionManager();
			const tmuxManager = new TmuxManager();
			await sessionManager.initialize();

			// Initialize Discord bot if configured
			let discordBot: DiscordBot | null = null;
			const botToken = process.env.CCREMOTE_DISCORD_BOT_TOKEN;
			const ownerId = process.env.CCREMOTE_DISCORD_OWNER_ID;

			if (botToken && ownerId) {
				try {
					discordBot = new DiscordBot(sessionManager, tmuxManager);
					const authorizedUsersConfig = process.env.CCREMOTE_DISCORD_AUTHORIZED_USERS;
					const authorizedUsers = authorizedUsersConfig
						? authorizedUsersConfig.split(',').map(u => u.trim())
						: [];

					await discordBot.start(botToken, ownerId, authorizedUsers);
					consola.info('🤖 Discord bot initialized for channel cleanup');
				}
				catch (error) {
					consola.warn(`Failed to initialize Discord bot: ${error instanceof Error ? error.message : String(error)}`);
					discordBot = null;
				}
			}

			// Ensure daemon manager is fully initialized
			await daemonManager.ensureInitialized();

			// Get all sessions
			const sessions = await sessionManager.listSessions();
			const cleanupSessions: SessionState[] = [];
			const archiveLogs: string[] = [];

			// Find sessions to clean up - only clean truly dead sessions
			for (const session of sessions) {
				let shouldClean = false;
				let reason = '';

				const tmuxExists = await tmuxManager.sessionExists(session.tmuxSession);

				// Rule 1: If explicitly marked as ended, clean it
				if (session.status === 'ended') {
					shouldClean = true;
					reason = 'session ended';
				}
				// Rule 2: If tmux session is dead, clean it (session is definitely not in use)
				else if (!tmuxExists) {
					shouldClean = true;
					reason = 'tmux session dead';
				}
				// Rule 3: NEVER clean sessions with active tmux sessions - they're in use
				// This prevents accidentally killing active sessions

				if (shouldClean) {
					cleanupSessions.push(session);

					// Check for log files to archive
					const { getAllSessionLogPaths } = await import('../utils/paths.js');

					// Check all possible log locations
					for (const logPath of getAllSessionLogPaths(session.id)) {
						try {
							await fs.access(logPath);
							archiveLogs.push(logPath);
						}
						catch {
							// Log doesn't exist at this path
						}
					}

					consola.info(`📋 Session ${session.id} (${session.name}): ${reason}`);
				}
			}

			// Check for orphaned Discord channels regardless of session cleanup
			let orphanedChannels: string[] = [];
			if (discordBot) {
				const activeSessions = sessions
					.filter(session => !cleanupSessions.includes(session))
					.map(session => ({ id: session.id, name: session.name }));

				orphanedChannels = await discordBot.findOrphanedChannels(activeSessions);
			}

			// Early return only if no sessions AND no orphaned channels
			if (cleanupSessions.length === 0 && orphanedChannels.length === 0) {
				consola.success('✨ No sessions or orphaned channels need cleaning');
				if (discordBot) {
					try {
						await discordBot.shutdown();
					}
					catch {
						// Ignore shutdown errors
					}
				}
				return;
			}

			// Report what will be cleaned
			if (cleanupSessions.length > 0) {
				consola.info(`\n📊 Found ${cleanupSessions.length} sessions to clean:`);
				for (const session of cleanupSessions) {
					consola.info(`  • ${session.id} (${session.name}) - ${session.status}`);
				}
			}

			if (archiveLogs.length > 0) {
				consola.info(`\n📁 Found ${archiveLogs.length} log files to archive`);
			}

			if (discordBot) {
				const totalChannelsToArchive = cleanupSessions.length + orphanedChannels.length;

				if (totalChannelsToArchive > 0) {
					consola.info(`\n📺 Found ${totalChannelsToArchive} Discord channels to archive`);
					if (cleanupSessions.length > 0) {
						consola.info(`  • ${cleanupSessions.length} channels from ended sessions`);
					}
					if (orphanedChannels.length > 0) {
						consola.info(`  • ${orphanedChannels.length} orphaned channels`);
					}
				}
			}

			if (dryRun) {
				consola.info('\n🔍 Dry-run complete - no changes made');
				if (discordBot) {
					// Cleanup Discord bot connection for dry run
					try {
						await discordBot.shutdown();
					}
					catch {
						// Ignore shutdown errors
					}
				}
				return;
			}

			// Create archive directory in global location
			const { getArchiveDir } = await import('../utils/paths.js');
			const archiveDir = getArchiveDir();
			try {
				await fs.mkdir(archiveDir, { recursive: true });
			}
			catch (error: unknown) {
				consola.warn(`Failed to create archive directory: ${error instanceof Error ? error.message : String(error)}`);
			}

			// Archive log files
			let archivedCount = 0;
			for (const logPath of archiveLogs) {
				try {
					const logFileName = basename(logPath);
					const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
					const archivePath = join(archiveDir, `${timestamp}-${logFileName}`);

					await fs.rename(logPath, archivePath);
					archivedCount++;
					consola.info(`📦 Archived: ${logPath} → ${archivePath}`);
				}
				catch (error: unknown) {
					consola.warn(`Failed to archive ${logPath}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}

			// Stop running daemons for sessions being cleaned
			let stoppedDaemons = 0;
			for (const session of cleanupSessions) {
				try {
					const daemonInfo = daemonManager.getDaemon(session.id);
					if (daemonInfo) {
						await daemonManager.stopDaemon(session.id);
						stoppedDaemons++;
						consola.info(`🛑 Stopped daemon for session ${session.id}`);
					}
				}
				catch (error: unknown) {
					consola.warn(`Failed to stop daemon for ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}

			// Archive Discord channels for ended sessions
			let archivedChannels = 0;
			if (discordBot) {
				// Archive channels for sessions being cleaned up
				for (const session of cleanupSessions) {
					try {
						await discordBot.cleanupSessionChannel(session.id);
						archivedChannels++;
						consola.info(`📺 Archived Discord channel for session ${session.id}`);
					}
					catch (error: unknown) {
						consola.warn(`Failed to archive Discord channel for ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
					}
				}

				// Archive orphaned channels that were already found
				if (orphanedChannels.length > 0) {
					for (const channelId of orphanedChannels) {
						try {
							const success = await discordBot.archiveOrphanedChannel(channelId);
							if (success) {
								archivedChannels++;
								consola.info(`📺 Archived orphaned Discord channel ${channelId}`);
							}
						}
						catch (error: unknown) {
							consola.warn(`Failed to archive orphaned channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}
			}

			// Kill dead tmux sessions
			let killedSessions = 0;
			for (const session of cleanupSessions) {
				try {
					if (await tmuxManager.sessionExists(session.tmuxSession)) {
						await tmuxManager.killSession(session.tmuxSession);
						killedSessions++;
						consola.info(`💀 Killed tmux session ${session.tmuxSession}`);
					}
				}
				catch (error: unknown) {
					consola.warn(`Failed to kill tmux session ${session.tmuxSession}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}

			// Remove sessions from database
			let removedSessions = 0;
			for (const session of cleanupSessions) {
				try {
					await sessionManager.deleteSession(session.id);
					removedSessions++;
				}
				catch (error: unknown) {
					consola.warn(`Failed to remove session ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}

			consola.success(`\n✨ Cleanup complete:`);
			consola.info(`  • Removed ${removedSessions} session records`);
			consola.info(`  • Stopped ${stoppedDaemons} daemon processes`);
			consola.info(`  • Killed ${killedSessions} tmux sessions`);
			consola.info(`  • Archived ${archivedCount} log files`);
			if (discordBot) {
				consola.info(`  • Archived ${archivedChannels} Discord channels`);
				// Cleanup Discord bot connection
				try {
					await discordBot.shutdown();
				}
				catch {
					// Ignore shutdown errors
				}
			}
		}
		catch (error: unknown) {
			consola.error('Failed to clean sessions:', error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	},
});
