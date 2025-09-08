import { CLICommand } from '../lib/cli-framework.js'
import { SessionManager } from '../core/session.js'
import { TmuxManager } from '../core/tmux.js'

const command: CLICommand = {
  description: 'Show detailed status of CCRemote session',
  options: {
    session: {
      type: 'string',
      description: 'Session ID or name to show status for',
      required: true
    }
  },
  
  async handler(options) {
    try {
      const sessionManager = new SessionManager()
      const tmuxManager = new TmuxManager()
      
      await sessionManager.initialize()
      
      // Find session by ID or name
      let session = await sessionManager.getSession(options.session)
      if (!session) {
        session = await sessionManager.getSessionByName(options.session)
      }
      
      if (!session) {
        console.error(`❌ Session not found: ${options.session}`)
        console.error('Use "ccremote list" to see available sessions')
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
      console.log(`📊 Session Status: ${session.name}`)
      console.log('')
      console.log('Basic Information:')
      console.log(`  ID: ${session.id}`)
      console.log(`  Name: ${session.name}`)
      console.log(`  Status: ${session.status} ${session.status === 'active' ? '✅' : session.status === 'waiting' ? '⏳' : '❌'}`)
      console.log(`  Created: ${new Date(session.created).toLocaleString()}`)
      console.log(`  Last Activity: ${new Date(session.lastActivity).toLocaleString()}`)
      console.log('')
      
      console.log('Tmux Integration:')
      console.log(`  Session: ${session.tmuxSession}`)
      console.log(`  Active: ${tmuxActive ? '✅ Running' : '❌ Not running'}`)
      console.log('')
      
      console.log('Discord Integration:')
      console.log(`  Channel: ${session.channelId || 'Not assigned'}`)
      console.log('')

      if (tmuxActive && recentOutput) {
        console.log('Recent Output (last 10 lines):')
        console.log('```')
        console.log(recentOutput)
        console.log('```')
        console.log('')
      }

      // Show commands
      console.log('Available Commands:')
      if (tmuxActive) {
        console.log(`  Attach to session: tmux attach -t ${session.tmuxSession}`)
        console.log(`  Stop session: ccremote stop ${session.id}`)
      } else {
        console.log(`  Clean up session: ccremote stop ${session.id}`)
        console.log('  (Tmux session is not running)')
      }

    } catch (error) {
      console.error('❌ Failed to get session status:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
}

export default command