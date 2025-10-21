<div align="center">
    <h1>ccremote</h1>
    <p><strong>Claude Code Remote</strong></p>
</div>

<p align="center">
    <a href="https://npmjs.com/package/ccremote"><img src="https://img.shields.io/npm/v/ccremote?color=yellow" alt="npm version" /></a>
    <a href="https://packagephobia.com/result?p=ccremote"><img src="https://packagephobia.com/badge?p=ccremote" alt="install size" /></a>
</p>

## Claude Code Remote

1. **Approve prompts from Discord**
   Approve Claude Code prompts (file edits, shell commands) from Discord, so sessions don't stall when you're away.

2. **Continue sessions after quota resets**
   Detect when a session stops due to quota limits, wait until the 5-hour window resets, then automatically continue.

3. **Align quota windows with your workday**
   Schedule an early dummy command (e.g. 5 AM) so quota windows align with your workday → effectively 3 usable windows instead of 2.

4. **Get notified when tasks complete**
   Receive Discord notifications when Claude finishes a task and is ready for new input (no more checking back every few minutes).

5. **Remote session monitoring**
   View current session output directly in Discord with the `/output` command - see what Claude is working on from anywhere.

## Quick Start

### 1. Install and Initialize

```bash
# Install globally (recommended)
npm install -g ccremote

# Initialize configuration interactively
ccremote init

# Keep ccremote up to date
npm update -g ccremote
```

> **Note**: ccremote automatically checks for updates once per day and displays a notification if a newer version is available.

### 2. Start Monitoring

```bash
# Start with auto-attach to Claude Code
ccremote

# Or with custom session name
ccremote start --name "my-session"
```

💡 **Pro tip**: `ccremote` without arguments is the same as `ccremote start` - just replace `claude` with `ccremote` in your workflow!

That's it! You'll be automatically attached to a Claude Code session with monitoring active.

## Quick Setup

1. **Initialize Configuration**:
   ```bash
   ccremote init                    # Interactive setup (creates ~/.ccremote.env by default)
   ```
   
   The interactive setup will:
   - Ask whether to create global (~/.ccremote.env) or local (./ccremote.env) config
   - Guide you through creating a Discord app and bot (only for you)
   - Help you find your Discord bot token and user ID
   - Generate a complete configuration file

2. **Start a Monitored Session**:
   ```bash
   ccremote start --name "my-session"
   ```
   This automatically:
   - Creates a tmux session with Claude Code running
   - Shows session details for 5 seconds
   - Attaches you directly to the Claude Code session

3. **Work Normally**:
   - Use Claude Code as usual in the attached session
   - ccremote monitors in the background and will automatically continue when limits reset
   - Get Discord notifications about session status

## Usage

```bash
# Initialize configuration (interactive)
ccremote init                            # Interactive setup (global by default)

# Start a new monitored session
ccremote                                 # Default command (same as 'ccremote start')
ccremote start                           # Auto-generated name
ccremote start --name "my-session"       # Custom name

# Schedule daily quota window alignment
ccremote schedule --time "5:00"          # Schedule daily 5 AM quota window
ccremote schedule --time "7:30am"        # Schedule daily 7:30 AM quota window

# Resume sessions
ccremote resume --session ccremote-1     # Resume a specific session
ccremote resume --dry-run               # Preview what would be resumed

# Manage sessions
ccremote list                            # List sessions for current project
ccremote list --all                      # List sessions from all projects
ccremote status --session ccremote-1     # Show session details
ccremote stop --session ccremote-1       # Stop session
ccremote stop --session ccremote-1 --force  # Force stop even if active

# Maintenance commands
ccremote clean                           # Clean up current project's dead sessions
ccremote clean --all                     # Clean up dead sessions from all projects
ccremote clean --dry-run                 # Preview what would be cleaned
ccremote setup-tmux                      # Configure tmux settings for ccremote

# Manual tmux access (if needed)
tmux attach -t ccremote-1                # Attach to existing session
tmux list-sessions                       # List all tmux sessions
```

## How It Works

1. **Smart Monitoring**: ccremote polls your tmux session every 2 seconds, analyzing output for Claude Code limit messages
2. **Auto-Continuation**: When a usage limit is detected, ccremote waits for the limit to reset (typically 5 hours) and automatically continues your session
3. **Discord Notifications**: Get real-time updates about your sessions:
   - 🚫 Usage limit reached
   - ✅ Session automatically continued
   - ❓ Approval requests (Claude Code confirmation dialogs)
   - ✅ Task completion notifications (when Claude is ready for new input)
   - ❌ Errors or session ended
4. **Seamless Integration**: Works with your existing Claude Code workflow - the start command automatically attaches you to the session

## Features

- 🔄 **Automatic Continuation**: Automatically continue your Claude Code sessions when usage limits reset
- 💬 **Discord Integration**: Real-time notifications and approval handling via Discord DM or private channels
- ✅ **Task Completion Notifications**: Get alerted when Claude finishes tasks and is ready for new input
- 📺 **Remote Output Viewing**: View current session output directly in Discord with `/output` command
- 🧹 **Smart Cleanup**: Automatic cleanup of orphaned Discord channels and session files
- 📱 **Session Management**: Create, list, monitor, and stop multiple sessions
- 🖥️ **Tmux Integration**: Seamless tmux session management with proper cleanup
- 🎯 **Pattern Detection**: Intelligent detection of usage limits, errors, and continuation opportunities
- ⚡ **Smart Polling**: Efficient monitoring with configurable intervals and retry logic
- 🔒 **Secure**: Environment-based configuration, no hardcoded credentials

## Configuration

ccremote supports multiple configuration methods with the following priority (highest to lowest):

1. **Environment variables** (prefixed with `CCREMOTE_`)
2. **Project config**: `./ccremote.env`
3. **Project config**: `./.env`
4. **Global config**: `~/.ccremote.env`

### Required Settings

```bash
# Required: Discord Bot Configuration  
CCREMOTE_DISCORD_BOT_TOKEN=your_discord_bot_token
CCREMOTE_DISCORD_OWNER_ID=your_discord_user_id

# Optional: Additional authorized users (comma-separated)
CCREMOTE_DISCORD_AUTHORIZED_USERS=user_id1,user_id2

# Optional: Monitoring Configuration
CCREMOTE_MONITORING_INTERVAL=2000    # Polling interval in milliseconds
CCREMOTE_MAX_RETRIES=3               # Max retry attempts on error  
CCREMOTE_AUTO_RESTART=true           # Auto-restart monitoring on failure
```

### Privacy Model

- **Per-user bots**: Each user should create their own Discord bot for privacy
- **Per-project bots**: For client work, create separate bots per project/organization
- **Project-specific config**: Use `ccremote.env` in each project directory
- **Global config**: Use `~/.ccremote.env` for personal/default settings

## Discord Setup

1. **Create Bot**: Go to Discord Developer Portal → New Application → Bot
2. **Enable Intent**: In Bot section, enable "Message Content Intent" (required for approval commands)
3. **Get Token**: Copy the bot token from the Bot section
4. **Get User ID**: Enable Developer Mode in Discord → Right-click your profile → Copy User ID
5. **Invite Bot**: Use OAuth2 → URL Generator to create invite link with these permissions:
   - **Administrator** (recommended - for full channel management)

   OR for minimal permissions:
   - **Manage Channels** (to create private session channels)
   - **Manage Roles** (to set channel permissions)
   - **Send Messages** (to send notifications)
   - **Read Message History** (to see approval responses)

   💡 **Note**: If your bot lacks Manage Channels permission, ccremote will gracefully fall back to DMs

### Discord Commands

Once your bot is set up and sessions are running, you can interact with ccremote through Discord:

**In Session Channels:**
- **`/output`** or **`output`** - View current session output (last 50 lines, formatted in code blocks)
- **`status`** - Show session status information
- **`1`, `2`, `3`** - Respond to approval dialogs with numbered options

**Session Channels:**
- Each monitored session gets its own private Discord channel (e.g., `#ccremote-session-1`)
- Channels are automatically created when sessions start
- Only you (and other authorized users) can see these channels
- Channels are archived when sessions end or via the `clean` command

## Requirements

- **Node.js** 20.19.4 or higher
- **tmux** (for session management) - **Important**: macOS ships with tmux 3.3a which has a critical bug causing crashes when mouse mode is enabled. Install the latest version: `brew install tmux`
- **Discord bot** (for notifications)

## Development

```bash
# Clone and install
git clone <repo>
cd ccremote
bun install

# Development commands
bun run dev start --name test       # Run in development mode
bun run check                       # Run all checks (lint + typecheck + test + build)
bun run build                       # Build for production
bun run test                        # Run tests with vitest
bun run lint                        # Lint code with ESLint
bun run typecheck                   # Type check with TypeScript
bun run format                      # Format code (lint --fix)
bun run release                     # Full release workflow (check + version bump)
bun run release:test                 # Test package without releasing

# Global development installation (recommended approach)
bun run release:test                 # Build, package, and install globally

# After making changes, simply run:
bun run release:test                 # Rebuilds, repackages, and reinstalls globally
```

## Release Process

### Key Principles

- **Test before merging**: Test features (`npm pack` + local install) on feature branches
- **Publish from main**: Only publish to npm from `main` branch after PR merge
- **Tag releases**: Create git tags for published versions

### Workflow

1. **Merge features**: All features merged to main via GitHub PRs
2. **Release**: On main branch, run `bun run release`
   - Validates you're on main branch
   - Runs all checks (lint, typecheck, tests, build)
   - Creates and tests package locally
   - Interactive version bump
   - Publishes to npm and creates git tag
3. **Bug fixes**: If issues found, fix via PR then re-run `bun run release`

## Sponsors

* [AI@YourService](https://atyourservice.ai/?utm_source=github&utm_medium=sponsorship&utm_campaign=ccremote)

<div>
  <a href="https://atyourservice.ai/?utm_source=github&utm_medium=sponsorship&utm_campaign=ccremote">
    <img src="https://atyourservice.ai/ogimage.png?utm_source=github&utm_medium=sponsorship&utm_campaign=ccremote" alt="AI@YourService" width="300" />
  </a>
</div>

## Acknowledgements

Big thanks to the authors and maintainers of:

- **[Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote)** - Demonstrated that remote control was possible and provided valuable insights into different approaches for remote notifications
- **[ccusage](https://github.com/ryoppippi/ccusage)** - Great tool that inspired package and repository structure patterns

## License

MIT