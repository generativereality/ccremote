import type { DiscordBot } from './discord.js';
import type { SessionManager } from './session.js';
import type { TmuxManager } from './tmux.js';
import { EventEmitter } from 'node:events';

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
	}>();

	// Pattern matching for Claude Code messages
	private readonly patterns = {
		// Usage limit patterns
		usageLimit: /(?:usage limit|rate limit|quota.*reached|limit.*exceeded)/i,
		// Continuation ready patterns
		continuationReady: /(?:continue|resume|ready.*continue)/i,
		// Error patterns that might need approval
		errorPatterns: /(?:error|failed|exception|cannot.*proceed)/i,
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
		});

		// Start polling
		const interval = setInterval(() => {
			void this.pollSession(sessionId);
		}, this.options.pollInterval);

		this.monitoringIntervals.set(sessionId, interval);
		console.info(`Started monitoring session: ${sessionId}`);
	}

	async stopMonitoring(sessionId: string): Promise<void> {
		const interval = this.monitoringIntervals.get(sessionId);
		if (interval) {
			clearInterval(interval);
			this.monitoringIntervals.delete(sessionId);
		}
		this.sessionStates.delete(sessionId);
		console.info(`Stopped monitoring session: ${sessionId}`);
	}

	private async pollSession(sessionId: string): Promise<void> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				console.warn(`Session ${sessionId} not found, stopping monitoring`);
				await this.stopMonitoring(sessionId);
				return;
			}

			// Check if tmux session still exists
			const tmuxExists = await this.tmuxManager.sessionExists(session.tmuxSession);
			if (!tmuxExists) {
				console.info(`Tmux session ${session.tmuxSession} no longer exists`);
				await this.handleSessionEnded(sessionId);
				return;
			}

			// Get current output
			const currentOutput = await this.tmuxManager.capturePane(session.tmuxSession);
			await this.analyzeOutput(sessionId, currentOutput);
		}
		catch (error) {
			console.error(`Error polling session ${sessionId}:`, error);
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

		// Check for usage limit
		if (this.patterns.usageLimit.test(output) && !sessionState.awaitingContinuation) {
			console.info(`Usage limit detected for session ${sessionId}`);
			sessionState.limitDetectedAt = new Date();
			sessionState.awaitingContinuation = true;

			await this.handleLimitDetected(sessionId, output);
		}

		// Check for continuation readiness (after limit was detected)
		if (sessionState.awaitingContinuation && this.patterns.continuationReady.test(output)) {
			console.info(`Continuation ready detected for session ${sessionId}`);
			await this.handleContinuationReady(sessionId, output);
		}

		// Check for errors that might need approval
		if (this.patterns.errorPatterns.test(output)) {
			console.info(`Potential error detected for session ${sessionId}`);
			await this.handlePotentialError(sessionId, output);
		}
	}

	private async handleLimitDetected(sessionId: string, output: string): Promise<void> {
		const event: MonitorEvent = {
			type: 'limit_detected',
			sessionId,
			data: { output },
			timestamp: new Date(),
		};

		this.emit('limit_detected', event);

		// Send Discord notification
		await this.discordBot.sendNotification(sessionId, {
			type: 'limit',
			sessionName: (await this.sessionManager.getSession(sessionId))?.name || sessionId,
			message: 'Usage limit reached. Will automatically continue when limit resets.',
			metadata: {
				resetTime: this.calculateResetTime(),
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

		// Reset state
		sessionState.awaitingContinuation = false;
		sessionState.retryCount = 0;

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

	private async handlePotentialError(sessionId: string, output: string): Promise<void> {
		// For now, just log. In the future, this could trigger approval requests
		console.warn(`Potential error in session ${sessionId}: ${output.slice(-100)}`);

		const event: MonitorEvent = {
			type: 'approval_needed',
			sessionId,
			data: { output, reason: 'error_detected' },
			timestamp: new Date(),
		};

		this.emit('approval_needed', event);
	}

	private async handleSessionEnded(sessionId: string): Promise<void> {
		await this.stopMonitoring(sessionId);
		await this.sessionManager.updateSession(sessionId, { status: 'ended' });

		// Notify Discord
		await this.discordBot.sendNotification(sessionId, {
			type: 'error',
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
			console.error(`Max retries exceeded for session ${sessionId}, stopping monitoring`);
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
			console.warn(`Polling error for session ${sessionId}, retry ${sessionState.retryCount}/${this.options.maxRetries}`);
		}
	}

	private async performAutoContinuation(sessionId: string): Promise<void> {
		try {
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) {
				return;
			}

			console.info(`Performing auto-continuation for session ${sessionId}`);

			// Use the proper continuation command
			await this.tmuxManager.sendContinueCommand(session.tmuxSession);

			// Update session status
			await this.sessionManager.updateSession(sessionId, { status: 'active' });

			// Send notification
			await this.discordBot.sendNotification(sessionId, {
				type: 'continued',
				sessionName: session.name,
				message: 'Session automatically continued after limit reset.',
			});

			console.info(`Auto-continuation completed for session ${sessionId}`);
		}
		catch (error) {
			console.error(`Auto-continuation failed for session ${sessionId}:`, error);
		}
	}

	private calculateResetTime(): string {
		// Claude Code limits typically reset every 5 hours
		// This is a rough estimation - in practice you'd want more sophisticated logic
		const now = new Date();
		const nextReset = new Date(now);
		nextReset.setHours(nextReset.getHours() + 5);
		return nextReset.toLocaleString();
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
			const testOutput = 'Error: Usage limit reached. Please try again later.';
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
	});
}
