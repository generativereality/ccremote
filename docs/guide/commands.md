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

Clean up old session files and orphaned tmux sessions.

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
4. Removes temporary monitoring files
5. Frees up disk space and resources

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