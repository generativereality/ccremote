import { consola } from 'consola'
import { define } from 'gunshi'
import { SessionManager } from '../core/session.js'
import { TmuxManager } from '../core/tmux.js'

export const statusCommand = define({
	name: 'status',
	description: 'Show detailed status of CCRemote session',
	args: {
		session: {
			type: 'positional',
			description: 'Session ID or name to show status for',
			required: true,
		},
	},
	async run({ args }) {
	try {
		const sessionManager = new SessionManager()
		const tmuxManager = new TmuxManager()

		await sessionManager.initialize()

		// Find session by ID or name
		let session = await sessionManager.getSession(args.session)
		if (!session) {
			session = await sessionManager.getSessionByName(args.session)
		}

		if (!session) {
			consola.error(`Session not found: ${args.session}`)
			consola.error('Use "ccremote list" to see available sessions')
			process.exit(1)
		}

		// Check tmux status
		const tmuxActive = await tmuxManager.sessionExists(session.tmuxSession)

		// Get recent tmux output if session is active
		let recentOutput = ''
		if (tmuxActive) {
			try {
				const output = await tmuxManager.capturePane(session.tmuxSession)
				// Get last 10 lines
				recentOutput = output.split('\n').slice(-10).join('\n').trim()
			} catch (error) {
				recentOutput = `Error capturing output: ${error instanceof Error ? error.message : error}`
			}
		}

		// Display status
		consola.info(`Session Status: ${session.name}`)
		consola.info('')
		consola.info('Basic Information:')
		consola.info(`  ID: ${session.id}`)
		consola.info(`  Name: ${session.name}`)
		consola.info(`  Status: ${session.status} ${session.status === 'active' ? '✅' : session.status === 'waiting' ? '⏳' : '❌'}`)
		consola.info(`  Created: ${new Date(session.created).toLocaleString()}`)
		consola.info(`  Last Activity: ${new Date(session.lastActivity).toLocaleString()}`)
		consola.info('')

		consola.info('Tmux Integration:')
		consola.info(`  Session: ${session.tmuxSession}`)
		consola.info(`  Active: ${tmuxActive ? '✅ Running' : '❌ Not running'}`)
		consola.info('')

		consola.info('Discord Integration:')
		consola.info(`  Channel: ${session.channelId || 'Not assigned'}`)
		consola.info('')

		if (tmuxActive && recentOutput) {
			consola.info('Recent Output (last 10 lines):')
			consola.info('```')
			consola.info(recentOutput)
			consola.info('```')
			consola.info('')
		}

		// Show commands
		consola.info('Available Commands:')
		if (tmuxActive) {
			consola.info(`  Attach to session: tmux attach -t ${session.tmuxSession}`)
			consola.info(`  Stop session: ccremote stop ${session.id}`)
		} else {
			consola.info(`  Clean up session: ccremote stop ${session.id}`)
			consola.info('  (Tmux session is not running)')
		}
	} catch (error) {
		consola.error('Failed to get session status:', error instanceof Error ? error.message : error)
		process.exit(1)
	}
	},
})