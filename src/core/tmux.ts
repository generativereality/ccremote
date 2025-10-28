import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const TMUX_TIMEOUT = 5000; // 5 second timeout for tmux commands
const TMUX_HEALTH_CHECK_TIMEOUT = 2000; // 2 second timeout for health checks

export class TmuxTimeoutError extends Error {
	constructor(command: string, timeout: number) {
		super(`Tmux command timed out after ${timeout}ms: ${command}`);
		this.name = 'TmuxTimeoutError';
	}
}

export class TmuxManager {
	/**
	 * Execute a tmux command with timeout protection
	 */
	private async execWithTimeout(command: string, timeout: number = TMUX_TIMEOUT): Promise<{ stdout: string; stderr: string }> {
		try {
			return await Promise.race([
				execAsync(command),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new TmuxTimeoutError(command, timeout)), timeout),
				),
			]);
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				throw error;
			}
			throw error;
		}
	}

	/**
	 * Check if tmux is installed
	 */
	async isTmuxAvailable(): Promise<boolean> {
		try {
			await this.execWithTimeout('tmux -V', TMUX_HEALTH_CHECK_TIMEOUT);
			return true;
		}
		catch {
			return false;
		}
	}

	/**
	 * Check if tmux server is responsive (health check)
	 */
	async isTmuxHealthy(): Promise<{ healthy: boolean; error?: string }> {
		try {
			// Try to list sessions - this will fail fast if tmux server is hung
			await this.execWithTimeout('tmux list-sessions 2>&1', TMUX_HEALTH_CHECK_TIMEOUT);
			return { healthy: true };
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				return {
					healthy: false,
					error: 'Tmux server is unresponsive. The server may be frozen or hung.\n\n'
						+ 'To recover:\n'
						+ '  1. Kill tmux: pkill -9 tmux\n'
						+ '  2. Remove socket: rm -f /tmp/tmux-*/default\n'
						+ '  3. Try again',
				};
			}
			// If there's an error but it's not a timeout, tmux is responsive (just no sessions)
			return { healthy: true };
		}
	}

	async createSession(sessionName: string): Promise<void> {
		try {
			// Use ccremote-specific tmux config if it exists, otherwise use default with mouse mode
			const ccremoteConfig = `${process.env.HOME}/.ccremote/tmux.conf`;
			const fs = await import('node:fs');
			const hasConfig = fs.existsSync(ccremoteConfig);

			const createCommand = hasConfig
				? `tmux new-session -d -s "${sessionName}" -c "${process.cwd()}"`
				: `tmux new-session -d -s "${sessionName}" -c "${process.cwd()}" \\; set -g mouse on`;

			await this.execWithTimeout(createCommand);

			// Load ccremote config into the session if it exists
			if (hasConfig) {
				const sourceCommand = `tmux source-file "${ccremoteConfig}"`;
				await this.execWithTimeout(sourceCommand);
			}

			// Start Claude in the session
			const startClaudeCommand = `tmux send-keys -t "${sessionName}" "claude" Enter`;
			await this.execWithTimeout(startClaudeCommand);
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				// eslint-disable-next-line unicorn/prefer-type-error
				throw new Error(`Tmux server is unresponsive. Cannot create session.\n\n${error.message}`);
			}

			throw new Error(`Failed to create tmux session: ${error instanceof Error ? error.message : error}`);
		}
	}

	async capturePane(sessionName: string): Promise<string> {
		try {
			const command = `tmux capture-pane -t "${sessionName}" -p`;
			const { stdout } = await this.execWithTimeout(command);
			return stdout;
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				// eslint-disable-next-line unicorn/prefer-type-error
				throw new Error(`Tmux server is unresponsive. Cannot capture pane.\n\n${error.message}`);
			}

			throw new Error(`Failed to capture tmux pane: ${error instanceof Error ? error.message : error}`);
		}
	}

	async capturePaneWithColors(sessionName: string): Promise<string> {
		try {
			// Use -e flag to include escape sequences for text/background attributes
			const command = `tmux capture-pane -t "${sessionName}" -p -e`;
			const { stdout } = await this.execWithTimeout(command);
			return stdout;
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				// eslint-disable-next-line unicorn/prefer-type-error
				throw new Error(`Tmux server is unresponsive. Cannot capture pane.\n\n${error.message}`);
			}

			throw new Error(`Failed to capture tmux pane with colors: ${error instanceof Error ? error.message : error}`);
		}
	}

	async sendKeys(sessionName: string, keys: string): Promise<void> {
		try {
			// Send keys to tmux session
			const command = `tmux send-keys -t "${sessionName}" "${keys}" Enter`;
			await this.execWithTimeout(command);
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				// eslint-disable-next-line unicorn/prefer-type-error
				throw new Error(`Tmux server is unresponsive. Cannot send keys.\n\n${error.message}`);
			}

			throw new Error(`Failed to send keys to tmux: ${error instanceof Error ? error.message : error}`);
		}
	}

	async sendRawKeys(sessionName: string, keys: string): Promise<void> {
		try {
			// Send raw keys without Enter (for approvals like '1' or '2')
			const command = `tmux send-keys -t "${sessionName}" "${keys}"`;
			await this.execWithTimeout(command);
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				// eslint-disable-next-line unicorn/prefer-type-error
				throw new Error(`Tmux server is unresponsive. Cannot send keys.\n\n${error.message}`);
			}

			throw new Error(`Failed to send raw keys to tmux: ${error instanceof Error ? error.message : error}`);
		}
	}

	async clearInput(sessionName: string): Promise<void> {
		try {
			// Clear current input line
			const command = `tmux send-keys -t "${sessionName}" C-u`;
			await this.execWithTimeout(command);
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				// eslint-disable-next-line unicorn/prefer-type-error
				throw new Error(`Tmux server is unresponsive. Cannot clear input.\n\n${error.message}`);
			}

			throw new Error(`Failed to clear tmux input: ${error instanceof Error ? error.message : error}`);
		}
	}

	async sessionExists(sessionName: string): Promise<boolean> {
		try {
			const command = `tmux has-session -t "${sessionName}"`;
			await this.execWithTimeout(command);
			return true;
		}
		catch {
			return false;
		}
	}

	async killSession(sessionName: string): Promise<void> {
		try {
			const command = `tmux kill-session -t "${sessionName}"`;
			await this.execWithTimeout(command);
		}
		catch (error) {
			// Don't throw if session doesn't exist
			if (!error || !String(error).includes('session not found')) {
				if (error instanceof TmuxTimeoutError) {
					// eslint-disable-next-line unicorn/prefer-type-error
					throw new Error(`Tmux server is unresponsive. Cannot kill session.\n\n${error.message}`);
				}

				throw new Error(`Failed to kill tmux session: ${error instanceof Error ? error.message : error}`);
			}
		}
	}

	async listSessions(): Promise<Array<{ name: string; created: string; windows: number }>> {
		try {
			const command = 'tmux list-sessions -F "#{session_name},#{session_created},#{session_windows}"';
			const { stdout } = await this.execWithTimeout(command);
			return stdout.trim().split('\n').filter(line => line.length > 0).map((line) => {
				const [name, created, windows] = line.split(',');
				return {
					name,
					created: new Date(Number(created) * 1000).toISOString(),
					windows: Number.parseInt(windows, 10),
				};
			});
		}
		catch (error) {
			if (error instanceof TmuxTimeoutError) {
				console.warn('Tmux server is unresponsive. Cannot list sessions.');
			}
			return [];
		}
	}

	async sendContinueCommand(sessionName: string): Promise<void> {
		// Proper sequence for continuing Claude session (from working proof-of-concept)
		await this.clearInput(sessionName);
		await new Promise(resolve => setTimeout(resolve, 200)); // Brief delay

		// Send 'continue' without Enter first
		await this.sendRawKeys(sessionName, 'continue');
		await new Promise(resolve => setTimeout(resolve, 200)); // Brief delay

		// Then send Enter to execute
		await this.sendRawKeys(sessionName, 'Enter');
	}

	async sendOptionSelection(sessionName: string, optionNumber: number): Promise<void> {
		// Send the specific option number (1, 2, 3, etc.)
		const response = String(optionNumber);
		await this.sendRawKeys(sessionName, response);
	}
}
