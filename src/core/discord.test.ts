/**
 * Unit tests for Discord bot resilience functionality
 */

import type { Client } from 'discord.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordBot } from './discord.ts';

// Mock discord.js
vi.mock('discord.js', () => ({
	Client: vi.fn().mockImplementation(() => ({
		once: vi.fn(),
		on: vi.fn(),
		login: vi.fn(),
		destroy: vi.fn(),
		user: null,
		guilds: {
			cache: { first: vi.fn() },
			fetch: vi.fn()
		},
		users: { fetch: vi.fn() },
		channels: { fetch: vi.fn() },
	})),
	Events: {
		ClientReady: 'ready',
		MessageCreate: 'messageCreate',
		Error: 'error',
	},
	GatewayIntentBits: {
		Guilds: 1,
		GuildMessages: 2,
		MessageContent: 4,
		DirectMessages: 8,
	},
	ChannelType: {
		GuildText: 0,
	},
	PermissionFlagsBits: {
		ViewChannel: 1,
		SendMessages: 2,
		ReadMessageHistory: 4,
	},
}));

// Mock the error handling utility
vi.mock('../utils/discord-error-handling.ts', () => ({
	withDiscordRetry: vi.fn(),
	safeDiscordOperation: vi.fn(),
}));

describe('DiscordBot Resilience', () => {
	let discordBot: DiscordBot;
	let mockClient: any;

	beforeEach(() => {
		vi.clearAllMocks();
		discordBot = new DiscordBot();
		mockClient = (discordBot as any).client;
	});

	afterEach(async () => {
		await discordBot.stop();
	});

	describe('start method', () => {
		it('should handle login failures with retry logic', async () => {
			const { withDiscordRetry } = await import('../utils/discord-error-handling.ts');
			const mockWithDiscordRetry = withDiscordRetry as any;

			// Mock a successful retry result
			mockWithDiscordRetry.mockResolvedValueOnce({
				success: true,
				result: undefined,
				attempts: 2,
			});

			await discordBot.start('valid-token', 'owner123', ['user1']);

			expect(mockWithDiscordRetry).toHaveBeenCalledWith(
				expect.any(Function),
				expect.objectContaining({
					maxRetries: 3,
					baseDelayMs: 2000,
					maxDelayMs: 30000,
				}),
			);
		});

		it('should throw error when all retry attempts fail', async () => {
			const { withDiscordRetry } = await import('../utils/discord-error-handling.ts');
			const mockWithDiscordRetry = withDiscordRetry as any;

			// Mock a failed retry result
			const testError = new Error('Persistent connection failure');
			mockWithDiscordRetry.mockResolvedValueOnce({
				success: false,
				error: testError,
				attempts: 4,
			});

			await expect(discordBot.start('invalid-token', 'owner123')).rejects.toThrow('Persistent connection failure');
		});

		it('should log success message when connection succeeds after retries', async () => {
			const { withDiscordRetry } = await import('../utils/discord-error-handling.ts');
			const mockWithDiscordRetry = withDiscordRetry as any;
			const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

			// Mock multiple attempts before success
			mockWithDiscordRetry.mockResolvedValueOnce({
				success: true,
				result: undefined,
				attempts: 3,
			});

			await discordBot.start('valid-token', 'owner123');

			expect(consoleSpy).toHaveBeenCalledWith('[DISCORD] Successfully connected after 3 attempts');
			consoleSpy.mockRestore();
		});
	});

	describe('sendNotification method', () => {
		beforeEach(() => {
			// Set up a ready bot with a channel mapping
			(discordBot as any).isReady = true;
			(discordBot as any).sessionChannelMap.set('session1', 'channel123');
		});

		it('should use safeDiscordOperation for notification sending', async () => {
			const { safeDiscordOperation } = await import('../utils/discord-error-handling.ts');
			const mockSafeDiscordOperation = safeDiscordOperation as any;

			const mockChannel = {
				send: vi.fn().mockResolvedValue({}),
			};
			mockClient.channels.fetch.mockResolvedValue(mockChannel);
			mockSafeDiscordOperation.mockImplementation((fn: any) => fn());

			await discordBot.sendNotification('session1', {
				type: 'limit',
				sessionId: 'session1',
				sessionName: 'test-session',
				message: 'Test notification',
			});

			expect(mockSafeDiscordOperation).toHaveBeenCalledWith(
				expect.any(Function),
				'send Discord notification',
				expect.objectContaining({ warn: console.warn }),
				expect.objectContaining({ maxRetries: 2, baseDelayMs: 1000 }),
			);
			expect(mockChannel.send).toHaveBeenCalled();
		});

		it('should skip notification when bot is not ready', async () => {
			const { safeDiscordOperation } = await import('../utils/discord-error-handling.ts');
			const mockSafeDiscordOperation = safeDiscordOperation as any;
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			(discordBot as any).isReady = false;

			await discordBot.sendNotification('session1', {
				type: 'limit',
				sessionId: 'session1',
				sessionName: 'test-session',
				message: 'Test notification',
			});

			expect(mockSafeDiscordOperation).not.toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith('Discord bot not ready, skipping notification');
			consoleSpy.mockRestore();
		});

		it('should skip notification when no channel is mapped', async () => {
			const { safeDiscordOperation } = await import('../utils/discord-error-handling.ts');
			const mockSafeDiscordOperation = safeDiscordOperation as any;
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			await discordBot.sendNotification('nonexistent-session', {
				type: 'limit',
				sessionId: 'nonexistent-session',
				sessionName: 'test-session',
				message: 'Test notification',
			});

			expect(mockSafeDiscordOperation).not.toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith('No Discord channel found for session nonexistent-session');
			consoleSpy.mockRestore();
		});
	});

	describe('createOrGetChannel method', () => {
		beforeEach(() => {
			(discordBot as any).isReady = true;
			(discordBot as any).guildId = 'guild123';
		});

		it('should use safeDiscordOperation for channel creation', async () => {
			const { safeDiscordOperation } = await import('../utils/discord-error-handling.ts');
			const mockSafeDiscordOperation = safeDiscordOperation as any;

			const mockGuild = {
				channels: {
					create: vi.fn().mockResolvedValue({ id: 'new-channel-123' }),
					cache: { find: vi.fn().mockReturnValue(null) },
				},
				members: { me: { id: 'bot123' } },
				roles: { everyone: { id: 'everyone123' } },
			};
			mockClient.guilds.fetch.mockResolvedValue(mockGuild);
			mockSafeDiscordOperation.mockResolvedValue('new-channel-123');

			const result = await discordBot.createOrGetChannel('session1', 'test-session');

			expect(mockSafeDiscordOperation).toHaveBeenCalledWith(
				expect.any(Function),
				'create Discord channel',
				expect.objectContaining({ warn: console.warn }),
				expect.objectContaining({ maxRetries: 2, baseDelayMs: 1500 }),
			);
			expect(result).toBe('new-channel-123');
		});

		it('should fall back to DM when guild channel creation fails', async () => {
			const { safeDiscordOperation } = await import('../utils/discord-error-handling.ts');
			const mockSafeDiscordOperation = safeDiscordOperation as any;
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			// Mock channel creation failure, then DM creation success
			mockSafeDiscordOperation
				.mockResolvedValueOnce(undefined) // Guild channel creation fails
				.mockResolvedValueOnce('dm-channel-123'); // DM creation succeeds

			const mockUser = { createDM: vi.fn().mockResolvedValue({ id: 'dm-channel-123', send: vi.fn() }) };
			mockClient.users.fetch.mockResolvedValue(mockUser);

			const result = await discordBot.createOrGetChannel('session1', 'test-session');

			expect(consoleSpy).toHaveBeenCalledWith('[DISCORD] Failed to create channel in guild, falling back to DM');
			expect(result).toBe('dm-channel-123');
			consoleSpy.mockRestore();
		});
	});

	describe('integration with daemon error handling', () => {
		it('should not disrupt daemon when Discord operations fail', async () => {
			const { safeDiscordOperation } = await import('../utils/discord-error-handling.ts');
			const mockSafeDiscordOperation = safeDiscordOperation as any;

			// Mock all Discord operations to fail
			mockSafeDiscordOperation.mockResolvedValue(undefined);

			(discordBot as any).isReady = true;
			(discordBot as any).sessionChannelMap.set('session1', 'channel123');

			// This should not throw, even though Discord operations fail
			await expect(discordBot.sendNotification('session1', {
				type: 'limit',
				sessionId: 'session1',
				sessionName: 'test-session',
				message: 'Test notification',
			})).resolves.toBeUndefined();
		});
	});
});