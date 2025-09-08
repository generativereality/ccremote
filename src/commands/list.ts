import { CLICommand } from '../lib/cli-framework.js'
import { SessionManager } from '../core/session.js'
import { TmuxManager } from '../core/tmux.js'

const command: CLICommand = {
  description: 'List all CCRemote sessions',
  
  async handler() {
    try {
      const sessionManager = new SessionManager()
      const tmuxManager = new TmuxManager()
      
      await sessionManager.initialize()
      
      const sessions = await sessionManager.listSessions()
      const activeTmuxSessions = await tmuxManager.listSessions()
      
      if (sessions.length === 0) {
        console.log('No sessions found.')
        console.log('Create a session with: ccremote start')
        return
      }

      console.log('CCRemote Sessions:')
      console.log('')

      for (const session of sessions) {
        const tmuxActive = activeTmuxSessions.includes(session.tmuxSession)
        const statusIcon = session.status === 'active' ? '✅' : session.status === 'waiting' ? '⏳' : '❌'
        const tmuxIcon = tmuxActive ? '🖥️' : '💀'
        
        console.log(`${statusIcon} ${session.name} (${session.id})`)
        console.log(`   Status: ${session.status}`)
        console.log(`   Tmux: ${session.tmuxSession} ${tmuxIcon}`)
        console.log(`   Discord: ${session.channelId || 'Not assigned'}`)
        console.log(`   Created: ${new Date(session.created).toLocaleString()}`)
        console.log(`   Last Activity: ${new Date(session.lastActivity).toLocaleString()}`)
        console.log('')
      }

      // Show cleanup suggestions
      const deadSessions = sessions.filter(s => 
        !activeTmuxSessions.includes(s.tmuxSession) && s.status === 'active'
      )
      
      if (deadSessions.length > 0) {
        console.log('⚠️  Dead sessions found (tmux not running):')
        for (const session of deadSessions) {
          console.log(`   ${session.name} (${session.id})`)
        }
        console.log('')
        console.log('Clean up with: ccremote stop <session-id>')
      }

    } catch (error) {
      console.error('❌ Failed to list sessions:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
}

export default command