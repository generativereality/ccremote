import { CLICommand } from '../lib/cli-framework.js'
import { SessionManager } from '../core/session.js'
import { TmuxManager } from '../core/tmux.js'

const command: CLICommand = {
  description: 'Stop CCRemote session',
  options: {
    session: {
      type: 'string',
      description: 'Session ID or name to stop',
      required: true
    },
    force: {
      type: 'boolean',
      description: 'Force stop even if tmux session is still active'
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

      console.log(`🛑 Stopping session: ${session.name} (${session.id})`)

      // Check if tmux session is still running
      const tmuxActive = await tmuxManager.sessionExists(session.tmuxSession)
      
      if (tmuxActive) {
        if (!options.force) {
          console.log('⚠️  Tmux session is still active')
          console.log('   This will kill the tmux session and any running Claude Code instance')
          console.log('   Use --force to proceed or stop the session manually first')
          process.exit(1)
        }

        console.log('🔪 Killing tmux session...')
        await tmuxManager.killSession(session.tmuxSession)
      }

      // Remove session from storage
      await sessionManager.deleteSession(session.id)

      console.log('✅ Session stopped successfully!')
      console.log('')
      console.log('Session cleaned up:')
      console.log(`  Name: ${session.name}`)
      console.log(`  ID: ${session.id}`)
      console.log(`  Tmux session: ${session.tmuxSession} ${tmuxActive ? '(killed)' : '(already dead)'}`)

    } catch (error) {
      console.error('❌ Failed to stop session:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
}

export default command