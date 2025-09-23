import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * Get the global logs directory path
 */
export function getGlobalLogsDir(): string {
	return join(homedir(), '.ccremote', 'logs');
}

/**
 * Get the log file path for a session
 */
export function getSessionLogPath(sessionId: string): string {
	const globalLogsDir = getGlobalLogsDir();
	const projectName = basename(process.cwd());
	return join(globalLogsDir, `${projectName}-${sessionId}.log`);
}

/**
 * Get all possible log file paths for a session (for backwards compatibility)
 */
export function getAllSessionLogPaths(sessionId: string): string[] {
	return [
		`.ccremote/session-${sessionId}.log`, // Legacy
		`.ccremote/logs/session-${sessionId}.log`, // Legacy
		getSessionLogPath(sessionId), // Current
	];
}

/**
 * Get the archive directory path
 */
export function getArchiveDir(): string {
	return join(getGlobalLogsDir(), 'archive');
}