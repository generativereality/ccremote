# Commands Reference

Complete reference for all ccremote commands and options.

## Global Options

These options work with all commands:

```bash
--help, -h          Show help information
--version, -v       Show version number
--verbose           Enable verbose output
--config <path>     Use specific configuration file
```

## `ccremote init`

Initialize ccremote configuration with interactive setup.

```bash
ccremote init [options]
```

### Options

```bash
--force             Overwrite existing configuration
--global            Create global configuration (~/.ccremote.env)
--local             Create local configuration (./ccremote.env)
```

### Examples

```bash
# Interactive setup (chooses location)
ccremote init

# Force overwrite existing config
ccremote init --force

# Create global config
ccremote init --global

# Create local project config
ccremote init --local
```

### What it does

1. Guides you through Discord bot creation
2. Helps you get bot token and user ID
3. Creates configuration file with all settings
4. Tests Discord connection
5. Provides next steps

---

## `ccremote start`

Start a new monitored Claude Code session.

```bash
ccremote start [options]
```

### Options

```bash
--name <name>       Custom session name (default: auto-generated)
--channel <id>      Discord channel ID for notifications (overrides DM)
--no-attach         Don't automatically attach to session
--command <cmd>     Claude Code command to run (default: "claude")
```

### Examples

```bash
# Auto-generated session name
ccremote start

# Custom session name
ccremote start --name "website-redesign"

# Don't attach automatically (run in background)
ccremote start --name "background-task" --no-attach

# Use specific Discord channel
ccremote start --name "team-project" --channel "123456789012345678"

# Custom Claude Code command
ccremote start --name "test" --command "claude --debug"
```

### What it does

1. Creates unique tmux session (e.g., `ccremote-1`)
2. Launches Claude Code inside the session
3. Initializes monitoring and state tracking
4. Shows session details for 5 seconds
5. Attaches you to the session (unless `--no-attach`)
6. Starts background monitoring process

### Session Names

- **Auto-generated**: `ccremote-1`, `ccremote-2`, etc.
- **Custom**: Use `--name` for meaningful names
- **Unique**: Each session gets unique tmux session ID
- **Display**: Custom names shown in notifications and status

---

## `ccremote schedule`

Schedule daily quota window alignment with early dummy commands.

```bash
ccremote schedule --time <time> [options]
```

### Options

```bash
--time <time>       Time to start daily quota window (required)
                    Formats: "5:00", "5am", "17:30", "7:30pm"
```

### Examples

```bash
# Schedule daily 5 AM quota window
ccremote schedule --time "5:00"

# Schedule daily 7:30 AM quota window
ccremote schedule --time "7:30am"

# Schedule daily 5 PM quota window
ccremote schedule --time "17:00"
```

### What it does

1. Creates a special quota scheduling session
2. Stages a message to be sent at the specified time daily
3. Shows session details for 5 seconds
4. Attaches you to the Claude Code session
5. **After 5 seconds**: The message appears typed in the session
6. **At scheduled time**: Message is sent to Claude Code automatically
7. **Daily recurrence**: Automatically schedules next day's execution

### How It Works

The schedule command optimizes your daily Claude Code usage by:

- **Early quota window start**: Sends a dummy message at your specified time (e.g., 5 AM)
- **Quota alignment**: Aligns your 5-hour usage windows with your workday
- **3 effective windows**: Instead of 2 usable windows, you get 3 throughout the day
- **Set and forget**: Runs automatically every day without intervention

### Example Workflow

```bash
# Schedule 5 AM daily quota window
ccremote schedule --time "5:00"

# Your quota windows become:
# Window 1: 5:00 AM - 10:00 AM (early start)
# Window 2: 10:00 AM - 3:00 PM (work hours)
# Window 3: 3:00 PM - 8:00 PM (afternoon/evening)
```

---

## `ccremote list`

List all ccremote sessions with their status.

```bash
ccremote list [options]
```

### Options

```bash
--all               Include ended sessions in output
--json              Output in JSON format (if implemented)
```

### Examples

```bash
# List all sessions
ccremote list

# Show only active sessions
ccremote list --active

# JSON output for scripting
ccremote list --json
```

### Sample Output

```
ccremote Sessions:
┌─────────────┬─────────────────┬─────────────────────┬─────────────────────┐
│ Session ID  │ Name           │ Status              │ Started             │
├─────────────┼─────────────────┼─────────────────────┼─────────────────────┤
│ ccremote-1  │ website-work   │ active              │ 2025-01-20 10:30:00 │
│ ccremote-2  │ client-project │ waiting_limit_reset │ 2025-01-20 09:15:00 │
│ ccremote-3  │ testing        │ ended               │ 2025-01-20 08:00:00 │
└─────────────┴─────────────────┴─────────────────────┴─────────────────────┘
```

---

## `ccremote status`

Show detailed status for a specific session.

```bash
ccremote status --session <session_id> [options]
```

### Options

```bash
--session <id>      Session ID to check (required)
--json              Output in JSON format
--watch             Watch mode (update every 2 seconds)
```

### Examples

```bash
# Show session status
ccremote status --session ccremote-1

# JSON output
ccremote status --session ccremote-1 --json

# Watch mode (live updates)
ccremote status --session ccremote-1 --watch
```

### Sample Output

```
Session Status: ccremote-1

Basic Info:
  Name: website-redesign
  Status: active
  Started: 2025-01-20 10:30:00
  Duration: 2h 15m 30s

Monitoring:
  State: monitoring
  Last Check: 2025-01-20 12:45:30
  Checks: 4,230
  Errors: 0

tmux Info:
  Session: ccremote-1
  Windows: 1
  Attached: yes (1 client)

Discord:
  Notifications: enabled
  Last Sent: 2025-01-20 10:30:15
  Total Sent: 1
```

---

## `ccremote stop`

Stop a monitored session.

```bash
ccremote stop --session <session_id> [options]
```

### Options

```bash
--session <id>      Session ID to stop (required)
--force             Force stop even if active/attached
--keep-tmux         Don't terminate tmux session
```

### Examples

```bash
# Graceful stop
ccremote stop --session ccremote-1

# Force stop active session
ccremote stop --session ccremote-1 --force

# Stop monitoring but keep tmux session running
ccremote stop --session ccremote-1 --keep-tmux
```

### What it does

1. **Graceful stop**: Warns if session is active/attached
2. **Monitoring stop**: Stops background monitoring process
3. **State update**: Updates session state to "stopped"
4. **tmux cleanup**: Terminates tmux session (unless `--keep-tmux`)
5. **Discord notification**: Sends stopped notification
6. **Resource cleanup**: Frees monitoring resources

---

## `ccremote resume`

Resume monitoring for existing sessions.

```bash
ccremote resume [options]
```

### Options

```bash
--session <id>      Specific session to resume (optional)
--dry-run           Preview what would be resumed without taking action
--all               Resume all resumable sessions
```

### Examples

```bash
# Resume specific session
ccremote resume --session ccremote-1

# Preview what would be resumed
ccremote resume --dry-run

# Resume all resumable sessions
ccremote resume --all
```

### What it does

1. Identifies sessions that can be resumed
2. Reconnects monitoring to existing tmux sessions
3. Restarts Discord bot integration
4. Updates session status tracking
5. Resumes automated continuation and notifications

---

## `ccremote clean`

Clean up old session files, orphaned tmux sessions, and Discord channels.

```bash
ccremote clean [options]
```

### Options

```bash
--dry-run           Preview what would be cleaned without taking action
--force             Clean without confirmation prompts
--keep-days <n>     Keep sessions newer than N days (default: 7)
```

### Examples

```bash
# Interactive cleanup
ccremote clean

# Preview cleanup actions
ccremote clean --dry-run

# Clean sessions older than 3 days
ccremote clean --keep-days 3
```

### What it does

1. Identifies ended or orphaned sessions
2. Removes old session state files
3. Cleans up orphaned tmux sessions
4. Archives orphaned Discord channels (channels without active sessions)
5. Removes temporary monitoring files
6. Frees up disk space and resources

---

## `ccremote setup-tmux`

Configure tmux settings optimized for ccremote.

```bash
ccremote setup-tmux [options]
```

### Options

```bash
--global            Apply settings globally to ~/.tmux.conf
--local             Apply settings to ./.tmux.conf
--dry-run           Preview changes without applying them
```

### Examples

```bash
# Interactive setup
ccremote setup-tmux

# Apply global tmux settings
ccremote setup-tmux --global

# Preview what would be configured
ccremote setup-tmux --dry-run
```

### What it does

1. Configures tmux for optimal ccremote performance
2. Sets up proper mouse mode and key bindings
3. Optimizes session management settings
4. Ensures compatibility with Claude Code
5. Creates backup of existing configuration

---

## Session Management Commands

### Attach to Session

Manually attach to an existing session:

```bash
# Direct tmux command
tmux attach -t ccremote-1
```

### Detach from Session

While inside a session, detach without stopping:

```bash
# Keyboard shortcut (default tmux)
Ctrl-b d

# Or from outside
tmux detach -t ccremote-1
```

### List tmux Sessions

See all tmux sessions (including non-ccremote):

```bash
tmux list-sessions
```

---

## Discord Commands

Once your Discord bot is set up and sessions are running, you can interact with ccremote through Discord:

### Session Channel Commands

These commands work in the dedicated Discord channel for each session:

#### `/output` or `output`
View current session output (last 50 lines, formatted in code blocks).

```
/output
```

**What it does:**
- Captures current tmux session output
- Shows last 50 lines for reasonable context
- Formats output in Discord code blocks for easy reading
- Automatically chunks long output into multiple messages
- Works from anywhere - perfect for checking progress remotely

**Example output:**
```
📺 **Session Output**
```
$ npm run build
✓ Building for production...
✓ Generated 15 assets
✓ Build complete in 2.3s
>
```

#### `status`
Show session status information.

```
status
```

**What it does:**
- Displays current session state
- Shows tmux session status
- Reports monitoring status
- Provides basic session metadata

#### Approval Responses
Respond to approval dialogs with numbered options.

```
1    # Select option 1 (usually "Yes" or "Approve")
2    # Select option 2 (usually "No" or "Deny")
3    # Select option 3 (if available)
```

**What it does:**
- Sends the selected option number to the Claude Code session
- Continues the session with your choice
- Provides immediate feedback in Discord

### Session Channels

- **Channel Creation**: Each monitored session gets its own private Discord channel (e.g., `#ccremote-session-1`)
- **Auto-Created**: Channels are automatically created when sessions start
- **Private**: Only you (and other authorized users) can see these channels
- **Auto-Archived**: Channels are automatically archived when sessions end or via the `clean` command

---

## Exit Codes

ccremote uses standard exit codes:

- **0**: Success
- **1**: General error
- **2**: Invalid arguments/usage
- **3**: Configuration error
- **4**: Discord connection error
- **5**: Session not found
- **6**: tmux error
- **130**: Interrupted by user (Ctrl-C)

## Environment Variables

Commands respect these environment variables:

```bash
# Override config file location
CCREMOTE_CONFIG_FILE=/path/to/config.env

# Enable debug output
DEBUG=ccremote:*

# Disable colors in output
NO_COLOR=1

# Override Discord settings for single command
CCREMOTE_DISCORD_BOT_TOKEN=temp_token
CCREMOTE_DISCORD_OWNER_ID=temp_user_id
```

## Scripting Examples

### Batch Session Management

```bash
#!/bin/bash

# Start multiple sessions for different projects
projects=("website" "api" "mobile-app")

for project in "${projects[@]}"; do
    ccremote start --name "$project" --no-attach
    echo "Started session: $project"
done

# List all sessions
ccremote list
```

### Session Health Check

```bash
#!/bin/bash

# Check all sessions and report status
ccremote list --json | jq -r '.[] | "\(.name): \(.status)"'

# Stop any ended sessions
ccremote list --json | jq -r '.[] | select(.status == "ended") | .id' | while read session; do
    ccremote stop --session "$session"
done
```

### Automated Setup

```bash
#!/bin/bash

# Automated ccremote setup for CI/CD
export CCREMOTE_DISCORD_BOT_TOKEN="$CI_DISCORD_TOKEN"
export CCREMOTE_DISCORD_OWNER_ID="$CI_DISCORD_USER_ID"

ccremote start --name "ci-build-$BUILD_ID" --no-attach
```

## Command Chaining

ccremote commands can be chained with standard shell operators:

```bash
# Start session and show status
ccremote start --name "test" && ccremote status --session ccremote-1

# Start multiple sessions
ccremote start --name "project-a" --no-attach && \
ccremote start --name "project-b" --no-attach && \
ccremote list

# Conditional operations
ccremote test-discord && ccremote start --name "verified-session"
```

## Next Steps

Now that you know all the commands:

1. **[Troubleshooting](./troubleshooting.md)** - Solve common issues
2. **[Configuration](./configuration.md)** - Customize ccremote behavior
3. **[Session Monitoring](./monitoring.md)** - Understand how monitoring works

For more examples and advanced usage, see the [GitHub repository](https://github.com/generativereality/ccremote).