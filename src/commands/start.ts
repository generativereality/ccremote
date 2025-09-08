import { CLICommand } from '../lib/cli-framework.js'
import { SessionManager } from '../core/session.js'
import { TmuxManager } from '../core/tmux.js'
import { DiscordBot } from '../core/discord.js'

const command: CLICommand = {
  description: 'Start monitored Claude Code session',
  options: {
    name: { 
      type: 'string', 
      description: 'Session name (auto-generated if not provided)' 
    },
    channel: { 
      type: 'string', 
      description: 'Discord channel ID (optional)' 
    }
  },
  
  async handler(options) {
    console.log('🚀 Starting CCRemote session...')
    
    // Check environment variables
    const discordToken = process.env.DISCORD_BOT_TOKEN
    const discordOwnerId = process.env.DISCORD_OWNER_ID
    
    if (!discordToken || !discordOwnerId) {
      console.error('❌ Missing required environment variables:')
      console.error('   DISCORD_BOT_TOKEN - Your Discord bot token')
      console.error('   DISCORD_OWNER_ID - Your Discord user ID')
      console.error('')
      console.error('Create a .env file with these values or set them as environment variables')
      process.exit(1)
    }

    try {
      // Initialize managers
      const sessionManager = new SessionManager()
      const tmuxManager = new TmuxManager()
      const discordBot = new DiscordBot()

      await sessionManager.initialize()

      // Create session
      const session = await sessionManager.createSession(options.name, options.channel)
      console.log(`📋 Created session: ${session.name} (${session.id})`)

      // Check if tmux session already exists (cleanup from previous run)
      if (await tmuxManager.sessionExists(session.tmuxSession)) {
        console.log(`🔄 Tmux session ${session.tmuxSession} already exists, killing it...`)
        await tmuxManager.killSession(session.tmuxSession)
      }

      // Create tmux session with Claude Code
      console.log('🖥️  Creating tmux session with Claude Code...')
      await tmuxManager.createSession(session.tmuxSession)

      // Start Discord bot
      console.log('🤖 Starting Discord bot...')
      const authorizedUsers = process.env.DISCORD_AUTHORIZED_USERS?.split(',') || []
      await discordBot.start(discordToken, discordOwnerId, authorizedUsers)

      // Set up Discord channel
      let channelId = options.channel
      if (!channelId) {
        channelId = await discordBot.createOrGetChannel(session.id, session.name)
      } else {
        await discordBot.assignChannelToSession(session.id, channelId)
      }

      // Update session with channel
      await sessionManager.updateSession(session.id, { channelId })

      console.log('✅ Session started successfully!')
      console.log('')
      console.log('Session Details:')
      console.log(`  Name: ${session.name}`)
      console.log(`  ID: ${session.id}`)
      console.log(`  Tmux: ${session.tmuxSession}`)
      console.log(`  Discord Channel: ${channelId}`)
      console.log('')
      console.log('Next steps:')
      console.log(`  1. Attach to tmux session: tmux attach -t ${session.tmuxSession}`)
      console.log(`  2. Use Claude Code normally - CCRemote will monitor for limits and approvals`)
      console.log(`  3. Check Discord for notifications and approval requests`)
      console.log(`  4. Stop session when done: ccremote stop ${session.id}`)
      console.log('')
      console.log('Note: Keep this process running for monitoring to work!')

      // For now, just keep the process alive
      // In the future, this would start the monitoring daemon
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...')
        await discordBot.stop()
        process.exit(0)
      })

      // Keep process alive
      await new Promise(() => {}) // Wait forever

    } catch (error) {
      console.error('❌ Failed to start session:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
}

export default command