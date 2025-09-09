# Discord Setup

This guide walks you through creating a Discord bot for ccremote notifications. You'll create your own personal bot that sends you direct messages about session status.

## Why Discord?

ccremote uses Discord for notifications because:
- **Real-time**: Instant notifications wherever you are
- **Reliable**: Discord has excellent uptime and delivery
- **Mobile**: Get notifications on your phone, desktop, or web
- **Private**: Your own bot means your notifications stay private
- **Rich**: Support for formatted messages, embeds, and reactions

## Quick Setup via Interactive Init

The easiest way is to use ccremote's interactive setup:

```bash
ccremote init
```

This will guide you through the entire process step-by-step. If you prefer manual setup or want to understand the process, continue reading.

## Manual Setup Steps

### Step 1: Create Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" 
3. Give your application a name like:
   - `ccremote-[yourname]` (for personal use)
   - `ccremote-[project]` (for client/project work)
4. Click "Create"

### Step 2: Create Bot

1. In your application, go to the "Bot" section in the left sidebar
2. Click "Add Bot" 
3. Click "Yes, do it!" to confirm
4. **Important**: Under "Privileged Gateway Intents", you don't need to enable any special intents for basic functionality

### Step 3: Get Bot Token

1. In the Bot section, find "Token"
2. Click "Copy" to copy your bot token
3. **Keep this secret!** This token allows full control of your bot
4. Save it for your ccremote configuration

### Step 4: Get Your Discord User ID

You need your Discord user ID so the bot knows where to send notifications:

1. **Enable Developer Mode**:
   - Go to Discord Settings → Advanced → Developer Mode (toggle on)

2. **Get Your User ID**:
   - Right-click on your profile picture or username anywhere in Discord
   - Click "Copy User ID"
   - Save this number for configuration

### Step 5: Invite Bot to Discord

The bot needs to be "invited" to Discord to send you messages:

1. **Generate Invite URL**:
   - In the Developer Portal, go to "OAuth2" → "URL Generator"
   - Select scopes: `bot`
   - Select bot permissions: `Send Messages` and `Use Slash Commands` (optional)
   - Copy the generated URL

2. **Invite Bot**:
   - Open the URL in your browser
   - Select "Add to Server" or choose a server (you can add to any server you have permissions for)
   - Click "Authorize"

3. **Enable Direct Messages**:
   - The bot needs to be able to send you direct messages
   - Make sure your privacy settings allow messages from server members
   - You may need to send the bot a DM first to open the channel

### Step 6: Test Bot Connection

Before using ccremote, test that your bot can reach you:

1. **Configure ccremote** with your bot token and user ID
2. **Test the connection**:
   ```bash
   ccremote test-discord
   ```
3. You should receive a test message from your bot

## Bot Permissions Explained

ccremote bots need minimal permissions:

### Required Permissions
- **Send Messages**: To send you notifications about sessions
- **Use External Emojis**: For status indicators in messages (optional but recommended)

### Optional Permissions  
- **Use Slash Commands**: If you want to add interactive bot commands later
- **Embed Links**: For richer notification formatting

### Not Required
- **Administrator**: Never give bots admin permissions
- **Manage Messages**: ccremote doesn't delete or edit messages
- **Read Message History**: Not needed for notifications

## Privacy Models

### Personal Bot (Recommended)
- **One bot per person**: Each user creates their own bot
- **Private notifications**: Only you receive your session notifications
- **Simple setup**: One bot for all your projects
- **Example name**: `ccremote-john`

### Project Bot
- **One bot per project**: Create separate bots for client work
- **Isolated notifications**: Each project's notifications are separate
- **Professional separation**: Client work stays separate from personal
- **Example name**: `ccremote-client-website`

### Team Bot
- **Shared bot**: One bot for a team or organization
- **Shared notifications**: Multiple team members get updates
- **Collaboration**: Everyone stays informed about sessions
- **Example name**: `ccremote-teamname`

## Configuration Examples

After creating your bot, add the credentials to ccremote:

### Personal Global Config
```bash
# ~/.ccremote.env
CCREMOTE_DISCORD_BOT_TOKEN=MTExMjc4NzI4OTU5NTkzOTg5MQ.GvKZoP.xyz...
CCREMOTE_DISCORD_OWNER_ID=123456789012345678
```

### Project-Specific Config
```bash
# ./ccremote.env (in project directory)
CCREMOTE_DISCORD_BOT_TOKEN=MTIzNDU2NzE4OTU5NTkzOTg5MQ.AbCdEf.xyz...
CCREMOTE_DISCORD_OWNER_ID=123456789012345678
```

### Team Config
```bash
# ./ccremote.env (shared with team)
CCREMOTE_DISCORD_BOT_TOKEN=MTk4NzY1NDMyMTU5NTkzOTg5MQ.XyZaBc.xyz...
CCREMOTE_DISCORD_OWNER_ID=111111111111111111
CCREMOTE_DISCORD_AUTHORIZED_USERS=222222222222222222,333333333333333333
```

## Notification Types

Your bot will send different types of notifications:

### 🚫 Usage Limit Reached
```
🚫 Usage limit reached in session: my-project

Claude Code has hit a usage limit. The session will continue automatically in approximately 5 hours.

Session: ccremote-1
Status: waiting_limit_reset
Reset time: 2025-01-20 15:30:00 UTC
```

### ✅ Session Continued
```
✅ Session continued: my-project

Your Claude Code session has resumed after the usage limit reset.

Session: ccremote-1
Status: active
Continued at: 2025-01-20 15:30:15 UTC
```

### ❓ Approval Required
```
❓ Approval required in session: my-project

Claude Code is asking for approval for a potentially sensitive operation. Please check your session.

Session: ccremote-1
Status: waiting_approval
```

### ❌ Session Error/Ended
```
❌ Session ended: my-project

Your Claude Code session has ended unexpectedly.

Session: ccremote-1
Status: ended
Error: Process exited with code 1
```

## Security Best Practices

### Token Security
- **Never share bot tokens**: Each person should have their own
- **Don't commit tokens**: Always use `.gitignore` for config files
- **Rotate tokens**: Change tokens periodically for security
- **Revoke unused tokens**: Delete bots you're not using

### Bot Permissions
- **Minimal permissions**: Only grant what ccremote needs
- **No admin permissions**: Never give bots administrative access
- **Review permissions**: Periodically check what permissions your bots have

### Privacy
- **Personal bots**: Create separate bots for personal vs professional use
- **Project isolation**: Use different bots for different clients/projects
- **Team awareness**: Make sure team members know about shared bots

## Troubleshooting

### Bot Not Sending Messages

1. **Check bot token**: Make sure it's correct and not expired
2. **Verify user ID**: Ensure your Discord user ID is correct
3. **Test connection**: Run `ccremote test-discord`
4. **Check permissions**: Bot needs "Send Messages" permission
5. **Direct message settings**: Make sure you allow DMs from server members

### Bot Can't Find You

1. **Enable Developer Mode**: Settings → Advanced → Developer Mode
2. **Get correct user ID**: Right-click profile → Copy User ID
3. **Mutual server**: Bot must share a server with you or have sent you a DM
4. **Privacy settings**: Check your Discord privacy settings

### Permission Errors

1. **Invite bot properly**: Use OAuth2 URL generator with correct permissions
2. **Re-invite bot**: Generate new invite link and re-add bot
3. **Check server permissions**: Make sure bot has permissions in the server
4. **Contact server admin**: If you don't have permissions to invite bots

### Token Issues

1. **Copy full token**: Make sure you copied the entire token
2. **No extra characters**: Check for spaces or newlines in token
3. **Token not expired**: Discord tokens can expire, regenerate if needed
4. **Correct format**: Token should start with `MT` and be quite long

## Advanced Setup

### Multiple Bots
You can use different bots for different purposes:

```bash
# Personal projects
export CCREMOTE_DISCORD_BOT_TOKEN=personal_bot_token
ccremote start --name personal-project

# Client work  
export CCREMOTE_DISCORD_BOT_TOKEN=client_bot_token
ccremote start --name client-project
```

### Custom Channels
Send notifications to specific Discord channels instead of DMs:

```bash
# Use channel ID instead of user ID
CCREMOTE_DISCORD_CHANNEL_ID=123456789012345678
```

### Webhook Integration
For advanced users, you can use Discord webhooks instead of bots:

```bash
CCREMOTE_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Next Steps

Once your Discord bot is set up:

1. **[Configuration](./configuration.md)** - Learn about all configuration options
2. **[Quick Start](./quick-start.md)** - Start your first monitored session  
3. **[Session Monitoring](./monitoring.md)** - Understand how monitoring works
4. **[Commands Reference](./commands.md)** - Complete command reference

Need help? Check the [Troubleshooting guide](./troubleshooting.md) or open an issue on [GitHub](https://github.com/generative-reality/ccremote/issues).