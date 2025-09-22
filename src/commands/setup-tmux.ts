import { exec } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { cancel, confirm, intro, isCancel, outro } from '@clack/prompts';
import { consola } from 'consola';
import { define } from 'gunshi';

const execAsync = promisify(exec);

async function checkTmuxInstallation(): Promise<{ installed: boolean; version?: string }> {
	try {
		const { stdout } = await execAsync('tmux -V');
		const version = stdout.trim();
		return { installed: true, version };
	}
	catch {
		return { installed: false };
	}
}

async function checkHomebrewAvailable(): Promise<boolean> {
	try {
		await execAsync('brew --version');
		return true;
	}
	catch {
		return false;
	}
}

async function installOrUpgradeTmux(action: 'install' | 'upgrade'): Promise<boolean> {
	const hasHomebrew = await checkHomebrewAvailable();

	if (!hasHomebrew) {
		consola.warn('⚠️  Homebrew not found. Please install Homebrew first:');
		consola.info('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
		return false;
	}

	try {
		if (action === 'upgrade') {
			// Check if upgrade is available first
			consola.info('🔍 Checking for tmux updates...');
			try {
				const { stdout } = await execAsync('brew outdated tmux');
				if (!stdout.trim()) {
					consola.success('✅ Tmux is already up to date!');
					return true;
				}
			}
			catch {
				// If brew outdated fails, tmux might not be installed via brew or is up to date
				consola.success('✅ Tmux appears to be up to date!');
				return true;
			}
		}

		consola.info(`📦 ${action === 'install' ? 'Installing' : 'Upgrading'} tmux via Homebrew...`);
		const command = action === 'install' ? 'brew install tmux' : 'brew upgrade tmux';
		await execAsync(command);

		// Check new version
		const { version } = await checkTmuxInstallation();
		consola.success(`✅ Tmux ${action === 'install' ? 'installed' : 'upgraded'} successfully: ${version}`);
		return true;
	}
	catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (action === 'upgrade' && errorMessage.includes('already up-to-date')) {
			consola.success('✅ Tmux is already up to date!');
			return true;
		}
		consola.error(`Failed to ${action} tmux:`, errorMessage);
		return false;
	}
}

async function setupTmuxScrollOptimization(): Promise<void> {
	// Create ccremote-specific tmux config directory
	const ccremoteDir = `${process.env.HOME}/.ccremote`;
	const ccremoteTmuxConfig = `${ccremoteDir}/tmux.conf`;

	// Ensure .ccremote directory exists
	if (!existsSync(ccremoteDir)) {
		await execAsync(`mkdir -p ${ccremoteDir}`);
	}

	// Create ccremote-specific tmux config
	const ccremoteConfig = `# ccremote tmux configuration
# This file is used exclusively for ccremote sessions
# Your existing ~/.tmux.conf is not modified

# Enable mouse support
set -g mouse on

# Mouse scroll speed fix - override default bindings
bind -T copy-mode WheelUpPane send -N1 -X scroll-up
bind -T copy-mode WheelDownPane send -N1 -X scroll-down
bind -T copy-mode-vi WheelUpPane send -N1 -X scroll-up  
bind -T copy-mode-vi WheelDownPane send -N1 -X scroll-down

# Additional mouse-friendly settings
set -g history-limit 10000
set -g focus-events on

# Load user's existing tmux config if it exists (after our settings)
if-shell "test -f ~/.tmux.conf" "source-file ~/.tmux.conf"
`;

	writeFileSync(ccremoteTmuxConfig, ccremoteConfig);
	consola.success('✅ Created ccremote tmux config at ~/.ccremote/tmux.conf');
	consola.info('✅ Mouse scroll speed optimized (1 line per scroll instead of ~10)');
	consola.info('✅ Your existing ~/.tmux.conf settings are preserved');
}

export const setupTmuxCommand = define({
	name: 'setup-tmux',
	description: 'Setup and configure tmux for optimal use with ccremote',
	async run() {
		intro('🔧 ccremote tmux setup');

		// Show explanation
		consola.info('');
		consola.info('ccremote uses tmux to monitor and control Claude Code sessions remotely.');
		consola.info('Unfortunately, there are some tradeoffs when running Claude Code inside tmux:');
		consola.info('');
		consola.info('⚠️  Common issues:');
		consola.info('  • Mouse scrolling can be too fast');
		consola.info('  • Slightly different key bindings');
		consola.info('  • Additional layer of complexity');
		consola.info('');
		consola.info('Let\'s optimize your tmux configuration to minimize these issues.');
		consola.info('');

		// Check current tmux installation
		const tmuxStatus = await checkTmuxInstallation();

		if (tmuxStatus.installed) {
			consola.info(`✅ Tmux is installed: ${tmuxStatus.version}`);

			// Check for updates first
			const checkUpdates = await confirm({
				message: 'Check if there\'s a more recent tmux version available?',
				initialValue: true,
			});

			if (isCancel(checkUpdates)) {
				cancel('Setup cancelled.');
				return;
			}

			if (checkUpdates) {
				const success = await installOrUpgradeTmux('upgrade');
				if (!success) {
					consola.info('Continuing with current version...');
				}
			}
		}
		else {
			consola.warn('⚠️  Tmux is not installed');

			const installChoice = await confirm({
				message: 'Install tmux via Homebrew?',
				initialValue: true,
			});

			if (isCancel(installChoice) || !installChoice) {
				cancel('Setup cancelled.');
				return;
			}

			const success = await installOrUpgradeTmux('install');
			if (!success) {
				outro('Setup failed.');
				return;
			}
		}

		// Ask about scroll configuration
		consola.info('');
		const configureScrolling = await confirm({
			message: 'Create ccremote-specific tmux config for better mouse scrolling? (won\'t modify your existing tmux.conf)',
			initialValue: true,
		});

		if (isCancel(configureScrolling)) {
			cancel('Setup cancelled.');
			return;
		}

		if (configureScrolling) {
			consola.info('🎛️  Configuring tmux for better mouse scrolling...');
			await setupTmuxScrollOptimization();
		}
		else {
			consola.info('Skipping scroll optimization.');
		}

		consola.info('');
		consola.info('🚀 Next steps:');
		if (configureScrolling) {
			consola.info('1. ccremote sessions will now use the optimized config automatically');
			consola.info('2. Your existing ~/.tmux.conf remains unchanged');
			consola.info('3. Run: ccremote start (will use ~/.ccremote/tmux.conf)');
		}
		else {
			consola.info('1. Run: ccremote start (will use standard tmux)');
		}

		outro('✅ Tmux setup complete!');
	},
});
