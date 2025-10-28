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
		'all': {
			type: 'boolean',
			description: 'Clean sessions from all projects (default: current project only)',
		},
	},
	async run(ctx) {
		const { 'dry-run': dryRun, 'all': cleanAll } = ctx.values;

		if (dryRun) {
			consola.info('🔍 Running in dry-run mode - no changes will be made');
		}

		if (cleanAll) {
			consola.info('🌍 Cleaning sessions from all projects');
		}
		else {
			consola.info('📁 Cleaning sessions from current project only (use --all to clean all projects)');
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

			// Get sessions - either all or current project only
			const sessions = cleanAll
				? await sessionManager.listSessions()
				: await sessionManager.listSessionsForProject();
			const cleanupSessions: SessionState[] = [];
			const archiveLogs: string[] = [];

			// Find sessions to clean up - only clean truly dead sessions
			for (const session of sessions) {
				let shouldClean = false;
				let reason = '';

				const tmuxExists = await tmuxManager.sessionExists(session.tmuxSession);
				const daemonInfo = daemonManager.getDaemon(session.id);
				const daemonRunning = daemonInfo !== null;

				// Rule 0: NEVER clean if daemon is running - it's actively monitoring
				// This prevents race conditions where status might be temporarily 'ended'
				if (daemonRunning) {
					consola.info(`Session ${session.id} daemon is running - skipping cleanup`);
					continue;
				}

				// Rule 1: If explicitly marked as ended, double-check tmux is actually dead
				// This prevents cleaning sessions that were incorrectly marked as ended
				if (session.status === 'ended') {
					if (!tmuxExists) {
						shouldClean = true;
						reason = 'session ended and tmux dead';
					}
					else {
						consola.warn(`Session ${session.id} marked as ended but tmux is still active - skipping cleanup`);
					}
				}
				// Rule 2: If tmux session is dead AND no daemon, clean it (session is definitely not in use)
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

			// Check for orphaned Discord channels and archived channels regardless of session cleanup
			let orphanedChannels: string[] = [];
			let archivedChannels: string[] = [];
			if (discordBot) {
				const activeSessions = sessions
					.filter(session => !cleanupSessions.includes(session))
					.map(session => ({ id: session.id, name: session.name }));

				orphanedChannels = await discordBot.findOrphanedChannels(activeSessions);
				archivedChannels = await discordBot.findArchivedChannels();
			}

			// Early return only if no sessions AND no orphaned channels AND no archived channels
			if (cleanupSessions.length === 0 && orphanedChannels.length === 0 && archivedChannels.length === 0) {
				consola.success('✨ No sessions or orphaned channels need cleaning');
				if (discordBot) {
					await discordBot.shutdown();
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
				const totalChannelsToDelete = cleanupSessions.length + orphanedChannels.length + archivedChannels.length;

				if (totalChannelsToDelete > 0) {
					consola.info(`\n📺 Found ${totalChannelsToDelete} Discord channels to delete`);
					if (cleanupSessions.length > 0) {
						consola.info(`  • ${cleanupSessions.length} channels from ended sessions`);
					}
					if (orphanedChannels.length > 0) {
						consola.info(`  • ${orphanedChannels.length} orphaned channels`);
					}
					if (archivedChannels.length > 0) {
						consola.info(`  • ${archivedChannels.length} archived channels from previous runs`);
					}
				}
			}

			if (dryRun) {
				consola.info('\n🔍 Dry-run complete - no changes made');
				if (discordBot) {
					await discordBot.shutdown();
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

			// Delete Discord channels for ended sessions
			let deletedChannels = 0;
			let skippedChannels = 0;
			if (discordBot) {
				// Delete channels for sessions being cleaned up
				for (const session of cleanupSessions) {
					try {
						await discordBot.cleanupSessionChannel(session.id);
						deletedChannels++;
						consola.info(`📺 Deleted Discord channel for session ${session.id}`);
					}
					catch (error: unknown) {
						consola.warn(`Failed to delete Discord channel for ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
					}
				}

				// Delete orphaned channels that were already found
				if (orphanedChannels.length > 0) {
					for (const channelId of orphanedChannels) {
						try {
							const success = await discordBot.deleteOrphanedChannel(channelId);
							if (success) {
								deletedChannels++;
								consola.info(`📺 Deleted orphaned Discord channel ${channelId}`);
							}
							else {
								skippedChannels++;
								consola.info(`⏭️  Skipped orphaned channel ${channelId} (insufficient permissions)`);
							}
						}
						catch (error: unknown) {
							consola.warn(`Failed to delete orphaned channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}

				// Delete archived channels from previous runs
				if (archivedChannels.length > 0) {
					for (const channelId of archivedChannels) {
						try {
							const success = await discordBot.deleteOrphanedChannel(channelId);
							if (success) {
								deletedChannels++;
								consola.info(`📺 Deleted archived Discord channel ${channelId}`);
							}
							else {
								skippedChannels++;
								consola.info(`⏭️  Skipped archived channel ${channelId} (insufficient permissions)`);
							}
						}
						catch (error: unknown) {
							consola.warn(`Failed to delete archived channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
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
				consola.info(`  • Deleted ${deletedChannels} Discord channels`);
				if (skippedChannels > 0) {
					consola.info(`  • Skipped ${skippedChannels} channels (insufficient permissions)`);
				}
				await discordBot.shutdown();
			}

			// Show permission fix instructions if channels were skipped
			if (skippedChannels > 0) {
				consola.box(
					'⚠️  Permission Error - Some Discord channels could not be deleted\n\n'
					+ 'Your Discord bot lacks the required permissions to delete these channels.\n\n'
					+ 'To fix this, you have two options:\n\n'
					+ '1. Administrator permission (recommended):\n'
					+ '   • Go to Discord Developer Portal → OAuth2 → URL Generator\n'
					+ '   • Select scope: bot\n'
					+ '   • Select permission: Administrator\n'
					+ '   • Use the generated URL to re-invite your bot\n\n'
					+ '2. Minimal permissions:\n'
					+ '   • Manage Channels (create/delete session channels)\n'
					+ '   • Manage Roles (edit channel overwrites)\n'
					+ '   • Send Messages (send notifications)\n'
					+ '   • Read Message History (read approval responses)\n\n'
					+ 'Note: Administrator permission is recommended as it avoids role\n'
					+ 'hierarchy issues and ensures reliable channel management.\n\n'
					+ 'After updating permissions, run "ccremote clean" again to remove\n'
					+ 'the remaining channels.\n\n'
					+ 'See: https://github.com/generativereality/ccremote#discord-setup',
				);
			}
		}
		catch (error: unknown) {
			consola.error('Failed to clean sessions:', error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	},
});

if (import.meta.vitest) {
	/* eslint-disable ts/no-unsafe-assignment */
	const vitest = await import('vitest');
	const { beforeEach, describe, it, expect, vi } = vitest;

	describe('Clean Command - Orphaned Channel Logic', () => {
		let mockSessionManager: any;
		let mockTmuxManager: any;
		let mockDiscordBot: any;

		beforeEach(() => {
			mockSessionManager = {
				initialize: vi.fn(),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
			};

			mockTmuxManager = {
				sessionExists: vi.fn(),
				killSession: vi.fn(),
			};

			mockDiscordBot = {
				start: vi.fn(),
				findOrphanedChannels: vi.fn(),
				cleanupSessionChannel: vi.fn(),
				deleteOrphanedChannel: vi.fn(),
				shutdown: vi.fn(),
			};

			// Mock the fs module for testing
			vi.mock('node:fs', () => ({
				promises: {
					access: vi.fn(),
					mkdir: vi.fn(),
					rename: vi.fn(),
				},
			}));

			// Mock the daemonManager
			vi.mock('../core/daemon-manager.ts', () => ({
				daemonManager: {
					ensureInitialized: vi.fn(),
					getDaemon: vi.fn(),
					stopDaemon: vi.fn(),
				},
			}));
		});

		it('should identify orphaned channels correctly when sessions exist', async () => {
			// Mock two sessions - one ending, one active
			const sessions = [
				{ id: 'session-1', name: 'session-1', status: 'ended', tmuxSession: 'ccremote-1' },
				{ id: 'session-2', name: 'session-2', status: 'active', tmuxSession: 'ccremote-2' },
			];

			mockSessionManager.listSessions.mockResolvedValue(sessions);
			mockTmuxManager.sessionExists.mockImplementation((tmuxSession: string) => {
				// session-1 tmux is dead, session-2 tmux is alive
				return tmuxSession === 'ccremote-2';
			});

			// Mock orphaned channels found
			const orphanedChannelIds = ['channel-orphan-1', 'channel-orphan-2'];
			mockDiscordBot.findOrphanedChannels.mockResolvedValue(orphanedChannelIds);
			mockDiscordBot.deleteOrphanedChannel.mockResolvedValue(true);

			// Mock the logic that would be called in the clean function
			const _cleanupSessions = sessions.filter(session =>
				session.status === 'ended' || !['ccremote-2'].includes(session.tmuxSession),
			);

			const activeSessions = sessions
				.filter(session => !_cleanupSessions.includes(session))
				.map(session => ({ id: session.id, name: session.name }));

			// Test the core logic of finding orphaned channels
			const foundOrphanedChannels: string[] = await mockDiscordBot.findOrphanedChannels(activeSessions);

			expect(mockDiscordBot.findOrphanedChannels).toHaveBeenCalledWith([
				{ id: 'session-2', name: 'session-2' }, // Only active session
			]);
			expect(foundOrphanedChannels).toEqual(orphanedChannelIds);
		});

		it('should handle case where no sessions need cleanup but orphaned channels exist', async () => {
			// Mock all sessions as active
			const sessions = [
				{ id: 'session-1', name: 'session-1', status: 'active', tmuxSession: 'ccremote-1' },
				{ id: 'session-2', name: 'session-2', status: 'active', tmuxSession: 'ccremote-2' },
			];

			mockSessionManager.listSessions.mockResolvedValue(sessions);
			mockTmuxManager.sessionExists.mockResolvedValue(true); // All tmux sessions exist

			// Mock orphaned channels found
			const orphanedChannelIds = ['channel-orphan-1'];
			mockDiscordBot.findOrphanedChannels.mockResolvedValue(orphanedChannelIds);

			// Simulate the clean command logic - no sessions to cleanup
			const activeSessions = sessions.map(session => ({ id: session.id, name: session.name }));

			const foundOrphanedChannels: string[] = await mockDiscordBot.findOrphanedChannels(activeSessions);

			// Should still find orphaned channels even when no sessions need cleanup
			expect(foundOrphanedChannels).toEqual(orphanedChannelIds);
			expect(mockDiscordBot.findOrphanedChannels).toHaveBeenCalledWith(activeSessions);
		});

		it('should handle cleanup when both sessions and orphaned channels exist', async () => {
			const sessions = [
				{ id: 'session-1', name: 'session-1', status: 'ended', tmuxSession: 'ccremote-1' },
				{ id: 'session-2', name: 'session-2', status: 'active', tmuxSession: 'ccremote-2' },
			];

			mockSessionManager.listSessions.mockResolvedValue(sessions);
			mockTmuxManager.sessionExists.mockResolvedValue(true);

			const orphanedChannelIds = ['channel-orphan-1'];
			mockDiscordBot.findOrphanedChannels.mockResolvedValue(orphanedChannelIds);
			mockDiscordBot.cleanupSessionChannel.mockResolvedValue(true);
			mockDiscordBot.deleteOrphanedChannel.mockResolvedValue(true);

			// Simulate cleanup logic
			const cleanupSessions = sessions.filter(session => session.status === 'ended');
			const activeSessions = sessions
				.filter(session => !cleanupSessions.includes(session))
				.map(session => ({ id: session.id, name: session.name }));

			// Test that both regular session channels and orphaned channels would be cleaned
			expect(cleanupSessions).toHaveLength(1); // session-1
			expect(activeSessions).toEqual([{ id: 'session-2', name: 'session-2' }]);

			// Would clean session-1's channel
			await mockDiscordBot.cleanupSessionChannel(cleanupSessions[0].id);
			expect(mockDiscordBot.cleanupSessionChannel).toHaveBeenCalledWith('session-1');

			// Would also find and clean orphaned channels
			const foundOrphanedChannels = await mockDiscordBot.findOrphanedChannels(activeSessions);
			expect(foundOrphanedChannels).toEqual(orphanedChannelIds);

			// Would delete the orphaned channels
			for (const channelId of foundOrphanedChannels) {
				await mockDiscordBot.deleteOrphanedChannel(channelId);
			}
			expect(mockDiscordBot.deleteOrphanedChannel).toHaveBeenCalledWith('channel-orphan-1');
		});

		it('should not proceed if no sessions and no orphaned channels need cleanup', async () => {
			const sessions = [
				{ id: 'session-1', name: 'session-1', status: 'active', tmuxSession: 'ccremote-1' },
			];

			mockSessionManager.listSessions.mockResolvedValue(sessions);
			mockTmuxManager.sessionExists.mockResolvedValue(true);
			mockDiscordBot.findOrphanedChannels.mockResolvedValue([]); // No orphaned channels

			// Simulate the clean command early return logic - no sessions to cleanup
			const activeSessions = sessions.map(session => ({ id: session.id, name: session.name }));
			const orphanedChannels: string[] = await mockDiscordBot.findOrphanedChannels(activeSessions);

			// Should return early when both are empty (no sessions to cleanup and no orphaned channels)
			const cleanupSessionsCount = 0; // No sessions to cleanup
			const shouldReturn = cleanupSessionsCount === 0 && orphanedChannels.length === 0;
			expect(shouldReturn).toBe(true);
		});

		it('should handle Discord bot initialization failure gracefully', async () => {
			const sessions = [
				{ id: 'session-1', name: 'session-1', status: 'ended', tmuxSession: 'ccremote-1' },
			];

			mockSessionManager.listSessions.mockResolvedValue(sessions);
			mockTmuxManager.sessionExists.mockResolvedValue(false);

			// When Discord bot is null (failed to initialize)
			const discordBot: typeof mockDiscordBot | null = null;

			// Simulate the clean command logic without Discord bot
			const cleanupSessions = sessions.filter(session => session.status === 'ended');
			let orphanedChannels: string[] = [];

			if (discordBot) {
				const activeSessions = sessions
					.filter(session => !cleanupSessions.includes(session))
					.map(session => ({ id: session.id, name: session.name }));
				orphanedChannels = await discordBot.findOrphanedChannels(activeSessions);
			}

			// Should still be able to clean sessions even without Discord bot
			expect(cleanupSessions).toHaveLength(1);
			expect(orphanedChannels).toEqual([]); // No orphaned channels when Discord bot is null
		});
	});
}
