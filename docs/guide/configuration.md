# Configuration

ccremote supports flexible configuration with multiple options for different use cases. This guide covers all configuration methods and options.

## Configuration Priority

ccremote uses the following priority order (highest to lowest):

1. **Environment variables** (prefixed with `CCREMOTE_`)
2. **Project config**: `./ccremote.env` (current directory)
3. **Project config**: `./.env` (current directory)
4. **Global config**: `~/.ccremote.env` (user home directory)

Higher priority configurations override lower priority ones.

## Configuration Methods

### Interactive Setup (Recommended)

The easiest way to create configuration is using the interactive setup:

```bash
# Create new configuration
ccremote init

# Overwrite existing configuration
ccremote init --force
```

This guides you through:
- Choosing configuration location (global vs local)
- Creating Discord bot and getting credentials
- Setting up all required options

### Manual Configuration

You can also create configuration files manually or edit existing ones.

## Configuration Options

### Required Settings

These settings are required for ccremote to function:

```bash
# Discord Bot Configuration (Required)
CCREMOTE_DISCORD_BOT_TOKEN=your_discord_bot_token_here
CCREMOTE_DISCORD_OWNER_ID=your_discord_user_id_here
```

### Optional Settings

Customize ccremote behavior with these optional settings:

```bash
# Additional Discord Users
CCREMOTE_DISCORD_AUTHORIZED_USERS=user_id1,user_id2,user_id3

# Monitoring Configuration
CCREMOTE_MONITORING_INTERVAL=2000          # Polling interval in milliseconds (default: 2000)
CCREMOTE_MAX_RETRIES=3                     # Max retry attempts on error (default: 3)
CCREMOTE_AUTO_RESTART=true                 # Auto-restart monitoring on failure (default: true)

# Session Configuration
CCREMOTE_DEFAULT_SESSION_PREFIX=ccremote   # Default session name prefix (default: ccremote)
CCREMOTE_CLAUDE_COMMAND=claude             # Claude Code command (default: claude)
```

### Environment Variable Details

#### `CCREMOTE_DISCORD_BOT_TOKEN`
- **Required**: Yes
- **Description**: Discord bot token for sending notifications
- **How to get**: See [Discord Setup guide](./discord-setup.md)
- **Example**: `CCREMOTE_DISCORD_BOT_TOKEN=MTExMjc4Nz...`

#### `CCREMOTE_DISCORD_OWNER_ID`  
- **Required**: Yes
- **Description**: Your Discord user ID for receiving notifications
- **How to get**: Enable Developer Mode in Discord → Right-click profile → Copy User ID
- **Example**: `CCREMOTE_DISCORD_OWNER_ID=123456789012345678`

#### `CCREMOTE_DISCORD_AUTHORIZED_USERS`
- **Required**: No
- **Description**: Additional Discord users who can receive notifications (comma-separated)
- **Use case**: Team members, assistants, or shared accounts
- **Example**: `CCREMOTE_DISCORD_AUTHORIZED_USERS=111111111111111111,222222222222222222`

#### `CCREMOTE_MONITORING_INTERVAL`
- **Required**: No
- **Default**: `2000` (2 seconds)
- **Description**: How often to poll session output in milliseconds
- **Range**: `1000-10000` (1-10 seconds recommended)
- **Example**: `CCREMOTE_MONITORING_INTERVAL=3000`

#### `CCREMOTE_MAX_RETRIES`
- **Required**: No
- **Default**: `3`
- **Description**: Maximum retry attempts when monitoring encounters errors
- **Range**: `1-10`
- **Example**: `CCREMOTE_MAX_RETRIES=5`

#### `CCREMOTE_AUTO_RESTART`
- **Required**: No  
- **Default**: `true`
- **Description**: Whether to automatically restart monitoring after failures
- **Values**: `true` or `false`
- **Example**: `CCREMOTE_AUTO_RESTART=false`

## Configuration Locations

### Global Configuration (`~/.ccremote.env`)

Best for:
- Personal use across all projects
- Default settings you want everywhere
- Single-user development

```bash
# Example global config
CCREMOTE_DISCORD_BOT_TOKEN=your_personal_bot_token
CCREMOTE_DISCORD_OWNER_ID=your_user_id
CCREMOTE_MONITORING_INTERVAL=2000
```

### Project Configuration (`./ccremote.env`)

Best for:
- Client work with separate Discord bots
- Project-specific settings
- Team collaboration
- Different notification channels per project

```bash
# Example project config
CCREMOTE_DISCORD_BOT_TOKEN=client_specific_bot_token
CCREMOTE_DISCORD_OWNER_ID=your_user_id
CCREMOTE_DISCORD_AUTHORIZED_USERS=teammate1,teammate2
CCREMOTE_MONITORING_INTERVAL=1500
```

### Environment Variables

Best for:
- CI/CD environments
- Temporary overrides
- Development/testing different settings

```bash
# Export for current session
export CCREMOTE_DISCORD_BOT_TOKEN=test_bot_token
export CCREMOTE_MONITORING_INTERVAL=5000

ccremote start --name test-session
```

## Privacy and Security Models

### Personal Use Model
- **Global config**: `~/.ccremote.env` with your personal Discord bot
- **Single bot**: One Discord bot for all your projects
- **Simple setup**: One-time configuration for all projects

### Client Work Model
- **Project configs**: `./ccremote.env` in each project directory
- **Separate bots**: Different Discord bot for each client/project
- **Isolated notifications**: Each project's notifications stay separate
- **Team sharing**: Add teammates to `CCREMOTE_DISCORD_AUTHORIZED_USERS`

### Team Model
- **Shared bot**: Team Discord bot in project config
- **Multiple users**: All team members in `CCREMOTE_DISCORD_AUTHORIZED_USERS`
- **Shared notifications**: Everyone gets updates about sessions
- **Project isolation**: Different config per project/repo

## Example Configurations

### Basic Personal Setup
```bash
# ~/.ccremote.env
CCREMOTE_DISCORD_BOT_TOKEN=MTExMjc4NzI4OTU5NTkzOTg5MQ.GvKZoP.xyz
CCREMOTE_DISCORD_OWNER_ID=123456789012345678
```

### Client Work Setup
```bash
# ./ccremote.env (in project directory)
CCREMOTE_DISCORD_BOT_TOKEN=MTIzNDU2NzE4OTU5NTkzOTg5MQ.AbCdEf.xyz
CCREMOTE_DISCORD_OWNER_ID=123456789012345678
CCREMOTE_MONITORING_INTERVAL=1500
```

### Team Setup
```bash
# ./ccremote.env (shared in team repo)
CCREMOTE_DISCORD_BOT_TOKEN=MTk4NzY1NDMyMTU5NTkzOTg5MQ.XyZaBc.xyz
CCREMOTE_DISCORD_OWNER_ID=111111111111111111
CCREMOTE_DISCORD_AUTHORIZED_USERS=222222222222222222,333333333333333333
CCREMOTE_MAX_RETRIES=5
CCREMOTE_AUTO_RESTART=true
```

### Development/Testing Setup
```bash
# .env (for local development)
CCREMOTE_DISCORD_BOT_TOKEN=test_bot_token
CCREMOTE_DISCORD_OWNER_ID=your_test_user_id
CCREMOTE_MONITORING_INTERVAL=5000
CCREMOTE_MAX_RETRIES=1
CCREMOTE_AUTO_RESTART=false
```

## Validating Configuration

Check that your configuration is working:

```bash
# Test Discord connection (sends test message)
ccremote test-discord

# Show current configuration (redacts sensitive values)
ccremote config

# Start a test session
ccremote start --name config-test
```

## Configuration File Security

### File Permissions
Configuration files may contain sensitive tokens. Secure them:

```bash
# Set restrictive permissions
chmod 600 ~/.ccremote.env
chmod 600 ./ccremote.env

# Verify permissions
ls -la ~/.ccremote.env
```

### Git Ignore
Always ignore configuration files in version control:

```bash
# .gitignore
ccremote.env
.env
```

### Token Security
- **Never commit tokens** to version control
- **Use separate bots** for different environments (dev/staging/prod)
- **Rotate tokens** periodically for security
- **Revoke tokens** when team members leave

## Troubleshooting

### Configuration Not Loading
1. Check file locations and names
2. Verify environment variable names (must start with `CCREMOTE_`)
3. Check file permissions (must be readable)
4. Use `ccremote config` to see what's loaded

### Discord Bot Issues
1. Verify bot token is correct and not expired
2. Check bot permissions in Discord
3. Ensure bot can send you direct messages
4. Test with `ccremote test-discord`

### Environment Variable Issues
1. Check export syntax: `export CCREMOTE_VAR=value`
2. Verify no extra spaces around `=`
3. Use quotes for values with spaces
4. Check that variables persist in new shell sessions

For more help, see the [Troubleshooting guide](./troubleshooting.md).