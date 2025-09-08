#!/usr/bin/env node

/**
 * Claude Code Remote - Auto-Continuation Daemon
 * Monitors for usage limits and automatically continues sessions
 */

const { spawn, exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const scriptDir = path.dirname(__filename);
const projectDir = path.join(scriptDir, '../..');
process.chdir(projectDir);

const envPath = path.join(projectDir, '.env');
if (fs.existsSync(envPath)) {
	require('dotenv').config({ path: envPath });
}

const TelegramChannel = require('../channels/telegram/telegram');

/**
 * Capture output from tmux session
 */
function captureTmuxOutput(sessionName) {
	return new Promise((resolve, reject) => {
		const tmux = spawn('tmux', ['capture-pane', '-t', sessionName, '-p'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let output = '';
		tmux.stdout.on('data', (data) => {
			output += data.toString();
		});

		tmux.on('close', (code) => {
			if (code === 0) {
				resolve(output);
			}
			else {
				reject(new Error(`tmux capture failed with code ${code}`));
			}
		});

		tmux.on('error', reject);
	});
}

/**
 * Check if usage limit message is present and hasn't been handled yet
 */
function checkForUsageLimit(output) {
	// Debug: Show recent tmux output
	console.log(`📝 Tmux output (last 500 chars): ${output.slice(-500).replace(/\n/g, ' | ')}`);
	console.log(`🔍 Looking for limit patterns...`);

	// Check if this limit has already been addressed (look for continuation indicators)
	const alreadyContinued = /⏺ I can see you've sent|continuation|continue sent|session resumed|automatically continued/i.test(output);
	if (alreadyContinued) {
		console.log('✅ Continuation already processed, skipping detection');
		return false;
	}

	// Look for active usage limit messages
	const limitPatterns = [
		/5-hour limit reached/i,
		/usage limit/i,
		/limit reached/i,
		/hourly limit/i,
	];

	const detected = limitPatterns.some(pattern => pattern.test(output));
	console.log(`🎯 Limit detection result: ${detected ? 'FOUND LIMIT MESSAGE' : 'No limit message found'}`);

	if (detected) {
		// Show which pattern matched
		limitPatterns.forEach((pattern) => {
			const match = output.match(pattern);
			if (match) {
				console.log(`🔮 Matched pattern: "${pattern}" → "${match[0]}"`);
			}
		});
	}

	return detected;
}

/**
 * Try sending continue command and check if limit is still active
 */
async function tryContinueAndCheckResponse(sessionName) {
	return new Promise(async (resolve) => {
		console.log('🔍 Trying continue command and monitoring response...');

		// Capture initial state
		const initialOutput = await captureTmuxOutput(sessionName);

		// Send continue command
		const clearCommand = `tmux send-keys -t ${sessionName} C-u`;
		const sendCommand = `tmux send-keys -t ${sessionName} 'continue'`;
		const enterCommand = `tmux send-keys -t ${sessionName} Enter`;

		exec(clearCommand, (clearError) => {
			if (clearError) {
				resolve({ limitStillActive: false, response: 'command_failed' });
				return;
			}

			setTimeout(() => {
				exec(sendCommand, (sendError) => {
					if (sendError) {
						resolve({ limitStillActive: false, response: 'command_failed' });
						return;
					}

					setTimeout(() => {
						exec(enterCommand, async (enterError) => {
							if (enterError) {
								resolve({ limitStillActive: false, response: 'command_failed' });
								return;
							}

							// Wait for response and check
							await sleep(3000); // Wait 3 seconds for response
							const responseOutput = await captureTmuxOutput(sessionName);

							// Check if the same limit message still appears
							const stillHasLimitMessage = responseOutput.includes('5-hour limit reached')
								|| responseOutput.includes('usage limit')
								|| responseOutput.includes('limit reached');

							if (stillHasLimitMessage) {
								console.log('🚫 Continue failed - limit message still present');
								const resetTime = extractResetTime(responseOutput);
								resolve({
									limitStillActive: true,
									response: responseOutput,
									resetTime,
								});
							}
							else {
								console.log('✅ Continue successful - no limit message in response');
								resolve({
									limitStillActive: false,
									response: responseOutput,
								});
							}
						});
					}, 200);
				});
			}, 200);
		});
	});
}

/**
 * Extract reset time from limit message
 */
function extractResetTime(output) {
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
 * Handle when usage limit is reached
 */
async function handleLimitReached(sessionName, resetTime, usageStatus = {}) {
	console.log(`🕐 Usage limit reached! Reset time: ${resetTime || 'unknown'}`);

	// If usageStatus indicates we should continue immediately, do it without scheduling
	if (usageStatus.shouldContinueImmediately) {
		console.log('🚀 Continuing immediately based on usage status check...');
		await sleep(2000); // Brief pause before continuing
		runAutoContinuation(sessionName);
		return;
	}

	// Notify user via Telegram (only for scheduled continuation)
	await notifyUserOfLimit(resetTime);

	// Parse reset time and schedule continuation
	if (resetTime) {
		const resetDateTime = parseResetTime(resetTime);
		if (resetDateTime) {
			const waitMs = resetDateTime.getTime() - Date.now();

			if (waitMs > 0) {
				console.log(`⏳ Scheduling continuation in ${Math.round(waitMs / 1000 / 60)} minutes`);

				// Set scheduled reset time for monitoring loop to wait
				scheduledResetTime = resetDateTime;
				console.log(`🕐 Scheduled reset time: ${scheduledResetTime.toLocaleString()}`);
			}
			else {
				// Time already passed, continue immediately
				console.log('🎯 Reset time has passed, continuing now...');
				setTimeout(() => runAutoContinuation(sessionName), 5000);
			}
		}
		else {
			// Couldn't parse time, wait a default period
			console.log('⚠️ Could not parse reset time, waiting 5 hours...');
			setTimeout(() => runAutoContinuation(sessionName), 5 * 60 * 60 * 1000);
		}
	}
}

/**
 * Parse reset time string into Date object
 */
function parseResetTime(timeStr) {
	try {
		const now = new Date();
		timeStr = timeStr.toLowerCase().trim();

		// Match patterns like "10pm", "2:30pm", "14:00", etc.
		const timeMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
		if (!timeMatch) {
			console.error('❌ No time match found in:', timeStr);
			return null;
		}

		let [, hours, minutes, period] = timeMatch;
		hours = Number.parseInt(hours, 10);
		minutes = minutes ? Number.parseInt(minutes, 10) : 0;

		// Handle AM/PM conversion
		if (period) {
			if (period === 'pm' && hours !== 12) {
				hours += 12;
			}
			else if (period === 'am' && hours === 12) {
				hours = 0;
			}
		}
		else {
			// No period specified, assume 24-hour format
			console.log(`⏰ Assuming 24-hour format for "${timeStr}"`);
		}

		const resetTime = new Date(now);
		resetTime.setHours(hours, minutes, 0, 0);

		// If the calculated time is before now, add 24 hours (assume tomorrow)
		if (resetTime <= now) {
			resetTime.setDate(resetTime.getDate() + 1);
			console.log(`📅 Reset time passed, scheduling for tomorrow: ${resetTime.toLocaleString()}`);
		}
		else {
			console.log(`⏰ Parsed "${timeStr}" as ${resetTime.toLocaleString()}`);
		}

		// Sanity check: Claude windows are 5 hours, so reset time shouldn't be more than 5 hours from now
		const hoursToReset = (resetTime.getTime() - now.getTime()) / (1000 * 60 * 60);
		if (hoursToReset > 5) {
			console.log(`❌ Sanity check failed: Reset time ${hoursToReset.toFixed(1)} hours away exceeds 5-hour window`);
			return null;
		}

		console.log(`✅ Sanity check passed: Reset time ${hoursToReset.toFixed(1)} hours away`);
		return resetTime;
	}
	catch (error) {
		console.error('❌ Failed to parse reset time:', error, 'for input:', timeStr);
		return null;
	}
}

/**
 * Monitor for session becoming available again
 */
async function monitorForSessionReadiness(sessionName) {
	console.log('🔄 Monitoring for session readiness...');

	while (true) {
		try {
			// Check if claude is responsive
			const isReady = await checkClaudeReadiness(sessionName);
			if (isReady) {
				console.log('✅ Claude session ready for continuation!');
				await sleep(5000); // Brief pause
				runAutoContinuation(sessionName);
				break;
			}
		}
		catch (error) {
			console.error('❌ Readiness check failed:', error.message);
		}

		await sleep(30000); // Check every 30 seconds
	}
}

/**
 * Check if Claude is ready for commands
 */
function checkClaudeReadiness(sessionName) {
	return new Promise((resolve) => {
		// Send a simple test command
		const tmux = spawn('tmux', ['send-keys', '-t', sessionName, 'echo "ready_check"', 'Enter'], {
			stdio: 'inherit',
		});

		tmux.on('close', (code) => {
			resolve(code === 0);
		});

		tmux.on('error', () => resolve(false));
	});
}

/**
 * Run the auto-continuation
 */
function runAutoContinuation(sessionName) {
	console.log('🚀 Running auto-continuation...');

	// Use proper tmux command injection sequence (from tmux-injector.js pattern)
	const clearCommand = `tmux send-keys -t ${sessionName} C-u`;
	const sendCommand = `tmux send-keys -t ${sessionName} 'continue'`;
	const enterCommand = `tmux send-keys -t ${sessionName} Enter`;

	// Execute command injection in proper sequence
	exec(clearCommand, (clearError) => {
		if (clearError) {
			console.error('❌ Failed to clear input:', clearError.message);
			return;
		}

		setTimeout(() => {
			exec(sendCommand, (sendError) => {
				if (sendError) {
					console.error('❌ Failed to send continue command:', sendError.message);
					return;
				}

				setTimeout(() => {
					exec(enterCommand, async (enterError) => {
						if (enterError) {
							console.error('❌ Failed to send enter:', enterError.message);
							return;
						}

						console.log('✅ Auto-continuation command sent successfully!');

						// Update cooldown timestamp to prevent immediate re-detection
						lastContinuationTime = Date.now();

						// Notify user that continuation started
						await notifyContinuationStarted();
					});
				}, 200);
			});
		}, 200);
	});
}

/**
 * Run scheduled continuation (when reset time is reached)
 */
async function runScheduledContinuation(sessionName) {
	console.log('⏰ Executing scheduled continuation...');

	// Clear scheduled state first to prevent immediate re-detection
	scheduledResetTime = null;

	// We don't need to check the response for scheduled continuation
	// We already determined the limit would be active and scheduled for reset time
	// At reset time, we can assume the limit has reset and continue should work

	await runAutoContinuation(sessionName);

	// Set cooldown to prevent immediate re-detection of stale limit messages
	console.log('⏱️ Cooling down for 5 minutes to let tmux output update...');
	lastContinuationTime = Date.now();
}

/**
 * Notify user of usage limit
 */
async function notifyUserOfLimit(resetTime) {
	try {
		if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
			console.error('❌ Telegram not configured for limit notifications');
			return;
		}

		const telegramConfig = {
			botToken: process.env.TELEGRAM_BOT_TOKEN,
			chatId: process.env.TELEGRAM_CHAT_ID,
		};

		const telegram = new TelegramChannel(telegramConfig);

		const message = `⏰ **Claude Usage Limit Reached**

Your Claude Code session has hit the 5-hour usage limit!

⏱️ **Reset Information:**
• Reset time: ${resetTime || 'Monitoring for availability'}
• Auto-continuation: Scheduled
• You'll be notified when it resumes

💡 **What happens next:**
• This daemon will automatically continue the session
• All conversation context will be preserved
• You'll receive a notification when it resumes

🎯 **No action needed!** 😊`;

		await telegram.send({
			type: 'waiting',
			title: 'Usage Limit Reached',
			message,
			metadata: {
				eventType: 'usage_limit_reached',
				resetTime,
				timestamp: new Date().toISOString(),
			},
		});

		console.log('📤 Usage limit notification sent to Telegram');
	}
	catch (error) {
		console.error('❌ Failed to send limit notification:', error.message);
	}
}

/**
 * Notify user that continuation started
 */
async function notifyContinuationStarted() {
	try {
		if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
			return;
		}

		const telegramConfig = {
			botToken: process.env.TELEGRAM_BOT_TOKEN,
			chatId: process.env.TELEGRAM_CHAT_ID,
		};

		const telegram = new TelegramChannel(telegramConfig);

		const message = `🎉 **Auto-Continuation Started!**

Your Claude Code session has been automatically resumed after the usage limit reset!

🔄 **Resumed at:** ${new Date().toLocaleString()}
💪 **Ready to continue working!**

All previous context and conversation history has been preserved.`;

		await telegram.send({
			type: 'completed',
			title: 'Session Resumed',
			message,
			metadata: {
				eventType: 'auto_continuation_started',
				timestamp: new Date().toISOString(),
			},
		});

		console.log('📤 Continuation notification sent to Telegram');
	}
	catch (error) {
		console.error('❌ Failed to send continuation notification:', error.message);
	}
}

/**
 * Monitor tmux session for usage limit messages
 */
async function monitorSessionForLimits(sessionName = 'claude-with-hooks') {
	console.log(`🔍 Monitoring tmux session: ${sessionName} for usage limits...`);

	while (true) {
		try {
			console.log(`⏱️ [${getLogTimestamp()}] 📊 Checking tmux session for usage limits...`);

			// Capture recent tmux output
			const output = await captureTmuxOutput(sessionName);

			// Check for usage limit messages
			const limitDetected = checkForUsageLimit(output);

			// Check cooldown period to prevent continuous continuation loops
			const timeSinceLastContinuation = Date.now() - lastContinuationTime;
			if (limitDetected && timeSinceLastContinuation < CONTINUATION_COOLDOWN_MS) {
				console.log(`⏳ [${getLogTimestamp()}] In cooldown period (${Math.round((CONTINUATION_COOLDOWN_MS - timeSinceLastContinuation) / 1000)}s remaining), skipping limit detection`);
			}
			else if (limitDetected) {
				// If we already have scheduled continuation, skip trying continue again
				if (scheduledResetTime) {
					console.log(`⏱️ [${getLogTimestamp()}] 📋 Already scheduled for ${scheduledResetTime.toLocaleString()} - skipping continue check`);
				}
				else {
					console.log(`⏱️ [${getLogTimestamp()}] ⏰ Usage limit detected! Trying continue command and checking response...`);

					// Only try continue if not already scheduled
					const continueResult = await tryContinueAndCheckResponse(sessionName);

					if (continueResult.limitStillActive) {
						console.log('🚫 Continue failed - limit still active');
						const resetTime = extractResetTime(continueResult.response) || extractResetTime(output);
						if (resetTime) {
							// Parse the reset time and store it for periodic checking
							const resetDateTime = parseResetTime(resetTime);
							if (resetDateTime) {
								scheduledResetTime = resetDateTime;
								console.log(`⏰ Scheduled auto-continuation for ${scheduledResetTime.toLocaleString()}`);
								console.log(`📋 Will check every 30s if it's time to execute continuation`);
								// Notify user that continuation is scheduled (only once!)
								await notifyUserOfLimit(resetTime);
							}
						}
						else {
							console.log('⚠️ No reset time found, will continue monitoring...');
						}
					}
					else {
						console.log('✅ Continue successful - limit has reset');
						// Update cooldown to prevent immediate re-detection
						lastContinuationTime = Date.now();
					}
				}
				// Continue monitoring for future limits
			}

			// Wait intelligently based on context
			if (scheduledResetTime) {
				// When scheduled, use dynamic polling based on time to reset
				const nowMs = Date.now();
				const resetTimeMs = scheduledResetTime.getTime();
				const timeToReset = resetTimeMs - nowMs;

				if (timeToReset <= 0) {
					// Reset time has arrived or passed
					console.log(`⏱️ [${getLogTimestamp()}] ⏰ Reset time arrived! Executing scheduled continuation...`);
					scheduledResetTime = null; // Clear scheduled time
					await runScheduledContinuation(sessionName);
					continue; // Continue with normal monitoring
				}
				else if (timeToReset < 30000) {
					// Less than 30 seconds away - check frequently
					console.log(`⏰ Reset time in ${Math.round(timeToReset / 1000)}s - checking soon...`);
					await sleep(Math.min(timeToReset, 5000)); // Check in 5s or less
				}
				else {
					// More than 30 seconds - check every 30 seconds
					console.log(`⏰ Waiting for reset time ${scheduledResetTime.toLocaleString()} (${Math.round(timeToReset / 1000 / 60)}min remaining)`);
					await sleep(30000);
				}
			}
			else {
				// Normal monitoring - check every 30 seconds
				await sleep(30000);
			}
		}
		catch (error) {
			console.error('❌ Monitoring error:', error.message);
			await sleep(10000); // Wait longer on error
		}
	}
}

/**
 * Sleep utility
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get formatted timestamp for logging
 */
function getLogTimestamp() {
	return new Date().toLocaleString();
}

// Handle command line arguments
const sessionName = process.argv[2] || 'claude-with-hooks';

// Global state to prevent continuous continuation loops
let lastContinuationTime = 0;
const CONTINUATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

// Track when we scheduled continuation for later (don't check until reset time)
let scheduledResetTime = null;

console.log('🤖 Claude Code Remote - Auto-Continuation Daemon');
console.log('===========================================');
console.log(`Monitoring session: ${sessionName}`);
console.log('Press Ctrl+C to stop monitoring');
console.log('');

// Start monitoring
monitorSessionForLimits(sessionName).catch((error) => {
	console.error('❌ Daemon error:', error);
	process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
	console.log('\n👋 Auto-continuation daemon stopped');
	process.exit(0);
});
