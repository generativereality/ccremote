import type { NotificationMessage } from '../types/index.ts';
import type { DiscordBot } from './discord.ts';
import type { SessionManager } from './session.ts';
import type { TmuxManager } from './tmux.ts';
import { EventEmitter } from 'node:events';
import { generateQuotaMessage } from '../utils/quota.ts';
import { logger } from './logger.ts';

export type MonitoringOptions = {
	pollInterval?: number; // milliseconds, default 2000
	maxRetries?: number; // default 3
	autoRestart?: boolean; // default true
};

export type MonitorEvent = {
	type: 'limit_detected' | 'continuation_ready' | 'approval_needed' | 'error';
	sessionId: string;
	data?: any;
	timestamp: Date;
};

export class Monitor extends EventEmitter {
	private sessionManager: SessionManager;
	private tmuxManager: TmuxManager;
	private discordBot: DiscordBot;
	private options: Required<MonitoringOptions>;
	private monitoringIntervals = new Map<string, NodeJS.Timeout>();
	private sessionStates = new Map<string, {
		lastOutput: string;
		limitDetectedAt?: Date;
		awaitingContinuation: boolean;
		retryCount: number;
		lastContinuationTime?: Date;
		scheduledResetTime?: Date;
		immediateContinueAttempted?: boolean;
		quotaCommandSent?: boolean;
	}>();

	// ANSI escape sequence constants for linting compliance
	private readonly ANSI_ESCAPE = '\u001B[';

	// Pattern matching for Claude Code messages
	public readonly patterns = {
		// Usage limit patterns - must contain full contextual phrases to avoid false positives
		// Real limit messages have explanatory text, not just session summary entries
		usageLimit: /(?:you've\s+reached\s+your.*?(?:conversation\s+)?limit|your\s+(?:conversation\s+)?limit\s+(?:will\s+)?reset|usage\s+limit\s+reached\.\s+your\s+limit\s+resets|continue\s+this\s+conversation\s+(?:later\s+)?(?:when|by)|you\s+can\s+continue\s+(?:this\s+)?conversation\s+when)/i,
		// Continuation ready patterns
		continuationReady: /(?:continue|resume|ready.*continue)/i,
		// Claude Code approval dialog patterns - from working proof-of-concept
		approvalDialog: {
			// Must have all three components for valid approval dialog
			question: /Do you want to (?:make this edit to|create|proceed)/i,
			numberedOptions: /\b\d+\.\s+Yes/,
			currentSelection: /❯/,
		},
		// Reset time parsing patterns
		resetTime: /(\d{1,2}(?::\d{2})?(?:am|pm))/i,
	};

	constructor(
		sessionManager: SessionManager,
		tmuxManager: TmuxManager,
		discordBot: DiscordBot,
		options: MonitoringOptions = {},
	) {
		super();
		this.sessionManager = sessionManager;
		this.tmuxManager = tmuxManager;
		this.discordBot = discordBot;
		this.options = {
			pollInterval: options.pollInterval || 2000,
			maxRetries: options.maxRetries || 3,
			autoRestart: options.autoRestart || true,
		};
	}

	/**
	 * Safely send Discord notification with error handling
	 */
	private async safeNotifyDiscord(sessionId: string, notification: NotificationMessage): Promise<void> {
		if (!this.discordBot) {
			logger.debug('Discord bot not available, skipping notification');
			return;
		}

		// The DiscordBot.sendNotification method now handles retries internally,
		// so we just need to catch any final failures to prevent monitoring disruption
		try {
			await this.discordBot.sendNotification(sessionId, notification);
		}
		catch (error) {
			logger.warn(`Failed to send Discord notification after retries: ${error instanceof Error ? error.message : String(error)}`);
			// Don't throw - continue monitoring even if Discord fails
		}
	}

	async startMonitoring(sessionId: string): Promise<void> {
		const session = await this.sessionManager.getSession(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		// Initialize session state
		this.sessionStates.set(sessionId, {
			lastOutput: '',
			awaitingContinuation: false,
			retryCount: 0,
			lastContinuationTime: undefined,
			scheduledResetTime: undefined,
			immediateContinueAttempted: false,
			quotaCommandSent: false,
		});

		// Start polling
		const interval = setInterval(() => {
			void this.pollSession(sessionId);
		}, this.options.pollInterval);

		this.monitoringIntervals.set(sessionId, interval);
		logger.info(`Started monitoring session: ${sessionId}`);
	}

	async stopMonitoring(sessionId: string): Promise<void> {
		const interval = this.monitoringIntervals.get(sessionId);
		if (interval) {
			clearInterval(interval);
			this.monitoringIntervals.delete(sessionId);
		}
		this.sessionStates.delete(sessionId);
		logger.info(`Stopped monitoring session: ${sessionId}`);
	}

	private async pollSession(sessionId: string): Promise<void> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				logger.warn(`Session ${sessionId} not found, stopping monitoring`);
				await this.stopMonitoring(sessionId);
				return;
			}

			// Check if tmux session still exists
			const tmuxExists = await this.tmuxManager.sessionExists(session.tmuxSession);
			if (!tmuxExists) {
				logger.info(`Tmux session ${session.tmuxSession} no longer exists`);
				await this.handleSessionEnded(sessionId);
				return;
			}

			// Check for scheduled continuation first
			const sessionState = this.sessionStates.get(sessionId);
			if (sessionState?.scheduledResetTime) {
				const now = new Date();
				if (now >= sessionState.scheduledResetTime) {
					logger.info(`Scheduled reset time arrived, executing continuation for session ${sessionId}`);
					sessionState.scheduledResetTime = undefined;
					await this.performAutoContinuation(sessionId);
					return; // Continue normal monitoring on next poll
				}
			}

			// Check for quota schedule
			if (session.quotaSchedule) {
				const sessionState = this.sessionStates.get(sessionId);
				const now = new Date();
				const nextExecution = new Date(session.quotaSchedule.nextExecution);

				// Send the command early (5 seconds after session starts) so user can see it staged
				if (!sessionState?.quotaCommandSent) {
					const sessionAge = now.getTime() - new Date(session.created).getTime();
					if (sessionAge > 5000) { // 5 seconds after session creation
						logger.info(`Staging quota command for session ${sessionId} to display in terminal`);
						// Use sendRawKeys to type the command without automatically adding Enter
						await this.tmuxManager.sendRawKeys(session.tmuxSession, session.quotaSchedule.command);
						if (sessionState) {
							sessionState.quotaCommandSent = true;
						}
					}
				}

				// Execute (send Enter) at the scheduled time
				if (now >= nextExecution && sessionState?.quotaCommandSent) {
					logger.info(`Quota schedule time arrived, executing staged command for session ${sessionId}`);
					await this.executeQuotaSchedule(sessionId, session.quotaSchedule);
					return; // Continue normal monitoring on next poll
				}
			}

			// Get current output (plain text for most analysis)
			const currentOutput = await this.tmuxManager.capturePane(session.tmuxSession);
			await this.analyzeOutput(sessionId, currentOutput);
		}
		catch (error) {
			logger.error(`Error polling session ${sessionId}: ${error}`);
			await this.handlePollingError(sessionId, error);
		}
	}

	private async analyzeOutput(sessionId: string, output: string): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// Skip if output hasn't changed
		if (output === sessionState.lastOutput) {
			return;
		}

		// Get only new output since last check
		const newOutput = this.getNewOutput(sessionState.lastOutput, output);
		sessionState.lastOutput = output;

		// Analyze new output for patterns
		await this.detectPatterns(sessionId, newOutput);
	}

	public getNewOutput(lastOutput: string, currentOutput: string): string {
		if (!lastOutput) {
			return currentOutput;
		}

		// Simple approach: if current output contains last output, return the difference
		if (currentOutput.includes(lastOutput)) {
			return currentOutput.substring(lastOutput.length);
		}

		// Otherwise return current output (tmux pane may have scrolled)
		return currentOutput;
	}

	private async detectPatterns(sessionId: string, output: string): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// Check for usage limit with cooldown protection and terminal state validation
		if (this.hasLimitMessage(output) && this.isActiveTerminalState(output) && !sessionState.awaitingContinuation) {
			// Check cooldown period to prevent continuous continuation loops (5 minutes)
			const CONTINUATION_COOLDOWN_MS = 5 * 60 * 1000;
			const timeSinceLastContinuation = sessionState.lastContinuationTime
				? Date.now() - sessionState.lastContinuationTime.getTime()
				: CONTINUATION_COOLDOWN_MS + 1; // Allow if never continued

			if (timeSinceLastContinuation < CONTINUATION_COOLDOWN_MS) {
				const remainingCooldown = Math.round((CONTINUATION_COOLDOWN_MS - timeSinceLastContinuation) / 1000);
				logger.info(`Usage limit detected but in cooldown period (${remainingCooldown}s remaining), skipping`);
				return;
			}

			logger.info(`Usage limit detected for session ${sessionId}`);
			sessionState.limitDetectedAt = new Date();
			sessionState.awaitingContinuation = true;

			await this.handleLimitDetected(sessionId, output);
		}

		// Check for continuation readiness (after limit was detected)
		if (sessionState.awaitingContinuation && this.patterns.continuationReady.test(output)) {
			logger.info(`Continuation ready detected for session ${sessionId}`);
			await this.handleContinuationReady(sessionId, output);
		}

		// Check for Claude Code approval dialogs with color validation
		if (this.detectApprovalDialog(output)) {
			// Validate this is a real interactive approval dialog by checking colors
			const session = await this.sessionManager.getSession(sessionId);
			if (session) {
				const colorOutput = await this.tmuxManager.capturePaneWithColors(session.tmuxSession);
				if (this.isInteractiveApprovalDialog(colorOutput)) {
					logger.info(`Interactive approval dialog detected for session ${sessionId}`);
					await this.handleApprovalRequest(sessionId, output);
				}
				else {
					logger.debug(`Approval-like text detected but not interactive (likely pasted text), skipping`);
				}
			}
		}
	}

	private async handleLimitDetected(sessionId: string, output: string): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// Check if already scheduled to prevent duplicate notifications
		if (sessionState.scheduledResetTime) {
			logger.info(`Already scheduled continuation for ${sessionState.scheduledResetTime.toLocaleString()}, skipping duplicate detection`);
			return;
		}

		const event: MonitorEvent = {
			type: 'limit_detected',
			sessionId,
			data: { output },
			timestamp: new Date(),
		};

		this.emit('limit_detected', event);

		// Only try immediate continuation once per limit detection
		if (!sessionState.immediateContinueAttempted) {
			sessionState.immediateContinueAttempted = true;

			// Try to continue immediately first (similar to POC logic)
			const continueResult = await this.tryImmediateContinuation(sessionId, output);

			if (continueResult.success) {
				// Continuation succeeded immediately - limit has already reset
				logger.info(`Immediate continuation successful for session ${sessionId} - no notification needed`);
				sessionState.lastContinuationTime = new Date();
				sessionState.awaitingContinuation = false;
				sessionState.immediateContinueAttempted = false; // Reset for next limit detection

				await this.sessionManager.updateSession(sessionId, { status: 'active' });
				return; // Exit early, no notification needed
			}
		}

		// Immediate continuation failed or already attempted - schedule for later
		const resetTime = this.extractResetTime(output);
		if (resetTime) {
			const resetDateTime = await this.parseResetTime(resetTime);
			if (resetDateTime) {
				sessionState.scheduledResetTime = resetDateTime;
				logger.info(`Scheduled continuation for ${resetDateTime.toLocaleString()}`);
			}
		}

		// Send Discord notification (only once)
		await this.safeNotifyDiscord(sessionId, {
			type: 'limit',
			sessionId,
			sessionName: (await this.sessionManager.getSession(sessionId))?.name || sessionId,
			message: 'Usage limit reached. Will automatically continue when limit resets.',
			metadata: {
				resetTime: resetTime || 'Monitoring for availability',
				detectedAt: new Date().toISOString(),
			},
		});

		// Update session status
		await this.sessionManager.updateSession(sessionId, { status: 'waiting' });
	}

	private async handleContinuationReady(sessionId: string, output: string): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// Reset state and set cooldown timestamp
		sessionState.awaitingContinuation = false;
		sessionState.retryCount = 0;
		sessionState.lastContinuationTime = new Date();
		sessionState.scheduledResetTime = undefined;

		const event: MonitorEvent = {
			type: 'continuation_ready',
			sessionId,
			data: { output },
			timestamp: new Date(),
		};

		this.emit('continuation_ready', event);

		// Auto-continue with small delay
		setTimeout(() => {
			void this.performAutoContinuation(sessionId);
		}, 2000); // 2 second delay
	}

	/**
	 * Check if approval dialog is interactive (not pasted text) by looking for color codes
	 * Real approval dialogs have color formatting, pasted text appears in grey
	 */
	public isInteractiveApprovalDialog(colorOutput: string): boolean {
		// Look for ANSI color escape sequences that indicate interactive content
		// Pasted text typically appears in grey (color 8 or 90) or dim formatting
		// Interactive dialogs have normal/bright colors

		const lines = colorOutput.split('\n');
		let hasInteractiveColors = false;
		let hasApprovalContent = false;

		for (const line of lines) {
			// Check if line contains approval-related content
			if (line.includes('Do you want to') || line.includes('❯') || /\d+\.\s+Yes/.test(line)) {
				hasApprovalContent = true;

				// Look for color codes that indicate interactive content
				// ESC[0m = reset, ESC[1m = bold, ESC[36m = cyan, etc.
				// Avoid grey/dim colors: ESC[2m (dim), ESC[90m (grey), ESC[8m (invisible)
				const hasNormalColors = line.includes(this.ANSI_ESCAPE) && /\[(?:[013-79]|[13][0-79]|4[0-79]|9[1-79])m/.test(line);
				const isGreyOrDim = line.includes(this.ANSI_ESCAPE) && /\[(?:2|8|90)m/.test(line);

				if (hasNormalColors && !isGreyOrDim) {
					hasInteractiveColors = true;
				}
			}
		}

		// If we have approval content but no color info at all, assume it's interactive
		// (some terminals might not show colors)
		if (hasApprovalContent && !colorOutput.includes(this.ANSI_ESCAPE)) {
			return true;
		}

		return hasApprovalContent && hasInteractiveColors;
	}

	/**
	 * Check if output contains a limit message (simplified pattern)
	 */
	public hasLimitMessage(output: string): boolean {
		return /limit\s+reached|usage\s+limit|limit.*resets/i.test(output);
	}

	/**
	 * Check if terminal is in an active state (has input prompt, not just displaying a list)
	 * Active states include command prompts, input boxes, or continuation messages
	 */
	public isActiveTerminalState(output: string): boolean {
		// Look for command prompt patterns or input indicators
		const activeStatePatterns = [
			/^>\s*$/m, // Command prompt line
			/^[^>\n]*>\s*$/m, // Prompt with text before >
			/─+\s*>\s*─+/, // Input box with > prompt (simplified)
			/continue\s+this\s+conversation/i, // Continuation instruction
			/you\s+can\s+continue/i, // Alternative continuation text
			/your\s+limit\s+(?:will\s+)?reset/i, // Reset information
		];

		return activeStatePatterns.some(pattern => pattern.test(output));
	}

	/**
	 * Detect Claude Code approval dialogs using proven patterns from proof-of-concept
	 * Requires all three components: question, numbered options, and current selection
	 */
	public detectApprovalDialog(output: string): boolean {
		const lines = output.split('\n');
		let hasApprovalQuestion = false;
		let hasNumberedOptions = false;
		let hasCurrentSelection = false;

		for (const line of lines) {
			const trimmedLine = line.trim();

			// Check for approval questions
			if (this.patterns.approvalDialog.question.test(trimmedLine)) {
				hasApprovalQuestion = true;
			}

			// Check for numbered options
			if (this.patterns.approvalDialog.numberedOptions.test(trimmedLine)) {
				hasNumberedOptions = true;
			}

			// Check for current selection arrow
			if (this.patterns.approvalDialog.currentSelection.test(trimmedLine)) {
				hasCurrentSelection = true;
			}

			// Early exit if all components found
			if (hasApprovalQuestion && hasNumberedOptions && hasCurrentSelection) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Extract approval information from the detected dialog including all available options
	 */
	public extractApprovalInfo(output: string): { tool: string; action: string; question: string; options: Array<{ number: number; text: string; shortcut?: string }> } {
		const lines = output.split('\n');
		let question = '';
		let tool = 'Unknown';
		let action = 'Unknown operation';
		const options: Array<{ number: number; text: string; shortcut?: string }> = [];

		for (const line of lines) {
			// Clean line of box drawing characters and extra whitespace
			const cleanLine = line.replace(/[│┃┆┊╎╏║╭╮╯╰┌┐└┘├┤┬┴┼─━┄┅┈┉═╔╗╚╝╠╣╦╩╬❯]/g, '').replace(/\s+/g, ' ').trim();

			// Extract numbered options (e.g. "1. Yes", "2. Yes, allow all edits during this session (shift+tab)", "3. No, and tell Claude what to do differently (esc)")
			// Use a simpler approach to avoid regex backtracking
			const numberMatch = cleanLine.match(/^(\d+)\./);
			if (numberMatch) {
				const number = Number.parseInt(numberMatch[1], 10);
				const afterNumber = cleanLine.slice(numberMatch[0].length).trim();

				// Check for shortcut in parentheses at the end
				const shortcutMatch = afterNumber.match(/\(([^)]+)\)$/);
				let text = afterNumber;
				let shortcut: string | undefined;

				if (shortcutMatch) {
					text = afterNumber.slice(0, -shortcutMatch[0].length).trim();
					shortcut = shortcutMatch[1];
				}

				options.push({
					number,
					text,
					shortcut,
				});
			}

			// Extract the specific question
			if (this.patterns.approvalDialog.question.test(cleanLine)) {
				question = cleanLine;

				// Determine tool and action based on question content
				if (cleanLine.includes('make this edit to')) {
					tool = 'Edit';
					// Support various file extensions including TypeScript and Python files
					const filename = cleanLine.match(/([^/\\\s]+\.[a-z0-9]+)\?/i)?.[1] || 'file';
					action = `Edit ${filename}`;
				}
				else if (cleanLine.includes('create') && cleanLine.includes('.')) {
					tool = 'Write';
					const filename = cleanLine.match(/create ([^?\s]+)/)?.[1] || 'file';
					action = `Create ${filename}`;
				}
				else if (cleanLine.includes('proceed')) {
					// Check if this is a bash command by looking at context
					if (output.includes('Bash command')) {
						tool = 'Bash';
						// Try to extract command from the output - look for the command line
						const lines = output.split('\n');
						let command = 'unknown command';
						for (const line of lines) {
							const cleanLine = line.replace(/[│┃┆┊╎╏║╭╮╯╰┌┐└┘├┤┬┴┼─━┄┅┈┉═╔╗╚╝╠╣╦╩╬]/g, '').trim();
							// Look for lines that start with commands (not empty, not descriptions)
							if (cleanLine && !cleanLine.includes('Bash command') && !cleanLine.includes('Do you want') && !cleanLine.includes('Yes') && !cleanLine.includes('No') && cleanLine.length > 3) {
								command = cleanLine;
								break;
							}
						}
						action = `Execute: ${command}`;
					}
					else {
						tool = 'Tool';
						action = 'Proceed with operation';
					}
				}
			}
		}

		return { tool, action, question, options };
	}

	private async handleApprovalRequest(sessionId: string, output: string): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// Extract approval info
		const approvalInfo = this.extractApprovalInfo(output);

		// Prevent duplicate notifications for the same approval
		const approvalKey = approvalInfo.question;
		if ((sessionState as any).lastApprovalQuestion === approvalKey) {
			logger.info('Skipping duplicate approval request');
			return;
		}
		(sessionState as any).lastApprovalQuestion = approvalKey;

		const event: MonitorEvent = {
			type: 'approval_needed',
			sessionId,
			data: { output, approvalInfo, reason: 'approval_dialog' },
			timestamp: new Date(),
		};

		this.emit('approval_needed', event);

		// Format options for Discord display
		const optionsText = approvalInfo.options.length > 0
			? approvalInfo.options.map(opt =>
					`**${opt.number}.** ${opt.text}${opt.shortcut ? ` *(${opt.shortcut})*` : ''}`,
				).join('\n')
			: 'No options detected';

		// Send Discord notification
		await this.safeNotifyDiscord(sessionId, {
			type: 'approval',
			sessionId,
			sessionName: (await this.sessionManager.getSession(sessionId))?.name || sessionId,
			message: `🔐 Approval Required\n\n**Tool:** ${approvalInfo.tool}\n**Action:** ${approvalInfo.action}\n**Question:** ${approvalInfo.question}\n\n**Options:**\n${optionsText}\n\nReply with the option number (e.g. '1', '2', '3')`,
			metadata: {
				toolName: approvalInfo.tool,
				action: approvalInfo.action,
				question: approvalInfo.question,
				approvalRequested: true,
				timestamp: new Date().toISOString(),
			},
		});

		// Update session status
		await this.sessionManager.updateSession(sessionId, { status: 'waiting_approval' });
	}

	private async handleSessionEnded(sessionId: string): Promise<void> {
		await this.stopMonitoring(sessionId);
		// Don't update session status or send notification here -
		// the daemon's runLoop will handle this more gracefully
	}

	private async handlePollingError(sessionId: string, error: unknown): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		sessionState.retryCount++;

		if (sessionState.retryCount >= this.options.maxRetries) {
			logger.error(`Max retries exceeded for session ${sessionId}, stopping monitoring`);
			await this.stopMonitoring(sessionId);

			const event: MonitorEvent = {
				type: 'error',
				sessionId,
				data: { error: error instanceof Error ? error.message : String(error) },
				timestamp: new Date(),
			};

			this.emit('error', event);
		}
		else {
			logger.warn(`Polling error for session ${sessionId}, retry ${sessionState.retryCount}/${this.options.maxRetries}`);
		}
	}

	private async performAutoContinuation(sessionId: string): Promise<void> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				return;
			}

			const sessionState = this.sessionStates.get(sessionId);
			if (!sessionState) {
				return;
			}

			logger.info(`Performing auto-continuation for session ${sessionId}`);

			// Use the proper continuation command
			await this.tmuxManager.sendContinueCommand(session.tmuxSession);

			// Update state
			sessionState.lastContinuationTime = new Date();
			sessionState.awaitingContinuation = false;
			sessionState.scheduledResetTime = undefined;
			sessionState.immediateContinueAttempted = false; // Reset for next limit detection

			// Update session status
			await this.sessionManager.updateSession(sessionId, { status: 'active' });

			// Send notification
			await this.safeNotifyDiscord(sessionId, {
				type: 'continued',
				sessionId,
				sessionName: session.name,
				message: 'Session automatically continued after limit reset.',
			});

			logger.info(`Auto-continuation completed for session ${sessionId}`);
		}
		catch (error) {
			logger.error(`Auto-continuation failed for session ${sessionId}: ${error}`);
		}
	}

	/**
	 * Try to continue immediately - similar to POC logic
	 */
	private async tryImmediateContinuation(sessionId: string, _output: string): Promise<{ success: boolean; response?: string }> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				return { success: false };
			}

			logger.info(`Trying immediate continuation for session ${sessionId}`);

			// Send continue command
			await this.tmuxManager.sendContinueCommand(session.tmuxSession);

			// Wait for response
			await new Promise(resolve => setTimeout(resolve, 3000));
			const responseOutput = await this.tmuxManager.capturePane(session.tmuxSession);

			// Check if the same limit message still appears
			const stillHasLimitMessage = this.patterns.usageLimit.test(responseOutput);

			if (stillHasLimitMessage) {
				logger.info('Immediate continuation failed - limit message still present');
				return { success: false, response: responseOutput };
			}
			else {
				logger.info('Immediate continuation successful - no limit message in response');
				return { success: true, response: responseOutput };
			}
		}
		catch (error) {
			logger.error(`Immediate continuation attempt failed: ${error}`);
			return { success: false };
		}
	}

	/**
	 * Extract reset time from limit message
	 */
	private extractResetTime(output: string): string | null {
		const timePatterns = [
			/resets (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
			/available again at (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
			/ready at (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
		];

		for (const pattern of timePatterns) {
			const match = output.match(pattern);
			if (match) {
				return match[1].trim();
			}
		}

		return null;
	}

	/**
	 * Parse reset time string into Date object (from POC)
	 */
	private async parseResetTime(timeStr: string): Promise<Date | null> {
		try {
			const now = new Date();
			timeStr = timeStr.toLowerCase().trim();

			// Match patterns like "10pm", "2:30pm", "14:00", etc.
			const timeMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
			if (!timeMatch) {
				logger.warn(`No time match found in: ${timeStr}`);
				return null;
			}

			const [, hours, minutes, period] = timeMatch;
			let numHours = Number.parseInt(hours, 10);
			const numMinutes = minutes ? Number.parseInt(minutes, 10) : 0;

			// Handle AM/PM conversion
			if (period) {
				if (period === 'pm' && numHours !== 12) {
					numHours += 12;
				}
				else if (period === 'am' && numHours === 12) {
					numHours = 0;
				}
			}

			const resetTime = new Date(now);
			resetTime.setHours(numHours, numMinutes, 0, 0);

			// If the calculated time is before now, add 24 hours (assume tomorrow)
			if (resetTime <= now) {
				resetTime.setDate(resetTime.getDate() + 1);
				logger.info(`Reset time passed, scheduling for tomorrow: ${resetTime.toLocaleString()}`);
			}

			// Sanity check: Claude windows are 5 hours, so reset time shouldn't be more than 5 hours from now
			const hoursToReset = (resetTime.getTime() - now.getTime()) / (1000 * 60 * 60);
			if (hoursToReset > 5) {
				logger.warn(`Sanity check failed: Reset time ${hoursToReset.toFixed(1)} hours away exceeds 5-hour window`);
				return null;
			}

			logger.info(`Parsed "${timeStr}" as ${resetTime.toLocaleString()}`);
			return resetTime;
		}
		catch (error) {
			logger.error(`Failed to parse reset time: ${error} for input: ${timeStr}`);
			return null;
		}
	}

	/**
	 * Execute a scheduled quota command and schedule the next occurrence
	 */
	private async executeQuotaSchedule(sessionId: string, quotaSchedule: { time: string; command: string; nextExecution: string }): Promise<void> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				return;
			}

			logger.info(`Executing quota schedule for session ${sessionId}: ${quotaSchedule.command}`);

			// Execute the staged command (just send Enter since command is already typed)
			await this.tmuxManager.sendRawKeys(session.tmuxSession, 'Enter');

			// Calculate next execution time (same time tomorrow)
			const now = new Date();
			const nextExecution = await this.parseTimeToNextOccurrence(quotaSchedule.time);

			if (nextExecution) {
				// Generate new command with updated date
				const newCommand = generateQuotaMessage(nextExecution);

				// Update session with next execution time and updated command
				await this.sessionManager.updateSession(sessionId, {
					quotaSchedule: {
						...quotaSchedule,
						command: newCommand,
						nextExecution: nextExecution.toISOString(),
					},
				});

				// Reset the command sent flag for next day
				const sessionState = this.sessionStates.get(sessionId);
				if (sessionState) {
					sessionState.quotaCommandSent = false;
				}

				const hoursUntilNext = (nextExecution.getTime() - now.getTime()) / (1000 * 60 * 60);
				logger.info(`Next quota schedule execution in ${hoursUntilNext.toFixed(1)} hours: ${nextExecution.toLocaleString()}`);

				// Send Discord notification about quota window start
				await this.safeNotifyDiscord(sessionId, {
					type: 'continued', // Reuse continued type for quota notifications
					sessionId,
					sessionName: session.name,
					message: `🕕 Daily quota window started! Early command executed to align quota timing.`,
					metadata: {
						nextScheduledExecution: nextExecution.toISOString(),
						quotaWindowTime: quotaSchedule.time,
						timestamp: new Date().toISOString(),
					},
				});
			}

			logger.info(`Quota schedule executed successfully for session ${sessionId}`);
		}
		catch (error) {
			logger.error(`Failed to execute quota schedule for session ${sessionId}: ${error}`);
		}
	}

	/**
	 * Parse time string to next occurrence (today if future, tomorrow if past)
	 * Same logic as in schedule command
	 */
	private async parseTimeToNextOccurrence(timeStr: string): Promise<Date | null> {
		try {
			const now = new Date();
			timeStr = timeStr.toLowerCase().trim();

			// Match patterns like "5:00", "5am", "17:30", "5:30pm"
			const timeMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
			if (!timeMatch) {
				return null;
			}

			const [, hours, minutes, period] = timeMatch;
			let numHours = Number.parseInt(hours, 10);
			const numMinutes = minutes ? Number.parseInt(minutes, 10) : 0;

			// Handle AM/PM conversion
			if (period) {
				if (period === 'pm' && numHours !== 12) {
					numHours += 12;
				}
				else if (period === 'am' && numHours === 12) {
					numHours = 0;
				}
			}

			// Validate time
			if (numHours < 0 || numHours > 23 || numMinutes < 0 || numMinutes > 59) {
				return null;
			}

			const executeAt = new Date(now);
			executeAt.setHours(numHours, numMinutes, 0, 0);

			// Always schedule for tomorrow for daily recurrence
			executeAt.setDate(executeAt.getDate() + 1);

			return executeAt;
		}
		catch (error) {
			logger.error(`Failed to parse time for next occurrence: ${error} for input: ${timeStr}`);
			return null;
		}
	}

	async stopAll(): Promise<void> {
		const sessionIds = Array.from(this.monitoringIntervals.keys());
		for (const sessionId of sessionIds) {
			await this.stopMonitoring(sessionId);
		}
	}

	getActiveMonitoring(): string[] {
		return Array.from(this.monitoringIntervals.keys());
	}
}

if (import.meta.vitest) {
	const vitest = await import('vitest');
	const { beforeEach, afterEach, describe, it, expect, vi } = vitest;

	describe('Monitor', () => {
		let monitor: Monitor;
		let mockSessionManager: Partial<SessionManager>;
		let mockTmuxManager: Partial<TmuxManager>;
		let mockDiscordBot: Partial<DiscordBot>;

		beforeEach(() => {
			mockSessionManager = {
				getSession: vi.fn(),
				updateSession: vi.fn(),
			};
			mockTmuxManager = {
				sessionExists: vi.fn(),
				capturePane: vi.fn(),
				sendKeys: vi.fn(),
			};
			mockDiscordBot = {
				sendNotification: vi.fn(),
			};

			monitor = new Monitor(mockSessionManager as SessionManager, mockTmuxManager as TmuxManager, mockDiscordBot as DiscordBot);
		});

		afterEach(() => {
			void monitor.stopAll();
		});

		it('should detect usage limit patterns', () => {
			const testOutput = '5-hour limit reached. Your limit resets at 3:45pm';
			const patterns = (monitor as Monitor & { [key: string]: any }).patterns as { usageLimit: RegExp };
			expect(patterns.usageLimit.test(testOutput)).toBe(true);
		});

		it('should detect continuation ready patterns', () => {
			const testOutput = 'Ready to continue...';
			const patterns = (monitor as Monitor & { [key: string]: any }).patterns as { continuationReady: RegExp };
			expect(patterns.continuationReady.test(testOutput)).toBe(true);
		});

		it('should calculate new output correctly', () => {
			const lastOutput = 'Hello world';
			const currentOutput = 'Hello world\nNew line here';
			const newOutput = (monitor as Monitor & { [key: string]: any }).getNewOutput(lastOutput, currentOutput);
			expect(newOutput).toBe('\nNew line here');
		});

		// Enhanced approval dialog detection tests with real fixtures
		describe('Approval Dialog Detection', () => {
			const tmuxEditFixture = `╭─────────────────────────────────────────────────────────────────────╮
│ Edit file                                                           │
│ ╭─────────────────────────────────────────────────────────────────╮ │
│ │ src/core/tmux.ts                                                │ │
│ │                                                                 │ │
│ │    6    export class TmuxManager {                              │ │
│ │    7      async createSession(sessionName: string):             │ │
│ │        Promise<void> {                                          │ │
│ │    8        try {                                               │ │
│ │    9 -        // Create new tmux session                        │ │
│ │   10 -        const createCommand = \`tmux new-session -d -s     │ │
│ │      -  "\${sessionName}" -c "\${process.cwd()}";                │ │
│ │    9 +        // Create new tmux session                        │ │
│ │      +   with mouse mode enabled                                │ │
│ │   10 +        const createCommand = \`tmux new-session -d -s     │ │
│ │      +  "\${sessionName}" -c "\${process.cwd()}"                  │ │
│ │      +   \\; set -g mouse on\`;                                  │ │
│ │   11          await execAsync(createCommand);                   │ │
│ │   12                                                            │ │
│ │   13          // Start Claude in the session                    │ │
│ ╰─────────────────────────────────────────────────────────────────╯ │
│ Do you want to make this edit to tmux.ts?                           │
│ ❯ 1. Yes                                                            │
│   2. Yes, allow all edits during this session (shift+tab)           │
│   3. No, and tell Claude what to do differently (esc)               │
│                                                                     │
╰─────────────────────────────────────────────────────────────────────╯`;

			const tmuxProceedFixture = `╭─────────────────────────────────────────────────╮
│ Warning: This operation may have side effects   │
│ Do you want to proceed?                         │
│ ❯ 1. Yes                                        │
│   2. No                                         │
╰─────────────────────────────────────────────────╯`;

			const tmuxBashFixture = `╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Bash command                                                                                                                                     │
│                                                                                                                                                  │
│   vitest run src/core/monitor.ts                                                                                                                 │
│   Run vitest on monitor file                                                                                                                     │
│                                                                                                                                                  │
│ Do you want to proceed?                                                                                                                          │
│ ❯ 1. Yes                                                                                                                                         │
│   2. Yes, and don't ask again for vitest run commands in /Users/motin/Dev/Projects/generative-reality/ccremote                                   │
│   3. No, and tell Claude what to do differently (esc)                                                                                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`;

			const tmuxCreateFileFixture = `│ Do you want to create debug-stop.js?                                                                                                          │
│ ❯ 1. Yes                                                                                                                                      │
│   2. Yes, allow all edits during this session (shift+tab)                                                                                     │
│   3. No, and tell Claude what to do differently (esc)                                                                                         │
│                                                                                                                                               │
╰───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`;

			const pythonFileEditFixture = `╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Edit file                                                                                                                                                                                       │
│ ╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮ │
│ │ src/utils/config_helper.py                                                                                                                                                                     │ │
│ │                                                                                                                                                                                             │ │
│ │   42                         config_data = self.load_config(),                                                                                                                              │ │
│ │   43                         default_timeout = 30,                                                                                                                                          │ │
│ │   44                         # Set up connection parameters                                                                                                                                 │ │
│ │   45 -                       connection_params = ConnectionConfig(                                                                                                                          │ │
│ │   46 -                           timeout = default_timeout                                                                                                                                  │ │
│ │   47 -                       ),                                                                                                                                                             │ │
│ │   45 +                       connection_params = {"timeout": default_timeout},                                                                                                              │ │
│ │   46                         # Additional configuration options                                                                                                                             │ │
│ │   47                         extra_options = [                                                                                                                                              │ │
│ │   48                             ConfigOption(                                                                                                                                              │ │
│ ╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯ │
│ Do you want to make this edit to config_helper.py?                                                                                                                                             │
│ ❯ 1. Yes                                                                                                                                                                                        │
│   2. Yes, allow all edits during this session (shift+tab)                                                                                                                                       │
│   3. No, and tell Claude what to do differently (esc)                                                                                                                                           │
│                                                                                                                                                                                                 │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`;

			const noApprovalFixture = `Regular tmux output without approval dialog
Some command output
More text here`;

			it('should detect file edit approval dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).detectApprovalDialog(tmuxEditFixture);
				expect(result).toBe(true);
			});

			it('should detect proceed approval dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).detectApprovalDialog(tmuxProceedFixture);
				expect(result).toBe(true);
			});

			it('should detect bash command approval dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).detectApprovalDialog(tmuxBashFixture);
				expect(result).toBe(true);
			});

			it('should detect file creation approval dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).detectApprovalDialog(tmuxCreateFileFixture);
				expect(result).toBe(true);
			});

			it('should detect python file edit approval dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).detectApprovalDialog(pythonFileEditFixture);
				expect(result).toBe(true);
			});

			it('should not detect non-approval output', () => {
				const result = (monitor as Monitor & { [key: string]: any }).detectApprovalDialog(noApprovalFixture);
				expect(result).toBe(false);
			});

			it('should extract approval info from file edit dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).extractApprovalInfo(tmuxEditFixture);
				expect(result.tool).toBe('Edit');
				expect(result.action).toBe('Edit tmux.ts');
				expect(result.question).toBe('Do you want to make this edit to tmux.ts?');
				expect(result.options).toHaveLength(3);
				expect(result.options[0]).toEqual({ number: 1, text: 'Yes' });
				expect(result.options[1]).toEqual({ number: 2, text: 'Yes, allow all edits during this session', shortcut: 'shift+tab' });
				expect(result.options[2]).toEqual({ number: 3, text: 'No, and tell Claude what to do differently', shortcut: 'esc' });
			});

			it('should extract approval info from proceed dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).extractApprovalInfo(tmuxProceedFixture);
				expect(result.tool).toBe('Tool');
				expect(result.action).toBe('Proceed with operation');
				expect(result.question).toBe('Do you want to proceed?');
				expect(result.options).toHaveLength(2);
				expect(result.options[0]).toEqual({ number: 1, text: 'Yes' });
				expect(result.options[1]).toEqual({ number: 2, text: 'No' });
			});

			it('should extract approval info from bash command dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).extractApprovalInfo(tmuxBashFixture);
				expect(result.tool).toBe('Bash');
				expect(result.action).toBe('Execute: vitest run src/core/monitor.ts');
				expect(result.question).toBe('Do you want to proceed?');
				expect(result.options).toHaveLength(3);
				expect(result.options[0]).toEqual({ number: 1, text: 'Yes' });
				expect(result.options[1]).toEqual({ number: 2, text: 'Yes, and don\'t ask again for vitest run commands in /Users/motin/Dev/Projects/generative-reality/ccremote' });
				expect(result.options[2]).toEqual({ number: 3, text: 'No, and tell Claude what to do differently', shortcut: 'esc' });
			});

			it('should extract approval info from file creation dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).extractApprovalInfo(tmuxCreateFileFixture);
				expect(result.tool).toBe('Write');
				expect(result.action).toBe('Create debug-stop.js');
				expect(result.question).toBe('Do you want to create debug-stop.js?');
				expect(result.options).toHaveLength(3);
				expect(result.options[0]).toEqual({ number: 1, text: 'Yes' });
				expect(result.options[1]).toEqual({ number: 2, text: 'Yes, allow all edits during this session', shortcut: 'shift+tab' });
				expect(result.options[2]).toEqual({ number: 3, text: 'No, and tell Claude what to do differently', shortcut: 'esc' });
			});

			it('should extract approval info from python file edit dialog', () => {
				const result = (monitor as Monitor & { [key: string]: any }).extractApprovalInfo(pythonFileEditFixture);
				expect(result.tool).toBe('Edit');
				expect(result.action).toBe('Edit config_helper.py');
				expect(result.question).toBe('Do you want to make this edit to config_helper.py?');
				expect(result.options).toHaveLength(3);
				expect(result.options[0]).toEqual({ number: 1, text: 'Yes' });
				expect(result.options[1]).toEqual({ number: 2, text: 'Yes, allow all edits during this session', shortcut: 'shift+tab' });
				expect(result.options[2]).toEqual({ number: 3, text: 'No, and tell Claude what to do differently', shortcut: 'esc' });
			});
		});

		// Test for sessions list view not triggering limit detection
		describe('Usage Limit Detection Specificity', () => {
			const sessionsListFixture = `          Modified     Created        Msgs Git Branch                                 Summary
❯ 1.  5s ago       14h ago         105 dev                                        Tmux Approval Detection and Daemon Heartbeat Logging
  2.  3d ago       3d ago            2 dev                                        Scheduled Quota Window Message Timing Verification
  3.  3d ago       3d ago          298 dev                                        This session is being continued from a previo…
  4.  3d ago       3d ago            2 dev                                        🕕 This message will be sent at 9/24/2025, 5:…
  5.  3d ago       3d ago          175 dev                                        fix linting issues from bun run release:test
  6.  3d ago       3d ago          254 dev                                        it seems that bun link wont make npm deps ava…
  7.  3d ago       3d ago           66 dev                                        ccremote list    -- this command should also…
  8.  3d ago       4d ago          382 dev                                        lets make project metadata, readme and websit…
  9.  3d ago       3d ago            2 dev                                        Good morning!
  10. 4d ago       4d ago           50 dev                                        need to add an acknowledgement section near e…
  11. 4d ago       4d ago           56 dev                                        sometimes it gets stuck forever on:   $ ccrem…
  12. 4d ago       4d ago           24 dev                                        deploy the website
  13. 4d ago       6d ago          389 main                                       Bumpp Version Release Strategy for First Official Version
  14. 2w ago       2w ago          105 dev                                        install the current dev version of ccremote g…
  15. 2w ago       2w ago           69 dev                                        Debugging Session Management and Termination Processes
  16. 2w ago       2w ago            2 dev                                        hello
  17. 2w ago       2w ago          289 dev                                        This session is being continued from a previo…
  18. 2w ago       2w ago          393 dev                                        Debugging Python Web Scraper with Selenium and BeautifulSoup
  19. 2w ago       2w ago           25 dev                                        Docs Deployment: Streamlined Wrangler Production Setup
  21. 2w ago       2w ago           84 dev                                        Discord Approval Workflow Daemon Implementation
  22. 2w ago       2w ago           94 dev                                        Refactoring Reset Time Parsing in Limit Handling
  23. 2w ago       2w ago          246 dev                                        lets add the website. look into the ccusage r…
  24. 2w ago       2w ago          382 dev                                        Debugging Python Web Scraper with Selenium and BeautifulSoup
  25. 2w ago       2w ago           10 dev                                        after some while of using tmux with mouse mod…
  26. 2w ago       2w ago           61 dev                                        we have an issue with the sessions.json appro…
  27. 2w ago       2w ago           22 dev                                        it seems stock tmux in mac is tmux 3.3a, and…
  28. 2w ago       2w ago            4 dev                                        5-hour limit reached ∙ resets 1am
  29. 2w ago       2w ago            2 dev                                        5-hour limit reached ∙ resets 1am
  30. 2w ago       2w ago          164 dev                                        5-hour limit reached ∙ resets 1am
  31. 2w ago       2w ago           23 dev                                        bun run check
  32. 2w ago       2w ago          129 dev                                        CCRemote CLI: Session Flag Implementation Complete
  33. 2w ago       2w ago           56 dev                                        Claude Writes Comprehensive Project Documentation Guide
  34. 2w ago       2w ago          133 dev                                        Tmux Logging Fix: Redirecting Daemon Output Cleanly
↓ 35. 2w ago       2w ago           30 dev                                        Debugging Gunshi Command Argument Parsing Issue`;

			const realLimitMessageFixture = `5-hour limit reached ∙ resets 3:45pm

You've reached your 5-hour conversation limit. Your limit will reset at 3:45pm.

Continue this conversation later by running:
ccremote start --session-id ccremote-1

──────────────────────────────────────────────────────────────────────
>
──────────────────────────────────────────────────────────────────────`;

			const anotherRealLimitFixture = `Usage limit reached. Your limit resets at 10:30am.

You can continue this conversation when your usage limit resets.

──────────────────────────────────────────────────────────────────────
>
──────────────────────────────────────────────────────────────────────`;

			it('should NOT detect limit in sessions list view', () => {
				const hasLimit = monitor.hasLimitMessage(sessionsListFixture);
				const isActive = monitor.isActiveTerminalState(sessionsListFixture);
				expect(hasLimit && isActive).toBe(false);
			});

			it('should detect real limit messages with active terminal state', () => {
				const hasLimit = monitor.hasLimitMessage(realLimitMessageFixture);
				const isActive = monitor.isActiveTerminalState(realLimitMessageFixture);
				expect(hasLimit && isActive).toBe(true);
			});

			it('should detect another real limit message format with active terminal state', () => {
				const hasLimit = monitor.hasLimitMessage(anotherRealLimitFixture);
				const isActive = monitor.isActiveTerminalState(anotherRealLimitFixture);
				expect(hasLimit && isActive).toBe(true);
			});

			it('should detect limit message in sessions list but recognize inactive state', () => {
				const hasLimit = monitor.hasLimitMessage(sessionsListFixture);
				const isActive = monitor.isActiveTerminalState(sessionsListFixture);
				expect(hasLimit).toBe(true); // Contains limit text
				expect(isActive).toBe(false); // But not active terminal state
			});
		});
	});
}
