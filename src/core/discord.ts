import type { Message, TextChannel } from 'discord.js';
import type { NotificationMessage } from '../types/index.ts';
import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';

export class DiscordBot {
	private client: Client;
	private authorizedUsers: string[] = [];
	private ownerId: string = '';
	private sessionChannelMap = new Map<string, string>(); // sessionId -> channelId
	private channelSessionMap = new Map<string, string>(); // channelId -> sessionId
	private guildId: string | null = null; // Store the guild where channels should be created
	private isReady = false;

	constructor() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
			],
		});

		this.setupEventHandlers();
	}

	async start(token: string, ownerId: string, authorizedUsers: string[] = []): Promise<void> {
		console.info('[DISCORD] start() method called');
		console.info(`[DISCORD] Starting Discord bot with owner: ${ownerId}, authorized users: ${authorizedUsers.join(', ')}`);
		this.ownerId = ownerId;
		this.authorizedUsers = [ownerId, ...authorizedUsers];

		// Set up the ready event listener BEFORE logging in
		return new Promise((resolve, reject) => {
			// Add timeout to prevent hanging forever
			const timeout = setTimeout(() => {
				console.error('[DISCORD] Discord bot login timed out after 30 seconds');
				reject(new Error('Discord bot login timeout'));
			}, 30000);

			this.client.once(Events.ClientReady, () => {
				console.info('[DISCORD] ClientReady event fired!');
				clearTimeout(timeout);
				this.isReady = true;

				// Find the first guild the bot is in to create channels
				const guild = this.client.guilds.cache.first();
				if (guild) {
					this.guildId = guild.id;
					console.info(`[DISCORD] Discord bot logged in as ${this.client.user?.tag} in guild: ${guild.name}`);
				}
				else {
					console.warn('[DISCORD] Discord bot not in any guilds - cannot create channels');
				}

				console.info('[DISCORD] Bot startup complete, resolving promise');
				resolve();
			});

			// Add error handler
			this.client.once(Events.Error, (error) => {
				console.error('[DISCORD] Discord client error during startup:', error);
				clearTimeout(timeout);
				reject(error);
			});

			// Now login - the event will fire after this
			console.info('[DISCORD] Calling client.login()...');
			this.client.login(token)
				.then(() => {
					console.info('[DISCORD] client.login() resolved successfully');
				})
				.catch((error) => {
					console.error('[DISCORD] Login failed:', error);
					clearTimeout(timeout);
					reject(error);
				});
		});
	}

	private setupEventHandlers(): void {
		this.client.on(Events.MessageCreate, (message) => {
			if (message.author.bot) {
				return;
			}
			void this.handleMessage(message);
		});

		this.client.on(Events.Error, (error) => {
			console.error('Discord client error:', error);
		});
	}

	private async handleMessage(message: Message): Promise<void> {
		if (!this.isAuthorized(message.author.id)) {
			return; // Ignore unauthorized users
		}

		const content = message.content.toLowerCase().trim();
		const sessionId = this.channelSessionMap.get(message.channel.id);

		if (!sessionId) {
			// No session associated with this channel
			return;
		}

		try {
			// Handle numeric option selection (1, 2, 3, etc.)
			const numericMatch = content.match(/^(\d+)$/);
			if (numericMatch) {
				const optionNumber = Number.parseInt(numericMatch[1], 10);
				await this.handleOptionSelection(sessionId, optionNumber);
				await message.reply(`✅ Selected option ${optionNumber}`);
			}
			// Legacy support for approve/deny (maps to 1/2)
			else if (content === 'approve') {
				await this.handleOptionSelection(sessionId, 1);
				await message.reply('✅ Approved (option 1)');
			}
			else if (content === 'deny') {
				await this.handleOptionSelection(sessionId, 2);
				await message.reply('❌ Denied (option 2)');
			}
			else if (content === 'status') {
				await this.handleStatus(sessionId, message);
			}
		}
		catch (error) {
			console.error('Error handling Discord message:', error);
			await message.reply('❌ Error processing command');
		}
	}

	private isAuthorized(userId: string): boolean {
		return this.authorizedUsers.includes(userId);
	}

	async sendNotification(sessionId: string, notification: NotificationMessage): Promise<void> {
		if (!this.isReady) {
			console.warn('Discord bot not ready, skipping notification');
			return;
		}

		const channelId = this.sessionChannelMap.get(sessionId);
		if (!channelId) {
			console.warn(`No Discord channel found for session ${sessionId}`);
			return;
		}

		try {
			await this.withExponentialBackoff(async () => {
				const channel = await this.client.channels.fetch(channelId) as TextChannel;
				if (!channel) {
					throw new Error(`Discord channel ${channelId} not found`);
				}

				const message = this.formatNotification(notification);
				await channel.send(message);

				// If this is a session_ended notification, clean up the channel
				if (notification.type === 'session_ended') {
					// Clean up after a short delay to ensure the message is sent
					setTimeout(() => {
						void this.cleanupSessionChannel(sessionId);
					}, 2000);
				}
			}, 'send Discord notification');
		}
		catch (error) {
			console.error('Error sending Discord notification:', error);
		}
	}

	private formatNotification(notification: NotificationMessage): string {
		const { type, sessionName, message, metadata } = notification;

		switch (type) {
			case 'limit': {
				const resetTime = metadata?.resetTime || 'unknown';
				return `🚫 **${sessionName}** - Usage limit reached\n📅 Resets: ${resetTime}\n\n${message}`;
			}

			case 'continued':
				return `✅ **${sessionName}** - Session resumed\n\n${message}`;

			case 'approval': {
				const toolName = metadata?.toolName || 'unknown';
				const command = metadata?.command || '';
				return `⚠️ **${sessionName}** - Approval Required\n🔧 Tool: ${toolName}\n\n${message}\n\n${command ? `\`\`\`${command}\`\`\`` : ''}`;
			}

			case 'error':
				return `❌ **${sessionName}** - Error\n\n${message}`;

			case 'session_ended':
				return `🏁 **${sessionName}** - Session Ended\n\n${message}`;

			default:
				return `📝 **${sessionName}**\n\n${message}`;
		}
	}

	async createOrGetChannel(sessionId: string, sessionName: string): Promise<string> {
		console.info(`[DISCORD] createOrGetChannel called for session: ${sessionId}, name: ${sessionName}`);

		// Check if we already have a channel for this session
		const existingChannelId = this.sessionChannelMap.get(sessionId);
		if (existingChannelId) {
			console.info(`[DISCORD] Found existing channel mapping: ${existingChannelId}`);
			try {
				const channel = await this.client.channels.fetch(existingChannelId);
				if (channel) {
					console.info(`[DISCORD] Existing channel confirmed, returning: ${existingChannelId}`);
					return existingChannelId;
				}
			}
			catch {
				console.warn(`[DISCORD] Existing channel ${existingChannelId} no longer exists, will create new one`);
			}
		}

		if (!this.guildId) {
			console.warn('[DISCORD] No guild available, falling back to DM');
			return this.createDMChannel(sessionId, sessionName);
		}

		console.info(`[DISCORD] Creating new channel in guild: ${this.guildId}`);
		try {
			return await this.withExponentialBackoff(async () => {
				console.info(`[DISCORD] Fetching guild: ${this.guildId}`);
				const guild = await this.client.guilds.fetch(this.guildId!);
				if (!guild) {
					throw new Error(`Guild ${this.guildId} not found`);
				}
				console.info(`[DISCORD] Guild fetched successfully: ${guild.name}`);

				// Create a private text channel named after the session
				const channelName = `ccremote-${sessionName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
				console.info(`[DISCORD] Will create channel with name: ${channelName}`);

				// Create channel first, then add permissions later to avoid caching issues
				console.info(`[DISCORD] Creating basic channel first, then adding permissions...`);

				// Create channel with bot permissions from the start
				console.info(`[DISCORD] Creating channel with bot access ensured...`);
				const botMember = guild.members.me;
				const initialPermissions = [];

				// Hide from @everyone but ensure bot has access
				initialPermissions.push({
					id: guild.roles.everyone.id,
					deny: [PermissionFlagsBits.ViewChannel],
				});

				// Ensure bot always has access
				if (botMember) {
					initialPermissions.push({
						id: botMember.id,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
					});
				}

				const channel = await guild.channels.create({
					name: channelName,
					type: ChannelType.GuildText,
					permissionOverwrites: initialPermissions,
				});

				// Try to add user permissions, but continue even if it fails
				console.info(`[DISCORD] Channel created, attempting to add user permissions...`);
				let permissionsSet = false;

				for (const userId of this.authorizedUsers) {
					try {
						console.info(`[DISCORD] Fetching and adding permissions for user: ${userId}`);
						// Fetch the user first to ensure it's in Discord.js cache
						const user = await this.client.users.fetch(userId);
						await channel.permissionOverwrites.create(user, {
							ViewChannel: true,
							SendMessages: true,
							ReadMessageHistory: true,
						});
						console.info(`[DISCORD] Successfully added permissions for user: ${userId}`);
						permissionsSet = true;
					}
					catch (permError) {
						console.warn(`Failed to add permissions for user ${userId}:`, permError);
						console.warn('This is usually due to Discord permission hierarchy - continuing without user-specific permissions');
					}
				}

				if (!permissionsSet) {
					console.warn(`[DISCORD] Could not set user-specific permissions - channel will rely on server permissions`);
				}

				console.info(`[DISCORD] Channel created with initial permissions (hidden from @everyone, bot has access)`);

				this.sessionChannelMap.set(sessionId, channel.id);
				this.channelSessionMap.set(channel.id, sessionId);

				// Send initial message with retry
				await this.withExponentialBackoff(async () => {
					await channel.send(`🚀 **ccremote Session Started**\nSession: ${sessionName} (${sessionId})\n\nI'll send notifications for this session here. This channel is private and only visible to authorized users.`);
				});

				return channel.id;
			}, 'create Discord channel');
		}
		catch (error) {
			console.warn(`[DISCORD] Failed to create channel in guild, falling back to DM:`, error);
			return this.createDMChannel(sessionId, sessionName);
		}
	}

	private async createDMChannel(sessionId: string, sessionName: string): Promise<string> {
		return this.withExponentialBackoff(async () => {
			const owner = await this.client.users.fetch(this.ownerId);
			const dmChannel = await owner.createDM();

			this.sessionChannelMap.set(sessionId, dmChannel.id);
			this.channelSessionMap.set(dmChannel.id, sessionId);

			// Send initial message with retry
			await this.withExponentialBackoff(async () => {
				await dmChannel.send(`🚀 **ccremote Session Started**\nSession: ${sessionName} (${sessionId})\n\nI'll send notifications for this session here. (Using DM as fallback - no guild available)`);
			});

			return dmChannel.id;
		}, 'create Discord DM channel');
	}

	async assignChannelToSession(sessionId: string, channelId: string): Promise<void> {
		this.sessionChannelMap.set(sessionId, channelId);
		this.channelSessionMap.set(channelId, sessionId);
	}

	async cleanupSessionChannel(sessionId: string): Promise<void> {
		const channelId = this.sessionChannelMap.get(sessionId);
		if (!channelId) {
			return;
		}

		try {
			const channel = await this.client.channels.fetch(channelId) as TextChannel;
			if (channel && channel.type === ChannelType.GuildText) {
				// Send a final message before cleanup
				await channel.send(`🏁 Session ${sessionId} ended. This channel will be archived.`);

				// Archive the channel by renaming it and removing permissions for normal users
				const archivedName = `archived-${channel.name}`;
				await channel.setName(archivedName);

				// Remove send permissions for authorized users, but keep view permissions for history
				for (const userId of this.authorizedUsers) {
					try {
						// Fetch user first to ensure proper permission management
						const user = await this.client.users.fetch(userId);
						await channel.permissionOverwrites.edit(user, {
							ViewChannel: true,
							ReadMessageHistory: true,
							SendMessages: false,
						});
					}
					catch (error) {
						console.warn(`Failed to update permissions for user ${userId} during cleanup:`, error);
					}
				}
			}
		}
		catch (error) {
			console.error(`Error cleaning up channel for session ${sessionId}:`, error);
		}
		finally {
			// Always clean up the mappings
			this.sessionChannelMap.delete(sessionId);
			this.channelSessionMap.delete(channelId);
		}
	}

	private async handleOptionSelection(sessionId: string, optionNumber: number): Promise<void> {
		// Emit event with the selected option number
		this.client.emit('ccremote:option_selected', { sessionId, optionNumber });
	}

	private async handleStatus(sessionId: string, message: Message): Promise<void> {
		// This will be implemented to show session status
		await message.reply(`📊 Session status for ${sessionId} - implementation pending`);
	}

	onOptionSelected(handler: (sessionId: string, optionNumber: number) => void): void {
		this.client.on('ccremote:option_selected', ({ sessionId, optionNumber }: any) => {
			handler(sessionId as string, optionNumber as number);
		});
	}

	/**
	 * Execute an operation with exponential backoff retry for rate limits
	 */
	private async withExponentialBackoff<T>(
		operation: () => Promise<T>,
		operationName?: string,
		maxRetries = 5,
		baseDelay = 1000,
	): Promise<T> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				return await operation();
			}
			catch (error) {
				lastError = error as Error;
				const errorMessage = error instanceof Error ? error.message : String(error);

				// Check if this is a rate limit error or user caching error
				const isRateLimit = errorMessage.includes('too fast')
					|| errorMessage.includes('rate limit')
					|| errorMessage.includes('429');

				const isUserCacheError = errorMessage.includes('not a cached User or Role')
					|| errorMessage.includes('cached User')
					|| errorMessage.includes('cached Role');

				if ((!isRateLimit && !isUserCacheError) || attempt === maxRetries - 1) {
					throw error;
				}

				// Calculate delay with exponential backoff + jitter
				const delay = baseDelay * 2 ** attempt + Math.random() * 1000;

				const errorType = isRateLimit ? 'rate limited' : (isUserCacheError ? 'user cache error' : 'unknown error');
				console.warn(`${operationName || 'Discord operation'} ${errorType} (attempt ${attempt + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms: ${errorMessage}`);

				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		throw new Error(lastError?.message || 'Maximum retry attempts exceeded');
	}

	async stop(): Promise<void> {
		if (this.client) {
			await this.client.destroy();
			this.isReady = false;
		}
	}
}
