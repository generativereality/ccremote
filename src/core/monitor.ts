import type { DiscordBot } from './discord.js';
import type { SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

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
	}>();

	// Pattern matching for Claude Code messages
	private readonly patterns = {
		// Usage limit patterns - enhanced from proof-of-concept
		usageLimit: /(?:5-hour limit reached.*resets|usage limit.*resets|rate limit.*exceeded|quota.*reached|limit.*exceeded)/i,
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
		});

		// Start polling
		const interval = setInterval(() => {
			void this.pollSession(sessionId);
		}, this.options.pollInterval);

		this.monitoringIntervals.set(sessionId, interval);
		await logger.info(`Started monitoring session: ${sessionId}`);
	}

	async stopMonitoring(sessionId: string): Promise<void> {
		const interval = this.monitoringIntervals.get(sessionId);
		if (interval) {
			clearInterval(interval);
			this.monitoringIntervals.delete(sessionId);
		}
		this.sessionStates.delete(sessionId);
		await logger.info(`Stopped monitoring session: ${sessionId}`);
	}

	private async pollSession(sessionId: string): Promise<void> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				await logger.warn(`Session ${sessionId} not found, stopping monitoring`);
				await this.stopMonitoring(sessionId);
				return;
			}

			// Check if tmux session still exists
			const tmuxExists = await this.tmuxManager.sessionExists(session.tmuxSession);
			if (!tmuxExists) {
				await logger.info(`Tmux session ${session.tmuxSession} no longer exists`);
				await this.handleSessionEnded(sessionId);
				return;
			}

			// Check for scheduled continuation first
			const sessionState = this.sessionStates.get(sessionId);
			if (sessionState?.scheduledResetTime) {
				const now = new Date();
				if (now >= sessionState.scheduledResetTime) {
					await logger.info(`Scheduled reset time arrived, executing continuation for session ${sessionId}`);
					sessionState.scheduledResetTime = undefined;
					await this.performAutoContinuation(sessionId);
					return; // Continue normal monitoring on next poll
				}
			}

			// Get current output
			const currentOutput = await this.tmuxManager.capturePane(session.tmuxSession);
			await this.analyzeOutput(sessionId, currentOutput);
		}
		catch (error) {
			await logger.error(`Error polling session ${sessionId}: ${error}`);
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

	private getNewOutput(lastOutput: string, currentOutput: string): string {
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

		// Check for usage limit with cooldown protection
		if (this.patterns.usageLimit.test(output) && !sessionState.awaitingContinuation) {
			// Check cooldown period to prevent continuous continuation loops (5 minutes)
			const CONTINUATION_COOLDOWN_MS = 5 * 60 * 1000;
			const timeSinceLastContinuation = sessionState.lastContinuationTime
				? Date.now() - sessionState.lastContinuationTime.getTime()
				: CONTINUATION_COOLDOWN_MS + 1; // Allow if never continued

			if (timeSinceLastContinuation < CONTINUATION_COOLDOWN_MS) {
				const remainingCooldown = Math.round((CONTINUATION_COOLDOWN_MS - timeSinceLastContinuation) / 1000);
				await logger.info(`Usage limit detected but in cooldown period (${remainingCooldown}s remaining), skipping`);
				return;
			}

			await logger.info(`Usage limit detected for session ${sessionId}`);
			sessionState.limitDetectedAt = new Date();
			sessionState.awaitingContinuation = true;

			await this.handleLimitDetected(sessionId, output);
		}

		// Check for continuation readiness (after limit was detected)
		if (sessionState.awaitingContinuation && this.patterns.continuationReady.test(output)) {
			await logger.info(`Continuation ready detected for session ${sessionId}`);
			await this.handleContinuationReady(sessionId, output);
		}

		// Check for Claude Code approval dialogs
		if (this.detectApprovalDialog(output)) {
			await logger.info(`Approval dialog detected for session ${sessionId}`);
			await this.handleApprovalRequest(sessionId, output);
		}
	}

	private async handleLimitDetected(sessionId: string, output: string): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		// Check if already scheduled to prevent duplicate notifications
		if (sessionState.scheduledResetTime) {
			await logger.info(`Already scheduled continuation for ${sessionState.scheduledResetTime.toLocaleString()}, skipping duplicate detection`);
			return;
		}

		const event: MonitorEvent = {
			type: 'limit_detected',
			sessionId,
			data: { output },
			timestamp: new Date(),
		};

		this.emit('limit_detected', event);

		// Try to continue immediately first (similar to POC logic)
		const continueResult = await this.tryImmediateContinuation(sessionId, output);

		if (continueResult.success) {
			// Continuation succeeded immediately - limit has already reset
			await logger.info(`Immediate continuation successful for session ${sessionId}`);
			sessionState.lastContinuationTime = new Date();
			sessionState.awaitingContinuation = false;

			// Send success notification
			await this.discordBot.sendNotification(sessionId, {
				type: 'continued',
				sessionId,
				sessionName: (await this.sessionManager.getSession(sessionId))?.name || sessionId,
				message: 'Session automatically continued after limit reset.',
			});

			await this.sessionManager.updateSession(sessionId, { status: 'active' });
		}
		else {
			// Continuation failed - schedule for later
			const resetTime = this.extractResetTime(continueResult.response || output);
			if (resetTime) {
				const resetDateTime = await this.parseResetTime(resetTime);
				if (resetDateTime) {
					sessionState.scheduledResetTime = resetDateTime;
					await logger.info(`Scheduled continuation for ${resetDateTime.toLocaleString()}`);
				}
			}

			// Send Discord notification (only once)
			await this.discordBot.sendNotification(sessionId, {
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
	 * Detect Claude Code approval dialogs using proven patterns from proof-of-concept
	 * Requires all three components: question, numbered options, and current selection
	 */
	private detectApprovalDialog(output: string): boolean {
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
	 * Extract approval information from the detected dialog
	 */
	private extractApprovalInfo(output: string): { tool: string; action: string; question: string } {
		const lines = output.split('\n');
		let question = '';
		let tool = 'Unknown';
		let action = 'Unknown operation';

		for (const line of lines) {
			// Clean line of box drawing characters and extra whitespace
			const cleanLine = line.replace(/[│┃┆┊╎╏║╭╮╯╰┌┐└┘├┤┬┴┼─━┄┅┈┉═╔╗╚╝╠╣╦╩╬]/g, '').replace(/\s+/g, ' ').trim();

			// Extract the specific question
			if (this.patterns.approvalDialog.question.test(cleanLine)) {
				question = cleanLine;

				// Determine tool and action based on question content
				if (cleanLine.includes('make this edit to') && cleanLine.includes('.ts')) {
					tool = 'Edit';
					const filename = cleanLine.match(/([^/\\\s]+\.tsx?)\?/)?.[1] || 'file';
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
				break;
			}
		}

		return { tool, action, question };
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
			await logger.info('Skipping duplicate approval request');
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

		// Send Discord notification
		await this.discordBot.sendNotification(sessionId, {
			type: 'approval',
			sessionId,
			sessionName: (await this.sessionManager.getSession(sessionId))?.name || sessionId,
			message: `🔐 Approval Required\n\n**Tool:** ${approvalInfo.tool}\n**Action:** ${approvalInfo.action}\n**Question:** ${approvalInfo.question}\n\nReply with 'approve' or 'deny'`,
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
		await this.sessionManager.updateSession(sessionId, { status: 'ended' });

		// Notify Discord
		await this.discordBot.sendNotification(sessionId, {
			type: 'error',
			sessionId,
			sessionName: (await this.sessionManager.getSession(sessionId))?.name || sessionId,
			message: 'Session ended - tmux session no longer exists.',
		});
	}

	private async handlePollingError(sessionId: string, error: unknown): Promise<void> {
		const sessionState = this.sessionStates.get(sessionId);
		if (!sessionState) {
			return;
		}

		sessionState.retryCount++;

		if (sessionState.retryCount >= this.options.maxRetries) {
			await logger.error(`Max retries exceeded for session ${sessionId}, stopping monitoring`);
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
			await logger.warn(`Polling error for session ${sessionId}, retry ${sessionState.retryCount}/${this.options.maxRetries}`);
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

			await logger.info(`Performing auto-continuation for session ${sessionId}`);

			// Use the proper continuation command
			await this.tmuxManager.sendContinueCommand(session.tmuxSession);

			// Update state
			sessionState.lastContinuationTime = new Date();
			sessionState.awaitingContinuation = false;
			sessionState.scheduledResetTime = undefined;

			// Update session status
			await this.sessionManager.updateSession(sessionId, { status: 'active' });

			// Send notification
			await this.discordBot.sendNotification(sessionId, {
				type: 'continued',
				sessionId,
				sessionName: session.name,
				message: 'Session automatically continued after limit reset.',
			});

			await logger.info(`Auto-continuation completed for session ${sessionId}`);
		}
		catch (error) {
			await logger.error(`Auto-continuation failed for session ${sessionId}: ${error}`);
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

			await logger.info(`Trying immediate continuation for session ${sessionId}`);

			// Send continue command
			await this.tmuxManager.sendContinueCommand(session.tmuxSession);

			// Wait for response
			await new Promise(resolve => setTimeout(resolve, 3000));
			const responseOutput = await this.tmuxManager.capturePane(session.tmuxSession);

			// Check if the same limit message still appears
			const stillHasLimitMessage = this.patterns.usageLimit.test(responseOutput);

			if (stillHasLimitMessage) {
				await logger.info('Immediate continuation failed - limit message still present');
				return { success: false, response: responseOutput };
			}
			else {
				await logger.info('Immediate continuation successful - no limit message in response');
				return { success: true, response: responseOutput };
			}
		}
		catch (error) {
			await logger.error(`Immediate continuation attempt failed: ${error}`);
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
				await logger.warn(`No time match found in: ${timeStr}`);
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
				await logger.info(`Reset time passed, scheduling for tomorrow: ${resetTime.toLocaleString()}`);
			}

			// Sanity check: Claude windows are 5 hours, so reset time shouldn't be more than 5 hours from now
			const hoursToReset = (resetTime.getTime() - now.getTime()) / (1000 * 60 * 60);
			if (hoursToReset > 5) {
				await logger.warn(`Sanity check failed: Reset time ${hoursToReset.toFixed(1)} hours away exceeds 5-hour window`);
				return null;
			}

			await logger.info(`Parsed "${timeStr}" as ${resetTime.toLocaleString()}`);
			return resetTime;
		}
		catch (error) {
			await logger.error(`Failed to parse reset time: ${error} for input: ${timeStr}`);
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
			const patterns = (monitor as any).patterns as { usageLimit: RegExp };
			expect(patterns.usageLimit.test(testOutput)).toBe(true);
		});

		it('should detect continuation ready patterns', () => {
			const testOutput = 'Ready to continue...';
			const patterns = (monitor as any).patterns as { continuationReady: RegExp };
			expect(patterns.continuationReady.test(testOutput)).toBe(true);
		});

		it('should calculate new output correctly', () => {
			const lastOutput = 'Hello world';
			const currentOutput = 'Hello world\nNew line here';
			const newOutput = (monitor as any).getNewOutput(lastOutput, currentOutput) as string;
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

			const noApprovalFixture = `Regular tmux output without approval dialog
Some command output
More text here`;

			it('should detect file edit approval dialog', () => {
				const result = (monitor as any).detectApprovalDialog(tmuxEditFixture);
				expect(result).toBe(true);
			});

			it('should detect proceed approval dialog', () => {
				const result = (monitor as any).detectApprovalDialog(tmuxProceedFixture);
				expect(result).toBe(true);
			});

			it('should detect bash command approval dialog', () => {
				const result = (monitor as any).detectApprovalDialog(tmuxBashFixture);
				expect(result).toBe(true);
			});

			it('should detect file creation approval dialog', () => {
				const result = (monitor as any).detectApprovalDialog(tmuxCreateFileFixture);
				expect(result).toBe(true);
			});

			it('should not detect non-approval output', () => {
				const result = (monitor as any).detectApprovalDialog(noApprovalFixture);
				expect(result).toBe(false);
			});

			it('should extract approval info from file edit dialog', () => {
				const result = (monitor as any).extractApprovalInfo(tmuxEditFixture);
				expect(result.tool).toBe('Edit');
				expect(result.action).toBe('Edit tmux.ts');
				expect(result.question).toBe('Do you want to make this edit to tmux.ts?');
			});

			it('should extract approval info from proceed dialog', () => {
				const result = (monitor as any).extractApprovalInfo(tmuxProceedFixture);
				expect(result.tool).toBe('Tool');
				expect(result.action).toBe('Proceed with operation');
				expect(result.question).toBe('Do you want to proceed?');
			});

			it('should extract approval info from bash command dialog', () => {
				const result = (monitor as any).extractApprovalInfo(tmuxBashFixture);
				expect(result.tool).toBe('Bash');
				expect(result.action).toBe('Execute: vitest run src/core/monitor.ts');
				expect(result.question).toBe('Do you want to proceed?');
			});

			it('should extract approval info from file creation dialog', () => {
				const result = (monitor as any).extractApprovalInfo(tmuxCreateFileFixture);
				expect(result.tool).toBe('Write');
				expect(result.action).toBe('Create debug-stop.js');
				expect(result.question).toBe('Do you want to create debug-stop.js?');
			});
		});
	});
}
