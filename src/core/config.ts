import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

export type CCRemoteConfig = {
	discordBotToken: string;
	discordOwnerId: string;
	discordAuthorizedUsers: string[];
	monitoringInterval: number;
	maxRetries: number;
	autoRestart: boolean;
};

/**
 * Load configuration from environment variables and .env files
 *
 * Priority (highest to lowest):
 * 1. Environment variables (CCREMOTE_*)
 * 2. Project .env file (./ccremote.env)
 * 3. Project .env file (./.env)
 * 4. Global .env file (~/.ccremote.env)
 * 5. Default values
 */
export function loadConfig(): CCRemoteConfig {
	// Load environment files in priority order
	loadEnvFiles();

	// Get configuration values with CCREMOTE_ prefix
	const discordBotToken = getEnvVar('CCREMOTE_DISCORD_BOT_TOKEN');
	const discordOwnerId = getEnvVar('CCREMOTE_DISCORD_OWNER_ID');
	const discordAuthorizedUsers = parseAuthorizedUsers(
		getEnvVar('CCREMOTE_DISCORD_AUTHORIZED_USERS') || '',
	);

	// Monitoring configuration
	const monitoringInterval = Number.parseInt(getEnvVar('CCREMOTE_MONITORING_INTERVAL') || '2000', 10);
	const maxRetries = Number.parseInt(getEnvVar('CCREMOTE_MAX_RETRIES') || '3', 10);
	const autoRestart = getEnvVar('CCREMOTE_AUTO_RESTART') !== 'false';

	// Validate required fields
	if (!discordBotToken) {
		throw new Error('Missing required environment variable: CCREMOTE_DISCORD_BOT_TOKEN');
	}
	if (!discordOwnerId) {
		throw new Error('Missing required environment variable: CCREMOTE_DISCORD_OWNER_ID');
	}

	return {
		discordBotToken,
		discordOwnerId,
		discordAuthorizedUsers,
		monitoringInterval,
		maxRetries,
		autoRestart,
	};
}

function loadEnvFiles(): void {
	// Skip loading env files during testing if requested
	if (process.env.NODE_ENV === 'test' && process.env.SKIP_ENV_FILES) {
		return;
	}

	// Priority order for .env files
	const envFiles = [
		resolve(process.cwd(), 'ccremote.env'), // Project-specific ccremote.env
		resolve(process.cwd(), '.env'), // Project .env
		resolve(process.env.HOME || '~', '.ccremote.env'), // Global ~/.ccremote.env
	];

	// Load each env file if it exists (reverse order so higher priority overwrites)
	for (let i = envFiles.length - 1; i >= 0; i--) {
		const envFile = envFiles[i];
		if (existsSync(envFile)) {
			config({ path: envFile, override: false });
			console.info(`Loaded environment from: ${envFile}`);
		}
	}
}

function getEnvVar(key: string): string | undefined {
	return process.env[key];
}

function parseAuthorizedUsers(value: string): string[] {
	if (!value.trim()) {
		return [];
	}
	return value.split(',').map(id => id.trim()).filter(id => id.length > 0);
}

/**
 * Validate that the current configuration is valid
 */
export function validateConfig(cfg: CCRemoteConfig): void {
	if (!cfg.discordBotToken) {
		throw new Error('Discord bot token is required');
	}
	if (!cfg.discordOwnerId) {
		throw new Error('Discord owner ID is required');
	}
	if (cfg.monitoringInterval < 1000) {
		console.warn('Warning: Monitoring interval less than 1000ms may cause performance issues');
	}
}

/**
 * Create example configuration files
 */
export function createExampleEnv(): string {
	return `# ccremote Configuration
# Copy this to ccremote.env or .env and fill in your values

# Required: Discord Bot Configuration
CCREMOTE_DISCORD_BOT_TOKEN=your_discord_bot_token_here
CCREMOTE_DISCORD_OWNER_ID=your_discord_user_id_here

# Optional: Additional authorized users (comma-separated Discord user IDs)
CCREMOTE_DISCORD_AUTHORIZED_USERS=user_id_1,user_id_2

# Optional: Monitoring Configuration
CCREMOTE_MONITORING_INTERVAL=2000    # Polling interval in milliseconds (default: 2000)
CCREMOTE_MAX_RETRIES=3               # Max retry attempts on error (default: 3)
CCREMOTE_AUTO_RESTART=true           # Auto-restart monitoring on failure (default: true)
`;
}

if (import.meta.vitest) {
	const vitest = await import('vitest');
	const { beforeEach, describe, it, expect, vi } = vitest;

	describe('loadConfig', () => {
		beforeEach(() => {
			// Clear environment
			vi.resetModules();

			// Clear all CCREMOTE environment variables
			for (const key in process.env) {
				if (key.startsWith('CCREMOTE_')) {
					delete process.env[key];
				}
			}

			// Skip env file loading during tests
			process.env.NODE_ENV = 'test';
			process.env.SKIP_ENV_FILES = 'true';
		});

		it('should load configuration from CCREMOTE_ prefixed environment variables', () => {
			process.env.CCREMOTE_DISCORD_BOT_TOKEN = 'test_token';
			process.env.CCREMOTE_DISCORD_OWNER_ID = 'test_owner';

			const config = loadConfig();

			expect(config.discordBotToken).toBe('test_token');
			expect(config.discordOwnerId).toBe('test_owner');
		});

		it('should NOT fall back to non-prefixed environment variables', () => {
			process.env.DISCORD_BOT_TOKEN = 'should_not_use';
			process.env.DISCORD_OWNER_ID = 'should_not_use';

			expect(() => loadConfig()).toThrow('Missing required environment variable: CCREMOTE_DISCORD_BOT_TOKEN');
		});

		it('should parse authorized users correctly', () => {
			process.env.CCREMOTE_DISCORD_BOT_TOKEN = 'test_token';
			process.env.CCREMOTE_DISCORD_OWNER_ID = 'test_owner';
			process.env.CCREMOTE_DISCORD_AUTHORIZED_USERS = 'user1,user2, user3 ';

			const config = loadConfig();

			expect(config.discordAuthorizedUsers).toEqual(['user1', 'user2', 'user3']);
		});

		it('should throw error for missing required variables', () => {
			expect(() => loadConfig()).toThrow('Missing required environment variable: CCREMOTE_DISCORD_BOT_TOKEN');
		});
	});
}
