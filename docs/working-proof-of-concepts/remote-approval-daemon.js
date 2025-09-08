#!/usr/bin/env node

/**
 * Claude Code Remote - Remote Approval Daemon
 * Monitors tmux for permission dialogs and handles Telegram approvals
 */

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

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
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        tmux.stdout.on('data', (data) => {
            output += data.toString();
        });

        tmux.on('close', (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(`tmux capture failed with code ${code}`));
            }
        });

        tmux.on('error', reject);
    });
}

/**
 * Check if approval dialog is currently shown (single robust method with duplicate prevention)
 */
function checkForApprovalDialog(output) {
    console.log('🔬 Checking approval dialog...');

    const lines = output.split('\n');
    let hasApprovalQuestion = false;
    let hasNumberedOptions = false;
    let hasCurrentSelection = false;
    let approvalQuestion = '';

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Check for approval questions
        if (trimmedLine.includes('Do you want to make this edit to') && trimmedLine.includes('.tsx')) {
            hasApprovalQuestion = true;
            approvalQuestion = trimmedLine;
            console.log('✅ Found approval question:', trimmedLine);
        } else if (trimmedLine.includes('Do you want to make this edit to') && trimmedLine.includes('.ts')) {
            hasApprovalQuestion = true;
            approvalQuestion = trimmedLine;
            console.log('✅ Found approval question:', trimmedLine);
        } else if (trimmedLine.includes('Do you want to proceed?')) {
            hasApprovalQuestion = true;
            approvalQuestion = trimmedLine;
            console.log('✅ Found approval question:', trimmedLine);
        }

        // Check for numbered options
        if (/\b\d+\.\s+Yes/.test(trimmedLine)) {
            hasNumberedOptions = true;
            console.log('✅ Found numbered options:', trimmedLine);
        }

        // Check for current selection arrow
        if (/❯/.test(trimmedLine)) {
            hasCurrentSelection = true;
            console.log('✅ Found current selection:', trimmedLine);
        }

        // If we found all three components, check for duplicates
        if (hasApprovalQuestion && hasNumberedOptions && hasCurrentSelection) {
            console.log('🎯 APPROVAL DIALOG CONFIRMED!');
            console.log('📋 All required components found');

            // Check if this is the same approval question we've already handled
            if (lastApprovalQuestion === approvalQuestion) {
                console.log('⏰ SKIPPING: Same approval question already handled');
                return false;
            }

            lastApprovalQuestion = approvalQuestion;
            console.log('✅ NEW APPROVAL: Tracking question');
            return true;
        }
    }

    // Debug why detection failed
    if (!hasApprovalQuestion) console.log('❌ Missing: approval question');
    if (!hasNumberedOptions) console.log('❌ Missing: numbered options');
    if (!hasCurrentSelection) console.log('❌ Missing: current selection');

    return false;
}

/**
 * Extract approval info directly from the detected approval dialog
 */
function extractApprovalInfo(output) {
    let toolInfo = {
        tool: 'Edit',
        action: 'Make edits to file',
        isPresent: true
    };

    const lines = output.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Handle Edit operations
        if (trimmedLine.includes('Do you want to make this edit to') && trimmedLine.includes('.tsx')) {
            toolInfo.tool = 'Edit';
            toolInfo.action = `Edit TypeScript React component (AuthProvider.tsx)`;
            console.log(`🛠️ Detected Edit operation:`, toolInfo.action);
            break;
        } else if (trimmedLine.includes('Do you want to make this edit to') && trimmedLine.includes('.ts')) {
            toolInfo.tool = 'Edit';
            toolInfo.action = `Edit TypeScript file (${trimmedLine.substring(trimmedLine.lastIndexOf('/') + 1, trimmedLine.indexOf('?'))})`;
            console.log(`🛠️ Detected Edit operation:`, toolInfo.action);
            break;
        } else if (trimmedLine.includes('Do you want to proceed?')) {
            toolInfo.tool = 'Tool';
            toolInfo.action = 'Proceed with operation';
            console.log(`⚙️ Detected generic operation:`, toolInfo.action);
            break;
        }
    }

    console.log(`📋 Final tool info:`, toolInfo);
    return toolInfo;
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

/**
 * Send keypress to tmux session
 */
function sendTmuxKey(sessionName, key) {
    return new Promise((resolve, reject) => {
        exec(`tmux send-keys -t ${sessionName} '${key}'`, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

/**
 * Handle approval decision by sending appropriate key to tmux
 */
async function handleApprovalDecision(sessionName, approved) {
    try {
        console.log(`🖥️ Sending ${approved ? 'YES' : 'NO'} to tmux session ${sessionName}`);
        const keyToSend = approved ? '1' : '2';
        await sendTmuxKey(sessionName, keyToSend);
        await sleep(200);
        await sendTmuxKey(sessionName, 'Enter');
        console.log(`✅ ${approved ? 'APPROVED' : 'DENIED'} - decision sent to Claude`);
    } catch (error) {
        console.error('❌ Failed to send approval decision:', error.message);
    }
}

/**
 * Handle when approval dialog is detected
 */
async function handleApprovalDialog(sessionName, toolInfo) {
    console.log(`⚠️ Approval dialog detected for ${toolInfo.tool}: ${toolInfo.action}`);
    const sessionId = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const result = await checkForApprovalsAndNotify(sessionId, sessionName, toolInfo);
    return result;
}

/**
 * Check for outstanding approvals and send notifications
 */
async function checkForApprovalsAndNotify(sessionId, sessionName, toolInfo) {
    try {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            console.error('❌ Telegram not configured for approvals - skipping notification');
            return false;
        }

        const telegramConfig = {
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId: process.env.TELEGRAM_CHAT_ID
        };

        const telegram = new TelegramChannel(telegramConfig);

        // Use the exact same message structure as auto-continuation-daemon.js
        const approvalMessage = `🤖 **Claude Remote Approval Required**

🔧 **Tool:** ${toolInfo.tool}
📝 **Action:** ${toolInfo.action}
🖥️ **Tmux Session:** ${sessionName}
🆔 **Session ID:** ${sessionId}

⚠️ **Claude is waiting for your approval to proceed**

Reply with:
• /approve - Allow this operation
• /deny - Block this operation

The operation will complete automatically when you respond.`;

        console.error('📤 Sending approval request to Telegram...');

        await telegram.send({
            type: 'approval', // Use specific type that won't be filtered out
            title: 'Remote Approval Required',
            message: approvalMessage,
            metadata: {
                toolName: toolInfo.tool,
                action: toolInfo.action,
                sessionId,
                tmuxSession: sessionName,
                approvalRequested: true,
                timestamp: new Date().toISOString()
            }
        });

        console.error('✅ Approval request sent successfully');
        await saveApprovalSession(sessionId, sessionName);
        return true;

    } catch (error) {
        console.error('❌ Failed to send approval notification:', error.message);
        return false;
    }
}

/**
 * Save approval session information
 */
async function saveApprovalSession(sessionId, sessionName) {
    try {
        const sessionsDir = path.join(__dirname, '../data/sessions');
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }

        const approvalSession = {
            id: sessionId,
            type: 'remote_approval',
            tmuxSession: sessionName,
            status: 'pending',
            createdAt: Math.floor(Date.now() / 1000),
            approved: null,
            decisionTime: null,
            decisionBy: null
        };

        const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(approvalSession, null, 2));
        console.log(`💾 Approval session saved: ${sessionId}`);

    } catch (error) {
        console.error('❌ Failed to save approval session:', error.message);
    }
}

/**
 * Monitor tmux session for approval dialogs
 */
async function monitorSessionForApprovals(sessionName) {
    console.log(`🔍 Monitoring tmux session: ${sessionName} for approval dialogs...`);

    while (true) {
        try {
            const output = await captureTmuxOutput(sessionName);
            const hasApprovalDialog = checkForApprovalDialog(output);

            // Debug: Show recent output for troubleshooting
            const recentLines = output.split('\n').slice(-10);
            console.log(`🔍 Recent tmux output (${recentLines.length} lines):`);
            recentLines.forEach((line, idx) => {
                console.log(`  ${idx}: "${line.substring(0, 80)}${line.length > 80 ? '...' : ''}"`);
            });

            if (hasApprovalDialog) {
                console.log(`⏱️ [${getLogTimestamp()}] ⚠️ Approval dialog detected!`);
                const toolInfo = extractApprovalInfo(output);

                if (toolInfo.isPresent) {
                    await handleApprovalDialog(sessionName, toolInfo);
                } else {
                    console.log('❌ Tool info extraction failed');
                }
            }

        } catch (error) {
            console.error(`❌ Monitoring error for session ${sessionName}:`, error.message);
        }

        await sleep(3000);
    }
}

// Handle command line arguments
const sessionName = process.argv[2] || 'claude';

// Global state to track the most recent approval question
let lastApprovalQuestion = null;

console.log('🤖 Claude Code Remote - Remote Approval Daemon');
console.log('===========================================');
console.log(`Monitoring session: ${sessionName}`);
console.log(`Will detect approval dialogs and send Telegram notifications`);
console.log('Press Ctrl+C to stop monitoring');
console.log('');

monitorSessionForApprovals(sessionName).catch(error => {
    console.error('❌ Daemon error:', error);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n👋 Remote approval daemon stopped');
    process.exit(0);
});

module.exports = {
    monitorSessionForApprovals,
    handleApprovalDecision,
    checkForApprovalDialog
};
