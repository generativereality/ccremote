# Quick Start

Get ccremote up and running in just a few minutes with our interactive setup process.

## Step 1: Initialize Configuration

Run the interactive initialization command:

```bash
ccremote init
```

This will guide you through:

1. **Configuration location**: Choose between global (`~/.ccremote.env`) or local (`./ccremote.env`) config
2. **Discord bot creation**: Step-by-step guide to create your Discord application and bot
3. **Bot token**: Help you find and enter your Discord bot token
4. **User ID**: Help you find your Discord user ID for notifications
5. **Configuration file**: Automatically generate a complete configuration file

### Configuration Location Options

- **Global** (`~/.ccremote.env`): Use for personal projects, available system-wide
- **Local** (`./ccremote.env`): Use for specific projects or client work

### Interactive Setup Process

The setup will walk you through creating a Discord bot:

1. **Create Discord Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application"
   - Give it a name like "ccremote-[yourname]"

2. **Create Bot**
   - Go to the "Bot" section
   - Click "Add Bot"
   - Copy the bot token when prompted

3. **Get Your User ID**
   - Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
   - Right-click your profile → "Copy User ID"

4. **Invite Bot to Discord**
   - The setup will provide an invite link
   - Make sure the bot has permission to send you direct messages

## Step 2: Start Your First Session

Start a monitored Claude Code session:

```bash
# Auto-generated session name
ccremote start

# Custom session name
ccremote start --name "my-project"
```

This will:
1. Create a new tmux session running Claude Code
2. Show session details for 3 seconds
3. Automatically attach you to the Claude Code session
4. Start monitoring in the background

## Step 3: Work Normally

Once attached to the session:
- Use Claude Code exactly as you normally would
- ccremote monitors the session output in the background
- You'll get Discord notifications about session events
- Sessions continue automatically when usage limits reset

## Step 4: Managing Sessions

### List All Sessions
```bash
ccremote list
```

### Check Session Status
```bash
ccremote status --session ccremote-1
```

### Stop a Session
```bash
# Graceful stop
ccremote stop --session ccremote-1

# Force stop
ccremote stop --session ccremote-1 --force
```

### Manual tmux Access
If needed, you can access tmux directly:
```bash
# Attach to existing session
tmux attach -t ccremote-1

# List all tmux sessions
tmux list-sessions

# Detach from session (while inside)
Ctrl-b d
```

## What Happens Next?

Once your session is running and monitored, ccremote will:

### Usage Limits
1. **Detect** when Claude Code hits a usage limit
2. **Notify** you via Discord with details about the limit
3. **Wait** for the limit to reset (typically 5 hours)
4. **Continue** the session automatically
5. **Confirm** continuation via Discord notification

### Approval Requests
1. **Detect** when Claude Code needs user approval
2. **Notify** you via Discord with the approval dialog
3. **Wait** for you to respond in the Claude Code session
4. **Continue** monitoring after you respond

### Errors or Session End
1. **Detect** when the session encounters errors or ends
2. **Notify** you via Discord with error details
3. **Stop** monitoring the ended session

## Example Workflow

Here's a typical ccremote workflow:

```bash
# 1. Initialize (one-time setup)
ccremote init

# 2. Start a project session
ccremote start --name "website-redesign"

# 3. Work normally in Claude Code
# ... coding, discussing, planning ...

# 4. Get Discord notification: "Usage limit reached, will continue in 5 hours"

# 5. Continue working on other things, get notified when session resumes

# 6. Check session status anytime
ccremote status --session ccremote-1

# 7. Stop session when done
ccremote stop --session ccremote-1
```

## Multiple Projects

You can run multiple sessions simultaneously:

```bash
ccremote start --name "project-a"
ccremote start --name "project-b" 
ccremote start --name "client-work"

# List all sessions
ccremote list

# Each gets monitored independently
```

## Next Steps

Now that you're set up:

1. **[Discord Setup](./discord-setup.md)** - Learn more about Discord bot configuration
2. **[Configuration](./configuration.md)** - Customize ccremote for your workflow
3. **[Session Monitoring](./monitoring.md)** - Understand how monitoring works
4. **[Commands Reference](./commands.md)** - Complete command reference

## Troubleshooting

### Bot Not Responding
- Check that your bot token is correct
- Verify the bot can send you direct messages
- Make sure you copied your User ID correctly

### Session Won't Start
- Verify tmux is installed and working: `tmux -V`
- Check that Claude Code is accessible in your PATH
- Try starting a session manually: `tmux new-session -d -s test`

### Configuration Issues
- Run `ccremote init --force` to recreate your configuration
- Check file permissions on your configuration file
- Verify environment variable format in the config file

See the [Troubleshooting guide](./troubleshooting.md) for more help.