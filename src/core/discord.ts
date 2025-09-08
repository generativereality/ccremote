import type { Message, TextChannel } from 'discord.js';
import type { NotificationMessage } from '../types/index.js';
import { Client, GatewayIntentBits } from 'discord.js';

export class DiscordBot {
	private client: Client;
	private authorizedUsers: string[] = [];
	private ownerId: string = '';
	private sessionChannelMap = new Map<string, string>(); // sessionId -> channelId
	private channelSessionMap = new Map<string, string>(); // channelId -> sessionId
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
		this.ownerId = ownerId;
		this.authorizedUsers = [ownerId, ...authorizedUsers];

		await this.client.login(token);

		// Wait for ready event
		return new Promise((resolve) => {
			this.client.once('ready', () => {
				this.isReady = true;
				console.info(`Discord bot logged in as ${this.client.user?.tag}`);
				resolve();
			});
		});
	}

	private setupEventHandlers(): void {
		this.client.on('messageCreate', (message) => {
			if (message.author.bot) {
				return;
			}
			void this.handleMessage(message);
		});

		this.client.on('error', (error) => {
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
			if (content === 'approve') {
				await this.handleApproval(sessionId, true);
				await message.reply('✅ Approved');
			}
			else if (content === 'deny') {
				await this.handleApproval(sessionId, false);
				await message.reply('❌ Denied');
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
			const channel = await this.client.channels.fetch(channelId) as TextChannel;
			if (!channel) {
				console.warn(`Discord channel ${channelId} not found`);
				return;
			}

			const message = this.formatNotification(notification);
			await channel.send(message);
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
				return `⚠️ **${sessionName}** - Approval Required\n🔧 Tool: ${toolName}\n\n${message}\n\n${command ? `\`\`\`${command}\`\`\`` : ''}\n\nReply with **approve** or **deny**`;
			}

			case 'error':
				return `❌ **${sessionName}** - Error\n\n${message}`;

			default:
				return `📝 **${sessionName}**\n\n${message}`;
		}
	}

	async createOrGetChannel(sessionId: string, sessionName: string): Promise<string> {
		// For now, we'll use DMs with the owner
		// In the future, this could create private channels or use existing ones

		try {
			const owner = await this.client.users.fetch(this.ownerId);
			const dmChannel = await owner.createDM();

			this.sessionChannelMap.set(sessionId, dmChannel.id);
			this.channelSessionMap.set(dmChannel.id, sessionId);

			// Send initial message
			await dmChannel.send(`🚀 **ccremote Session Started**\nSession: ${sessionName} (${sessionId})\n\nI'll send notifications for this session here.`);

			return dmChannel.id;
		}
		catch (error) {
			throw new Error(`Failed to create Discord channel: ${error instanceof Error ? error.message : error}`);
		}
	}

	async assignChannelToSession(sessionId: string, channelId: string): Promise<void> {
		this.sessionChannelMap.set(sessionId, channelId);
		this.channelSessionMap.set(channelId, sessionId);
	}

	private async handleApproval(sessionId: string, approved: boolean): Promise<void> {
		// This will be called by the approval handler
		// For now, just emit an event that the monitor can listen to
		this.client.emit('ccremote:approval', { sessionId, approved });
	}

	private async handleStatus(sessionId: string, message: Message): Promise<void> {
		// This will be implemented to show session status
		await message.reply(`📊 Session status for ${sessionId} - implementation pending`);
	}

	onApproval(handler: (sessionId: string, approved: boolean) => void): void {
		this.client.on('ccremote:approval', ({ sessionId, approved }: any) => {
			handler(sessionId as string, approved as boolean);
		});
	}

	async stop(): Promise<void> {
		if (this.client) {
			await this.client.destroy();
			this.isReady = false;
		}
	}
}
