# Troubleshooting

Common issues and solutions when using ccremote.

## Installation Issues

### Command Not Found

**Problem**: `ccremote: command not found` after installation.

**Solutions**:

1. **Check installation**:
   ```bash
   # Verify ccremote is installed
   npm list -g ccremote
   # or
   bun pm ls -g | grep ccremote
   ```

2. **Check PATH**:
   ```bash
   # Check if npm/bun global bin is in PATH
   echo $PATH
   npm config get prefix  # Should be in PATH
   ```

3. **Restart terminal**: Close and reopen your terminal

4. **Reinstall globally**:
   ```bash
   npm uninstall -g ccremote
   npm install -g ccremote
   ```

5. **Use npx** as alternative:
   ```bash
   npx ccremote --version
   ```

### Permission Errors

**Problem**: Permission denied errors during installation.

**Solutions**:

1. **Use Node Version Manager** (recommended):
   ```bash
   # Install nvm
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install node
   npm install -g ccremote
   ```

2. **Fix npm permissions**:
   ```bash
   # Change npm default directory
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
   source ~/.bashrc
   ```

3. **Use sudo** (not recommended):
   ```bash
   sudo npm install -g ccremote
   ```

### tmux Issues

**Problem**: tmux commands fail or sessions don't start.

**macOS Critical Issue ⚠️**:
macOS ships with tmux 3.3a which has critical bugs. Install latest version:

```bash
# Install latest tmux
brew install tmux

# Verify version (should be 4.0+)
tmux -V
```

**Other Solutions**:

1. **Install tmux**:
   ```bash
   # Ubuntu/Debian
   sudo apt install tmux
   
   # RHEL/CentOS
   sudo yum install tmux
   
   # macOS
   brew install tmux
   ```

2. **Check tmux is working**:
   ```bash
   tmux new-session -d -s test
   tmux list-sessions
   tmux kill-session -t test
   ```

3. **Permission issues**:
   ```bash
   # Check tmux server permissions
   ls -la /tmp/tmux-*
   
   # Kill tmux server and restart
   tmux kill-server
   ```

---

## Configuration Issues

### Configuration Not Loading

**Problem**: ccremote doesn't find or load configuration.

**Debug Steps**:

1. **Check configuration locations**:
   ```bash
   # Show current config
   ccremote config --path
   
   # Check files exist
   ls -la ~/.ccremote.env
   ls -la ./ccremote.env
   ls -la ./.env
   ```

2. **Verify file format**:
   ```bash
   # Configuration should look like:
   CCREMOTE_DISCORD_BOT_TOKEN=your_token_here
   CCREMOTE_DISCORD_OWNER_ID=123456789012345678
   ```

3. **Check file permissions**:
   ```bash
   chmod 600 ~/.ccremote.env
   ```

4. **Test specific config file**:
   ```bash
   ccremote --config ./ccremote.env config
   ```

### Environment Variable Issues

**Problem**: Environment variables not working.

**Solutions**:

1. **Check export syntax**:
   ```bash
   # Correct
   export CCREMOTE_DISCORD_BOT_TOKEN="your_token"
   
   # Incorrect (no spaces around =)
   export CCREMOTE_DISCORD_BOT_TOKEN = "your_token"
   ```

2. **Verify variables are set**:
   ```bash
   echo $CCREMOTE_DISCORD_BOT_TOKEN
   env | grep CCREMOTE
   ```

3. **Make variables persistent**:
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   echo 'export CCREMOTE_DISCORD_BOT_TOKEN="your_token"' >> ~/.bashrc
   source ~/.bashrc
   ```

---

## Discord Issues

### Bot Not Sending Messages

**Problem**: Discord bot doesn't send notifications.

**Debug Steps**:

1. **Test Discord connection**:
   ```bash
   ccremote test-discord
   ```

2. **Check bot token**:
   - Verify token is correct and complete
   - Check token hasn't expired
   - Regenerate token if needed

3. **Check user ID**:
   ```bash
   # Enable Developer Mode in Discord
   # Right-click profile → Copy User ID
   # Verify ID is all numbers, 17-19 digits
   ```

4. **Bot permissions**:
   - Bot needs "Send Messages" permission
   - Check bot role permissions in server
   - Re-invite bot with correct permissions

5. **Direct message settings**:
   - Allow DMs from server members
   - Bot must share a server with you
   - Try sending bot a DM first

### Bot Token Issues

**Problem**: Invalid or expired bot tokens.

**Solutions**:

1. **Get new token**:
   - Go to Discord Developer Portal
   - Select your application → Bot
   - Click "Reset Token"
   - Copy new token immediately

2. **Check token format**:
   ```bash
   # Should start with MT and be ~70 characters
   # Example: MTExMjc4NzI4OTU5NTkzOTg5MQ.GvKZoP.xyz...
   ```

3. **Update configuration**:
   ```bash
   # Update token in config file
   ccremote init --force
   ```

### Permission Errors

**Problem**: Discord API permission errors.

**Solutions**:

1. **Re-invite bot**:
   - Developer Portal → OAuth2 → URL Generator
   - Scopes: `bot`
   - Permissions: `Send Messages`
   - Use generated URL to re-invite

2. **Check server permissions**:
   - Bot needs permission to send messages
   - Check role hierarchy (bot role above restricted roles)
   - Verify channel-specific permissions

3. **Bot in correct server**:
   - Bot must be in at least one server with you
   - If bot left server, re-invite it

---

## Session Issues

### Sessions Won't Start

**Problem**: `ccremote start` fails or sessions don't launch properly.

**Debug Steps**:

1. **Check tmux access**:
   ```bash
   tmux new-session -d -s test-session
   tmux list-sessions
   tmux kill-session -t test-session
   ```

2. **Verify Claude Code access**:
   ```bash
   # Check Claude Code is available
   which claude
   claude --version
   
   # Test manual start
   claude --help
   ```

3. **Check session limits**:
   ```bash
   # List existing sessions
   ccremote list
   tmux list-sessions
   
   # Clean up old sessions if needed
   ccremote stop --session ccremote-1
   ```

4. **Resource issues**:
   ```bash
   # Check system resources
   df -h        # Disk space
   free -m      # Memory (Linux)
   top          # CPU usage
   ```

### Monitoring Not Working

**Problem**: ccremote doesn't detect patterns or send notifications.

**Debug Steps**:

1. **Check session status**:
   ```bash
   ccremote status --session ccremote-1
   ```

2. **Enable debug logging**:
   ```bash
   DEBUG=ccremote:* ccremote status --session ccremote-1 --watch
   ```

3. **Verify session output**:
   ```bash
   # Manually check tmux session
   tmux capture-pane -t ccremote-1 -p
   ```

4. **Test pattern detection**:
   - Manually trigger a usage limit in Claude Code
   - Check if ccremote detects the pattern
   - Verify notification is sent

### Sessions End Unexpectedly

**Problem**: Sessions terminate without warning.

**Debug Steps**:

1. **Check session logs**:
   ```bash
   ccremote status --session ccremote-1
   ```

2. **tmux session logs**:
   ```bash
   tmux capture-pane -t ccremote-1 -p
   ```

3. **System resource limits**:
   ```bash
   ulimit -a     # Check process limits
   dmesg | tail  # Check system messages (Linux)
   ```

4. **Claude Code issues**:
   - Check Claude Code version compatibility
   - Verify authentication is still valid
   - Test Claude Code outside of ccremote

---

## Performance Issues

### High Resource Usage

**Problem**: ccremote using too much CPU or memory.

**Solutions**:

1. **Adjust polling interval**:
   ```bash
   # Reduce polling frequency (less CPU, slower detection)
   export CCREMOTE_MONITORING_INTERVAL=5000
   ```

2. **Limit concurrent sessions**:
   ```bash
   # Stop unused sessions
   ccremote list
   ccremote stop --session unused-session-id
   ```

3. **Monitor resource usage**:
   ```bash
   # Check ccremote processes
   ps aux | grep ccremote
   top -p $(pgrep -d',' -f ccremote)
   ```

### Slow Response Times

**Problem**: ccremote is slow to detect patterns or send notifications.

**Solutions**:

1. **Reduce polling interval**:
   ```bash
   # Faster polling (more CPU, faster detection)
   export CCREMOTE_MONITORING_INTERVAL=1000
   ```

2. **Check network connectivity**:
   ```bash
   # Test Discord API access
   ping discord.com
   curl -I https://discord.com/api/v10/gateway
   ```

3. **Optimize patterns**:
   - Custom patterns should be efficient regex
   - Avoid overly complex pattern matching

---

## Network Issues

### Discord API Errors

**Problem**: Network errors when connecting to Discord.

**Solutions**:

1. **Check internet connection**:
   ```bash
   ping discord.com
   curl -I https://discord.com/api/v10/gateway
   ```

2. **Firewall/proxy issues**:
   - Check corporate firewall settings
   - Configure proxy if needed:
     ```bash
     export HTTP_PROXY=http://proxy:port
     export HTTPS_PROXY=https://proxy:port
     ```

3. **DNS issues**:
   ```bash
   # Try different DNS
   nslookup discord.com 8.8.8.8
   ```

### Rate Limiting

**Problem**: Discord API rate limiting errors.

**Solutions**:

1. **Reduce notification frequency**:
   - ccremote handles rate limiting automatically
   - Multiple rapid notifications may be delayed

2. **Check bot usage**:
   - Make sure bot isn't used by other applications
   - Each bot has separate rate limits

---

## Advanced Troubleshooting

### Enable Debug Mode

Get detailed information about what ccremote is doing:

```bash
# Enable all debug output
DEBUG=ccremote:* ccremote start --name debug-session

# Specific debug categories
DEBUG=ccremote:discord,ccremote:monitor ccremote start --name test

# Save debug output to file
DEBUG=ccremote:* ccremote start --name test 2>&1 | tee debug.log
```

### Check Dependencies

Verify all dependencies are working:

```bash
# Node.js version
node --version    # Should be >= 20.19.4

# tmux version  
tmux -V          # Should be >= 3.2 (4.0+ recommended for macOS)

# Claude Code access
which claude
claude --version

# Network connectivity
ping discord.com
curl -I https://discord.com/api/v10/gateway
```

### Clean Slate Restart

When all else fails, start fresh:

```bash
# Stop all ccremote sessions
ccremote list
# Stop each session individually

# Kill tmux server (⚠️ affects all tmux sessions)
tmux kill-server

# Remove configuration
rm ~/.ccremote.env ./ccremote.env

# Reinstall ccremote
npm uninstall -g ccremote
npm install -g ccremote

# Reinitialize
ccremote init
```

### System Information

Gather system info for bug reports:

```bash
# System info
uname -a
node --version
npm --version
tmux -V

# ccremote info
ccremote --version
ccremote config --path

# Process info
ps aux | grep ccremote
ps aux | grep tmux

# Network info  
curl -I https://discord.com/api/v10/gateway
```

---

## Getting Help

If you're still having issues:

1. **Check existing issues**: [GitHub Issues](https://github.com/generativereality/ccremote/issues)

2. **Create bug report** with:
   - System information (OS, Node.js, tmux versions)
   - ccremote version
   - Complete error messages
   - Steps to reproduce
   - Debug output if possible

3. **Community help**: 
   - GitHub Discussions
   - Stack Overflow (tag: `ccremote`)

4. **Security issues**: Email security issues privately rather than posting publicly

Remember to **never share** your Discord bot tokens or user IDs in public issues or forums.