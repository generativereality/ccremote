/**
 * Centralized Discord error handling utilities to avoid DRY violations
 */

export type DiscordRetryOptions = {
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	onRetry?: (error: Error, attempt: number) => void;
};

export type DiscordRetryResult<T> = {
	success: boolean;
	result?: T;
	error?: Error;
	attempts: number;
};

/**
 * Check if an error is retryable (network/connection issues)
 */
export function isRetryableDiscordError(error: Error): boolean {
	const message = error.message.toLowerCase();
	const isNetworkError = message.includes('opening handshake has timed out')
		|| message.includes('connection timeout')
		|| message.includes('network error')
		|| message.includes('enotfound')
		|| message.includes('econnreset')
		|| message.includes('econnrefused');

	const isRateLimit = message.includes('rate limit')
		|| message.includes('too many requests')
		|| message.includes('429');

	return isNetworkError || isRateLimit;
}

/**
 * Check if an error is permanent (invalid token, permissions, etc.)
 */
export function isPermanentDiscordError(error: Error): boolean {
	const message = error.message.toLowerCase();
	return message.includes('token')
		|| message.includes('unauthorized')
		|| message.includes('forbidden')
		|| message.includes('invalid')
		|| message.includes('missing access');
}

/**
 * Execute a Discord operation with retry logic
 */
export async function withDiscordRetry<T>(
	operation: () => Promise<T>,
	options: DiscordRetryOptions = {},
): Promise<DiscordRetryResult<T>> {
	const {
		maxRetries = 3,
		baseDelayMs = 1000,
		maxDelayMs = 30000,
		onRetry,
	} = options;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const result = await operation();
			return {
				success: true,
				result,
				attempts: attempt + 1,
			};
		}
		catch (error) {
			lastError = error as Error;

			// Don't retry permanent errors
			if (isPermanentDiscordError(lastError)) {
				return {
					success: false,
					error: lastError,
					attempts: attempt + 1,
				};
			}

			// Don't retry on the last attempt
			if (attempt === maxRetries) {
				break;
			}

			// Only retry retryable errors
			if (!isRetryableDiscordError(lastError)) {
				return {
					success: false,
					error: lastError,
					attempts: attempt + 1,
				};
			}

			// Calculate delay with exponential backoff and jitter
			const delayMs = Math.min(
				baseDelayMs * (2 ** attempt) + Math.random() * 1000,
				maxDelayMs,
			);

			onRetry?.(lastError, attempt + 1);

			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
	}

	return {
		success: false,
		error: lastError,
		attempts: maxRetries + 1,
	};
}

/**
 * Safe wrapper for Discord operations that logs errors but doesn't throw
 */
export async function safeDiscordOperation<T>(
	operation: () => Promise<T>,
	operationName: string,
	logger: { warn: (message: string) => void; debug?: (message: string) => void },
	retryOptions?: DiscordRetryOptions,
): Promise<T | undefined> {
	const result = await withDiscordRetry(operation, {
		...retryOptions,
		onRetry: (error, attempt) => {
			logger.warn?.(`${operationName} failed (attempt ${attempt}): ${error.message}. Retrying...`);
			retryOptions?.onRetry?.(error, attempt);
		},
	});

	if (result.success) {
		if (result.attempts > 1) {
			logger.debug?.(`${operationName} succeeded after ${result.attempts} attempts`);
		}
		return result.result;
	}

	logger.warn(`${operationName} failed after ${result.attempts} attempts: ${result.error?.message}`);
	return undefined;
}

if (import.meta.vitest) {
	const { describe, it, expect, vi } = import.meta.vitest;

	describe('Discord Error Handling', () => {
		describe('isRetryableDiscordError', () => {
			it('should identify handshake timeout as retryable', () => {
				const error = new Error('Opening handshake has timed out');
				expect(isRetryableDiscordError(error)).toBe(true);
			});

			it('should identify rate limit as retryable', () => {
				const error = new Error('Rate limit exceeded');
				expect(isRetryableDiscordError(error)).toBe(true);
			});

			it('should not identify token error as retryable', () => {
				const error = new Error('An invalid token was provided');
				expect(isRetryableDiscordError(error)).toBe(false);
			});
		});

		describe('isPermanentDiscordError', () => {
			it('should identify token errors as permanent', () => {
				const error = new Error('An invalid token was provided');
				expect(isPermanentDiscordError(error)).toBe(true);
			});

			it('should identify unauthorized as permanent', () => {
				const error = new Error('Unauthorized');
				expect(isPermanentDiscordError(error)).toBe(true);
			});

			it('should not identify network errors as permanent', () => {
				const error = new Error('Opening handshake has timed out');
				expect(isPermanentDiscordError(error)).toBe(false);
			});
		});

		describe('withDiscordRetry', () => {
			it('should succeed on first try', async () => {
				const operation = vi.fn().mockResolvedValue('success');
				const result = await withDiscordRetry(operation);

				expect(result.success).toBe(true);
				expect(result.result).toBe('success');
				expect(result.attempts).toBe(1);
				expect(operation).toHaveBeenCalledTimes(1);
			});

			it('should retry retryable errors', async () => {
				const operation = vi.fn()
					.mockRejectedValueOnce(new Error('Opening handshake has timed out'))
					.mockResolvedValue('success');

				const result = await withDiscordRetry(operation, { maxRetries: 2, baseDelayMs: 1 });

				expect(result.success).toBe(true);
				expect(result.result).toBe('success');
				expect(result.attempts).toBe(2);
				expect(operation).toHaveBeenCalledTimes(2);
			});

			it('should not retry permanent errors', async () => {
				const operation = vi.fn()
					.mockRejectedValue(new Error('An invalid token was provided'));

				const result = await withDiscordRetry(operation, { maxRetries: 2 });

				expect(result.success).toBe(false);
				expect(result.attempts).toBe(1);
				expect(operation).toHaveBeenCalledTimes(1);
			});

			it('should respect max retries', async () => {
				const operation = vi.fn()
					.mockRejectedValue(new Error('Opening handshake has timed out'));

				const result = await withDiscordRetry(operation, { maxRetries: 2, baseDelayMs: 1 });

				expect(result.success).toBe(false);
				expect(result.attempts).toBe(3); // initial + 2 retries
				expect(operation).toHaveBeenCalledTimes(3);
			});
		});

		describe('safeDiscordOperation', () => {
			it('should return result on success', async () => {
				const operation = vi.fn().mockResolvedValue('success');
				const logger = { warn: vi.fn(), debug: vi.fn() };

				const result = await safeDiscordOperation(operation, 'test op', logger);

				expect(result).toBe('success');
				expect(logger.warn).not.toHaveBeenCalled();
			});

			it('should return undefined on failure and log warning', async () => {
				const operation = vi.fn().mockRejectedValue(new Error('test error'));
				const logger = { warn: vi.fn(), debug: vi.fn() };

				const result = await safeDiscordOperation(operation, 'test op', logger);

				expect(result).toBe(undefined);
				expect(logger.warn).toHaveBeenCalledWith('test op failed after 1 attempts: test error');
			});

			it('should log retry attempts', async () => {
				const operation = vi.fn()
					.mockRejectedValueOnce(new Error('Opening handshake has timed out'))
					.mockResolvedValue('success');
				const logger = { warn: vi.fn(), debug: vi.fn() };

				const result = await safeDiscordOperation(
					operation,
					'test op',
					logger,
					{ maxRetries: 2, baseDelayMs: 1 },
				);

				expect(result).toBe('success');
				expect(logger.warn).toHaveBeenCalledWith('test op failed (attempt 1): Opening handshake has timed out. Retrying...');
				expect(logger.debug).toHaveBeenCalledWith('test op succeeded after 2 attempts');
			});
		});
	});
}
