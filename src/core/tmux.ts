import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class TmuxManager {
	async isTmuxAvailable(): Promise<boolean> {
		try {
			const command = 'tmux -V';
			await execAsync(command);
			return true;
		}
		catch {
			return false;
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
			
			await execAsync(createCommand);

			// Load ccremote config into the session if it exists
			if (hasConfig) {
				const sourceCommand = `tmux source-file "${ccremoteConfig}"`;
				await execAsync(sourceCommand);
			}

			// Start Claude in the session
			const startClaudeCommand = `tmux send-keys -t "${sessionName}" "claude" Enter`;
			await execAsync(startClaudeCommand);
		}
		catch (error) {
			throw new Error(`Failed to create tmux session: ${error instanceof Error ? error.message : error}`);
		}
	}

	async capturePane(sessionName: string): Promise<string> {
		try {
			const command = `tmux capture-pane -t "${sessionName}" -p`;
			const { stdout } = await execAsync(command);
			return stdout;
		}
		catch (error) {
			throw new Error(`Failed to capture tmux pane: ${error instanceof Error ? error.message : error}`);
		}
	}

	async sendKeys(sessionName: string, keys: string): Promise<void> {
		try {
			// Send keys to tmux session
			const command = `tmux send-keys -t "${sessionName}" "${keys}" Enter`;
			await execAsync(command);
		}
		catch (error) {
			throw new Error(`Failed to send keys to tmux: ${error instanceof Error ? error.message : error}`);
		}
	}

	async sendRawKeys(sessionName: string, keys: string): Promise<void> {
		try {
			// Send raw keys without Enter (for approvals like '1' or '2')
			const command = `tmux send-keys -t "${sessionName}" "${keys}"`;
			await execAsync(command);
		}
		catch (error) {
			throw new Error(`Failed to send raw keys to tmux: ${error instanceof Error ? error.message : error}`);
		}
	}

	async clearInput(sessionName: string): Promise<void> {
		try {
			// Clear current input line
			const command = `tmux send-keys -t "${sessionName}" C-u`;
			await execAsync(command);
		}
		catch (error) {
			throw new Error(`Failed to clear tmux input: ${error instanceof Error ? error.message : error}`);
		}
	}

	async sessionExists(sessionName: string): Promise<boolean> {
		try {
			const command = `tmux has-session -t "${sessionName}"`;
			await execAsync(command);
			return true;
		}
		catch {
			return false;
		}
	}

	async killSession(sessionName: string): Promise<void> {
		try {
			const command = `tmux kill-session -t "${sessionName}"`;
			await execAsync(command);
		}
		catch (error) {
			// Don't throw if session doesn't exist
			if (!error || !String(error).includes('session not found')) {
				throw new Error(`Failed to kill tmux session: ${error instanceof Error ? error.message : error}`);
			}
		}
	}

	async listSessions(): Promise<string[]> {
		try {
			const command = 'tmux list-sessions -F "#{session_name}"';
			const { stdout } = await execAsync(command);
			return stdout.trim().split('\n').filter(name => name.length > 0);
		}
		catch {
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
