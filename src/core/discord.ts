import type { Message, TextChannel } from 'discord.js';
import type { NotificationMessage } from '../types/index.ts';
import type { SessionManager } from './session.ts';
import type { TmuxManager } from './tmux.ts';
import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { safeDiscordOperation, withDiscordRetry } from '../utils/discord-error-handling.ts';

export class DiscordBot {
	private client: Client;
	private authorizedUsers: string[] = [];
	private ownerId: string = '';
	private sessionChannelMap = new Map<string, string>(); // sessionId -> channelId
	private channelSessionMap = new Map<string, string>(); // channelId -> sessionId
	private guildId: string | null = null; // Store the guild where channels should be created
	private isReady = false;
	private token: string = '';
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private lastHealthCheckTime = new Date();
	private sessionManager?: SessionManager;
	private tmuxManager?: TmuxManager;

	constructor(sessionManager?: SessionManager, tmuxManager?: TmuxManager) {
		this.sessionManager = sessionManager;
		this.tmuxManager = tmuxManager;
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
			],
			// eslint-disable-next-line ts/no-unsafe-assignment
			ws: {
				// Increase WebSocket timeout values to handle unreliable network conditions
				handshakeTimeout: 60000, // 60 seconds (default: 30000)
				helloTimeout: 120000, // 2 minutes (default: 60000)
				readyTimeout: 30000, // 30 seconds (default: 15000)
			} as any,
		});

		this.setupEventHandlers();
	}

	async start(token: string, ownerId: string, authorizedUsers: string[] = [], healthCheckInterval?: number): Promise<void> {
		console.info('[DISCORD] start() method called');
		console.info(`[DISCORD] Starting Discord bot with owner: ${ownerId}, authorized users: ${authorizedUsers.join(', ')}`);
		this.token = token; // Store token for reconnection attempts
		this.ownerId = ownerId;
		this.authorizedUsers = [ownerId, ...authorizedUsers];

		const result = await withDiscordRetry(
			async () => this.performLogin(token),
			{
				maxRetries: 3,
				baseDelayMs: 2000,
				maxDelayMs: 30000,
				onRetry: (error, attempt) => {
					console.warn(`[DISCORD] Login attempt ${attempt} failed: ${error.message}. Retrying...`);
				},
			},
		);

		if (!result.success) {
			throw result.error || new Error('Discord login failed after retries');
		}

		if (result.attempts > 1) {
			console.info(`[DISCORD] Successfully connected after ${result.attempts} attempts`);
		}

		// Start periodic health check
		this.startHealthCheck(healthCheckInterval);
	}

	private async performLogin(token: string): Promise<void> {
		return new Promise((resolve, reject) => {
			// Add timeout to prevent hanging forever
			const timeout = setTimeout(() => {
				const error = new Error('Opening handshake has timed out');
				console.error('[DISCORD] Discord bot login timed out after 30 seconds');
				reject(error);
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
			else if (content === 'output' || content === '/output') {
				await this.handleOutput(sessionId, message);
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

		await safeDiscordOperation(
			async () => {
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
			},
			'send Discord notification',
			{ warn: console.warn, debug: console.info },
			{
				maxRetries: 2,
				baseDelayMs: 1000,
			},
		);
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

			case 'task_completed': {
				const idleDuration = metadata?.idleDurationSeconds || 0;
				return `✅ **${sessionName}** - Task completed\n⏱️ Idle for: ${idleDuration}s\n\n${message}`;
			}

			default:
				return `📝 **${sessionName}**\n\n${message}`;
		}
	}

	async createOrGetChannel(sessionId: string, sessionName: string): Promise<string> {
		console.info(`[DISCORD] createOrGetChannel called for session: ${sessionId}, name: ${sessionName}`);

		// Check if we already have a channel for this session ID
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

		// Check if a channel with this session name already exists in the guild
		const channelName = `ccremote-${sessionName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
		console.info(`[DISCORD] Checking for existing channel with name: ${channelName}`);

		try {
			const guild = await this.client.guilds.fetch(this.guildId);
			if (guild) {
				// Look for existing channel by name
				const existingChannel = guild.channels.cache.find(
					channel => channel.name === channelName && channel.isTextBased(),
				);

				if (existingChannel) {
					console.info(`[DISCORD] Found existing channel by name: ${existingChannel.id} (${channelName})`);
					// Update our session mapping to use this existing channel
					this.sessionChannelMap.set(sessionId, existingChannel.id);
					this.channelSessionMap.set(existingChannel.id, sessionId);

					// Send notification that session is reusing existing channel
					if (existingChannel.isTextBased()) {
						await existingChannel.send(`🔄 **ccremote Session Resumed**\nSession: ${sessionName} (${sessionId})\n\nReusing existing channel for this session.`);
					}

					return existingChannel.id;
				}
			}
		}
		catch (error) {
			console.warn(`[DISCORD] Error checking for existing channel: ${error}`);
		}

		console.info(`[DISCORD] Creating new channel in guild: ${this.guildId}`);

		const channelId = await safeDiscordOperation(
			async () => {
				console.info(`[DISCORD] Fetching guild: ${this.guildId}`);
				const guild = await this.client.guilds.fetch(this.guildId!);
				if (!guild) {
					throw new Error(`Guild ${this.guildId} not found`);
				}
				console.info(`[DISCORD] Guild fetched successfully: ${guild.name}`);

				// Create a private text channel named after the session
				const channelName = `ccremote-${sessionName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
				console.info(`[DISCORD] Will create channel with name: ${channelName}`);

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

				// Send initial message
				await channel.send(`🚀 **ccremote Session Started**\nSession: ${sessionName} (${sessionId})\n\nI'll send notifications for this session here. This channel is private and only visible to authorized users.`);

				return channel.id;
			},
			'create Discord channel',
			{ warn: console.warn, debug: console.info },
			{
				maxRetries: 2,
				baseDelayMs: 1500,
			},
		);

		if (channelId) {
			return channelId;
		}

		console.warn(`[DISCORD] Failed to create channel in guild, falling back to DM`);
		return this.createDMChannel(sessionId, sessionName);
	}

	private async createDMChannel(sessionId: string, sessionName: string): Promise<string> {
		const channelId = await safeDiscordOperation(
			async () => {
				const owner = await this.client.users.fetch(this.ownerId);
				const dmChannel = await owner.createDM();

				this.sessionChannelMap.set(sessionId, dmChannel.id);
				this.channelSessionMap.set(dmChannel.id, sessionId);

				// Send initial message
				await dmChannel.send(`🚀 **ccremote Session Started**\nSession: ${sessionName} (${sessionId})\n\nI'll send notifications for this session here. (Using DM as fallback - no guild available)`);

				return dmChannel.id;
			},
			'create Discord DM channel',
			{ warn: console.warn, debug: console.info },
			{
				maxRetries: 2,
				baseDelayMs: 1000,
			},
		);

		if (!channelId) {
			throw new Error('Failed to create DM channel after retries');
		}

		return channelId;
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

	private async handleOutput(sessionId: string, message: Message): Promise<void> {
		if (!this.sessionManager || !this.tmuxManager) {
			await message.reply('❌ Output display not available - missing dependencies');
			return;
		}

		try {
			// Get session information
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				await message.reply(`❌ Session ${sessionId} not found`);
				return;
			}

			// Capture current tmux output
			const output = await this.tmuxManager.capturePane(session.tmuxSession);
			if (!output || output.trim().length === 0) {
				await message.reply('📺 Session output is empty');
				return;
			}

			// Format output for Discord (split into chunks if needed)
			const formattedOutput = this.formatOutputForDiscord(output);

			// Send output as code blocks
			for (const chunk of formattedOutput) {
				await message.reply(chunk);
			}
		}
		catch (error) {
			console.error('Error fetching session output:', error);
			await message.reply('❌ Failed to fetch session output');
		}
	}

	/**
	 * Format tmux output for Discord display with proper code blocks and chunking
	 */
	private formatOutputForDiscord(output: string): string[] {
		const MAX_DISCORD_MESSAGE_LENGTH = 2000;
		const CODE_BLOCK_OVERHEAD = '```\n\n```'.length;
		const MAX_CONTENT_LENGTH = MAX_DISCORD_MESSAGE_LENGTH - CODE_BLOCK_OVERHEAD;

		// Clean the output - remove excessive whitespace and control characters
		const cleanedOutput = output
			.replace(/\r\n/g, '\n') // Normalize line endings
			.replace(/\r/g, '\n') // Handle remaining carriage returns
			.replace(/\t/g, '    ') // Convert tabs to spaces for better Discord display
			.split('\n')
			.slice(-50) // Get last 50 lines for reasonable context
			.join('\n')
			.trim();

		if (cleanedOutput.length === 0) {
			return ['```\n(empty output)\n```'];
		}

		// If output fits in one message, return it
		if (cleanedOutput.length <= MAX_CONTENT_LENGTH) {
			return [`\`\`\`\n${cleanedOutput}\n\`\`\``];
		}

		// Split into multiple chunks
		const chunks: string[] = [];
		const lines = cleanedOutput.split('\n');
		let currentChunk = '';

		for (const line of lines) {
			const lineWithNewline = `${line}\n`;

			// Check if adding this line would exceed the limit
			if (currentChunk.length + lineWithNewline.length > MAX_CONTENT_LENGTH) {
				// Save current chunk and start a new one
				if (currentChunk.trim().length > 0) {
					chunks.push(`\`\`\`\n${currentChunk.trim()}\n\`\`\``);
				}
				currentChunk = lineWithNewline;
			}
			else {
				currentChunk += lineWithNewline;
			}
		}

		// Don't forget the last chunk
		if (currentChunk.trim().length > 0) {
			chunks.push(`\`\`\`\n${currentChunk.trim()}\n\`\`\``);
		}

		// Add headers to chunks if there are multiple
		if (chunks.length > 1) {
			return chunks.map((chunk, index) =>
				`📺 **Session Output (${index + 1}/${chunks.length})**\n${chunk}`,
			);
		}

		return chunks.length > 0 ? [`📺 **Session Output**\n${chunks[0]}`] : ['```\n(no output to display)\n```'];
	}

	onOptionSelected(handler: (sessionId: string, optionNumber: number) => void): void {
		this.client.on('ccremote:option_selected', ({ sessionId, optionNumber }: any) => {
			handler(sessionId as string, optionNumber as number);
		});
	}

	/**
	 * Find orphaned ccremote channels that exist but aren't connected to any active session
	 */
	async findOrphanedChannels(activeSessions: { id: string; name: string }[]): Promise<string[]> {
		try {
			if (!this.client.guilds.cache.size) {
				return [];
			}

			const orphanedChannels: string[] = [];
			const guild = this.client.guilds.cache.first();

			if (!guild) {
				return [];
			}

			// Get all channels that start with "ccremote-" but aren't "archived-"
			const ccremoteChannels = guild.channels.cache.filter(channel =>
				channel.name.startsWith('ccremote-')
				&& !channel.name.startsWith('archived-')
				&& channel.type === ChannelType.GuildText,
			);

			for (const [channelId, channel] of ccremoteChannels) {
				// Check if this channel is mapped to any active session in our bot's memory
				const mappedSessionId = this.channelSessionMap.get(channelId);

				// Extract session name from channel name (e.g., "ccremote-ccremote-7" -> "ccremote-7")
				const channelName = channel.name;
				const sessionNameFromChannel = channelName.replace(/^ccremote-/, '');

				// Check if this channel corresponds to any active session
				const activeSessionIds = activeSessions.map(s => s.id);
				const activeSessionNames = activeSessions.map(s => s.name);

				// Channel is orphaned if:
				// 1. Not mapped in bot memory AND doesn't match any active session name, OR
				// 2. Mapped to a session that's not in active sessions
				const isOrphaned = (!mappedSessionId && !activeSessionNames.includes(sessionNameFromChannel))
					|| (mappedSessionId && !activeSessionIds.includes(mappedSessionId));

				if (isOrphaned) {
					orphanedChannels.push(channelId);
					console.info(`[DISCORD] Found orphaned channel: ${channel.name} (${channelId}) - mapped to: ${mappedSessionId || 'none'}, session name from channel: ${sessionNameFromChannel}, active session names: [${activeSessionNames.join(', ')}]`);
				}
			}

			return orphanedChannels;
		}
		catch (error) {
			console.warn('[DISCORD] Error finding orphaned channels:', error);
			return [];
		}
	}

	/**
	 * Archive an orphaned channel by ID
	 */
	async archiveOrphanedChannel(channelId: string): Promise<boolean> {
		try {
			const channel = await this.client.channels.fetch(channelId) as TextChannel;
			if (!channel || channel.type !== ChannelType.GuildText) {
				return false;
			}

			// Send a final message before archiving
			await channel.send(`🏁 Orphaned channel detected during cleanup. This channel will be archived as it's no longer connected to an active session.`);

			// Archive the channel by renaming it and removing permissions
			const archivedName = `archived-${channel.name}`;
			await channel.setName(archivedName);

			// Remove send permissions for authorized users, but keep view permissions for history
			for (const userId of this.authorizedUsers) {
				try {
					const user = await this.client.users.fetch(userId);
					await channel.permissionOverwrites.edit(user, {
						ViewChannel: true,
						ReadMessageHistory: true,
						SendMessages: false,
					});
				}
				catch (error) {
					console.warn(`Failed to update permissions for user ${userId} during orphaned cleanup:`, error);
				}
			}

			// Clean up our internal mappings
			this.channelSessionMap.delete(channelId);
			// Find and remove any sessionId mappings that point to this channel
			for (const [sessionId, mappedChannelId] of this.sessionChannelMap.entries()) {
				if (mappedChannelId === channelId) {
					this.sessionChannelMap.delete(sessionId);
					break;
				}
			}

			console.info(`[DISCORD] Archived orphaned channel: ${archivedName}`);
			return true;
		}
		catch (error) {
			console.warn(`[DISCORD] Failed to archive orphaned channel ${channelId}:`, error);
			return false;
		}
	}

	async shutdown(): Promise<void> {
		try {
			// Stop health check interval
			if (this.healthCheckInterval) {
				clearInterval(this.healthCheckInterval);
				this.healthCheckInterval = null;
			}

			// Destroy Discord client connection
			if (this.client && typeof this.client.destroy === 'function') {
				await this.client.destroy();
			}

			this.isReady = false;
		}
		catch (error) {
			console.warn('[DISCORD] Error during shutdown:', error);
		}
	}

	/**
	 * Start periodic health check (every hour by default)
	 */
	private startHealthCheck(intervalMs: number = 60 * 60 * 1000): void {
		console.info(`[DISCORD] Starting health check with ${intervalMs / 60000} minute interval`);

		// Clear any existing interval
		this.stopHealthCheck();

		this.healthCheckInterval = setInterval(() => {
			void this.performHealthCheck();
		}, intervalMs);

		// Also update the last health check time
		this.lastHealthCheckTime = new Date();
	}

	/**
	 * Stop the periodic health check
	 */
	private stopHealthCheck(): void {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
	}

	/**
	 * Perform a health check and attempt reconnection if needed
	 */
	private async performHealthCheck(): Promise<void> {
		try {
			this.lastHealthCheckTime = new Date();

			if (!this.isHealthy()) {
				console.warn('[DISCORD] Health check failed - bot appears disconnected');
				await this.attemptReconnection();
			}
			else {
				console.info('[DISCORD] Health check passed - bot is connected');
			}
		}
		catch (error) {
			console.error(`[DISCORD] Health check error: ${error instanceof Error ? error.message : String(error)}`);
			await this.attemptReconnection();
		}
	}

	/**
	 * Check if Discord bot is healthy (connected and ready)
	 */
	public isHealthy(): boolean {
		return this.isReady
			&& this.client
			&& this.client.readyTimestamp !== null
			&& this.client.ws.status === 0; // 0 = READY
	}

	/**
	 * Attempt to reconnect Discord bot
	 */
	private async attemptReconnection(): Promise<void> {
		console.info('[DISCORD] Attempting to reconnect...');

		try {
			// Mark as not ready
			this.isReady = false;

			// Destroy existing client if it exists
			if (this.client && typeof this.client.destroy === 'function') {
				console.info('[DISCORD] Destroying existing client');
				await this.client.destroy();
			}

			// Create new client with same configuration
			this.client = new Client({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMessages,
					GatewayIntentBits.MessageContent,
					GatewayIntentBits.DirectMessages,
				],
				// eslint-disable-next-line ts/no-unsafe-assignment
				ws: {
					// Same timeout values as original
					handshakeTimeout: 60000,
					helloTimeout: 120000,
					readyTimeout: 30000,
				} as any,
			});

			// Setup event handlers again
			this.setupEventHandlers();

			// Attempt login with retry logic
			const result = await withDiscordRetry(
				async () => this.performLogin(this.token),
				{
					maxRetries: 3,
					baseDelayMs: 2000,
					maxDelayMs: 30000,
					onRetry: (error, attempt) => {
						console.warn(`[DISCORD] Reconnection attempt ${attempt} failed: ${error.message}. Retrying...`);
					},
				},
			);

			if (result.success) {
				console.info('[DISCORD] Successfully reconnected to Discord');
			}
			else {
				console.error('[DISCORD] Failed to reconnect after all retries');
			}
		}
		catch (error) {
			console.error(`[DISCORD] Reconnection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async stop(): Promise<void> {
		// Stop health check first
		this.stopHealthCheck();

		if (this.client) {
			await this.client.destroy();
			this.isReady = false;
		}
	}
}

if (import.meta.vitest) {
	/* eslint-disable ts/no-unsafe-assignment */
	const vitest = await import('vitest');
	const { beforeEach, describe, it, expect, vi } = vitest;

	describe('DiscordBot', () => {
		let discordBot: DiscordBot;
		let mockSessionManager: Partial<SessionManager>;
		let mockTmuxManager: Partial<TmuxManager>;
		let mockMessage: Partial<Message>;

		beforeEach(() => {
			mockSessionManager = {
				getSession: vi.fn(),
			};
			mockTmuxManager = {
				capturePane: vi.fn(),
			};
			mockMessage = {
				reply: vi.fn(),
				author: { id: 'test-user' } as any,
				channel: { id: 'test-channel' } as any,
			} as any;

			discordBot = new DiscordBot(mockSessionManager as SessionManager, mockTmuxManager as TmuxManager);

			// Mock internal state for testing
			(discordBot as any).sessionManager = mockSessionManager;
			(discordBot as any).tmuxManager = mockTmuxManager;
			(discordBot as any).channelSessionMap.set('test-channel', 'test-session');
			(discordBot as any).authorizedUsers = ['test-user'];
		});

		describe('formatOutputForDiscord', () => {
			it('should handle empty output', () => {
				const result: string[] = (discordBot as any).formatOutputForDiscord('');
				expect(result).toEqual(['```\n(empty output)\n```']);
			});

			it('should handle short output within message limit', () => {
				const shortOutput = 'Hello world\nThis is a test';
				const result: string[] = (discordBot as any).formatOutputForDiscord(shortOutput);
				expect(result).toHaveLength(1);
				// Short output that fits within MAX_CONTENT_LENGTH goes through the early return path (line 551)
				// which returns just the code block without header
				expect(result[0]).toBe('```\nHello world\nThis is a test\n```');
			});

			it('should clean and normalize output correctly', () => {
				const messyOutput = 'Line 1\r\nLine 2\rLine 3\tTabbed content';
				const result: string[] = (discordBot as any).formatOutputForDiscord(messyOutput);
				expect(result[0]).toContain('Line 1\nLine 2\nLine 3    Tabbed content');
			});

			it('should limit to last 50 lines for long output', () => {
				const longOutput = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
				const result: string[] = (discordBot as any).formatOutputForDiscord(longOutput);
				const content: string = result[0];
				// .slice(-50) gets the last 50 lines, so from line 51 to 100
				expect(content).toContain('Line 51'); // Should start from line 51
				expect(content).toContain('Line 100'); // Should end at line 100
				expect(content).not.toContain('Line 50'); // Should not contain line 50 or earlier
			});

			it('should split long output into multiple chunks', () => {
				// Create output that will exceed Discord message limit
				const longLine = 'A'.repeat(1900); // Close to Discord limit
				const longOutput = `${longLine}\n${longLine}\n${longLine}`;
				const result: string[] = (discordBot as any).formatOutputForDiscord(longOutput);

				expect(result.length).toBeGreaterThan(1);
				expect(result[0]).toContain('📺 **Session Output (1/');
				expect(result[1]).toContain('📺 **Session Output (2/');
			});

			it('should properly wrap chunks in code blocks', () => {
				const output = 'Some test output';
				const result: string[] = (discordBot as any).formatOutputForDiscord(output);
				expect(result[0]).toMatch(/```\n[\s\S]*\n```/);
			});
		});

		describe('handleOutput', () => {
			it('should reply with error when dependencies are missing', async () => {
				const botWithoutDeps = new DiscordBot();
				await (botWithoutDeps as any).handleOutput('test-session', mockMessage);
				expect(mockMessage.reply).toHaveBeenCalledWith('❌ Output display not available - missing dependencies');
			});

			it('should reply with error when session not found', async () => {
				mockSessionManager.getSession = vi.fn().mockResolvedValue(null);
				await (discordBot as any).handleOutput('test-session', mockMessage);
				expect(mockMessage.reply).toHaveBeenCalledWith('❌ Session test-session not found');
			});

			it('should reply when output is empty', async () => {
				const session = { id: 'test-session', tmuxSession: 'test-tmux' };
				mockSessionManager.getSession = vi.fn().mockResolvedValue(session);
				mockTmuxManager.capturePane = vi.fn().mockResolvedValue('');

				await (discordBot as any).handleOutput('test-session', mockMessage);
				expect(mockMessage.reply).toHaveBeenCalledWith('📺 Session output is empty');
			});

			it('should send formatted output when successful', async () => {
				const session = { id: 'test-session', tmuxSession: 'test-tmux' };
				const tmuxOutput = 'Test output\nAnother line';
				mockSessionManager.getSession = vi.fn().mockResolvedValue(session);
				mockTmuxManager.capturePane = vi.fn().mockResolvedValue(tmuxOutput);

				await (discordBot as any).handleOutput('test-session', mockMessage);

				// Short output gets formatted as simple code block without header
				expect(mockMessage.reply).toHaveBeenCalledWith(
					'```\nTest output\nAnother line\n```',
				);
			});

			it('should send multiple chunks for long output', async () => {
				const session = { id: 'test-session', tmuxSession: 'test-tmux' };
				const longOutput = `${'A'.repeat(1900)}\n${'B'.repeat(1900)}\n${'C'.repeat(1900)}`;
				mockSessionManager.getSession = vi.fn().mockResolvedValue(session);
				mockTmuxManager.capturePane = vi.fn().mockResolvedValue(longOutput);

				await (discordBot as any).handleOutput('test-session', mockMessage);

				// Should be called multiple times for multiple chunks
				expect((mockMessage.reply as any).mock.calls.length).toBeGreaterThan(1);

				// Each call should contain chunk indicators
				const calls = (mockMessage.reply as any).mock.calls;
				expect(calls[0][0]).toContain('(1/');
				expect(calls[1][0]).toContain('(2/');
			});

			it('should handle errors gracefully', async () => {
				const session = { id: 'test-session', tmuxSession: 'test-tmux' };
				mockSessionManager.getSession = vi.fn().mockResolvedValue(session);
				mockTmuxManager.capturePane = vi.fn().mockRejectedValue(new Error('Tmux error'));

				await (discordBot as any).handleOutput('test-session', mockMessage);
				expect(mockMessage.reply).toHaveBeenCalledWith('❌ Failed to fetch session output');
			});
		});

		describe('findOrphanedChannels', () => {
			it('should return empty array when no guilds', async () => {
				// Mock client with empty guilds cache
				(discordBot as any).client = { guilds: { cache: { size: 0 } } };
				const result = await discordBot.findOrphanedChannels([]);
				expect(result).toEqual([]);
			});

			it('should identify orphaned channels correctly', async () => {
				const mockChannel1 = {
					id: 'channel-1',
					name: 'ccremote-session-1',
					type: 0, // GuildText
				};
				const mockChannel2 = {
					id: 'channel-2',
					name: 'ccremote-session-2',
					type: 0, // GuildText
				};

				// Create a mock cache with a filter method
				const mockChannelCache = new Map([
					['channel-1', mockChannel1],
					['channel-2', mockChannel2],
				]);
				(mockChannelCache as any).filter = vi.fn().mockReturnValue(mockChannelCache);

				const mockGuild = {
					channels: {
						cache: mockChannelCache,
					},
				};

				// Mock client
				(discordBot as any).client = {
					guilds: {
						cache: {
							size: 1,
							first: () => mockGuild,
						},
					},
				};

				// Test with only session-1 active
				const activeSessions = [{ id: 'ccremote-1', name: 'session-1' }];
				const result = await discordBot.findOrphanedChannels(activeSessions);

				// channel-1 should not be orphaned (active session-1), channel-2 should be orphaned
				expect(result).toContain('channel-2');
				expect(result).not.toContain('channel-1');
			});

			it('should handle errors gracefully', async () => {
				// Mock client that throws error
				(discordBot as any).client = {
					guilds: {
						cache: {
							size: 1,
							first: () => {
								throw new Error('Guild error');
							},
						},
					},
				};

				const result = await discordBot.findOrphanedChannels([]);
				expect(result).toEqual([]);
			});
		});
	});
}
