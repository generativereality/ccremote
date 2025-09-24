/**
 * Utility functions for quota scheduling
 */

/**
 * Generate the quota message for a given execution time
 */
export function generateQuotaMessage(executeAt: Date): string {
	return `🕕 This message will be sent at ${executeAt.toLocaleString()} to ensure the quota window starts at that time.`;
}