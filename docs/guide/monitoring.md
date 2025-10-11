# Session Monitoring

This guide explains how ccremote monitors your Claude Code sessions, what it detects, and how it responds to different situations.

## How Monitoring Works

ccremote uses a sophisticated pattern detection system to monitor your Claude Code sessions:

1. **tmux Integration**: Sessions run inside tmux, allowing ccremote to capture all output
2. **Intelligent Polling**: Monitors session output every 2 seconds (configurable)
3. **Pattern Matching**: Uses regex patterns to detect specific Claude Code messages
4. **State Management**: Tracks session state and responds appropriately
5. **Error Recovery**: Automatically retries and recovers from temporary issues

## What ccremote Detects

### Usage Limits

ccremote detects when Claude Code hits usage limits with patterns like:
- "5-hour limit reached" messages
- "usage limit" followed by reset information
- Specific limit reset times and countdowns

**Response**: 
- Sends Discord notification about the limit
- Calculates reset time (typically 5 hours from limit)
- Automatically continues session when limit resets
- Sends confirmation when session resumes

### Approval Dialogs

ccremote recognizes when Claude Code needs user approval:
- Questions followed by numbered options
- Selection arrows (`>`) indicating current choice
- Sensitive operation confirmation dialogs
- File operation approvals

**Response**:
- Sends Discord notification with approval details
- Includes the question and available options
- Waits for user to respond in the Claude Code session
- Continues monitoring after user responds

### Session Errors

ccremote detects various error conditions:
- Process crashes or unexpected exits
- Network connectivity issues
- Authentication problems
- Resource exhaustion

**Response**:
- Sends Discord notification with error details
- Attempts automatic recovery (configurable retries)
- Stops monitoring if session ends permanently
- Logs error information for troubleshooting

### Task Completion Detection

ccremote detects when Claude finishes tasks and is ready for new input:
- Command prompt visible (`> ` pattern)
- No active processing indicators (analyzing, processing, working, etc.)
- Session idle for at least 10 seconds
- No completion notification sent in the last 5 minutes (cooldown)

**Response**:
- Sends Discord notification that task is complete
- Includes idle duration for context
- Helps you know when to check back without constant monitoring
- Respects cooldown period to avoid notification spam

### Session State Changes

ccremote tracks different session states:
- **Active**: Session running normally
- **Waiting**: Waiting for usage limit reset
- **Waiting Approval**: Waiting for user approval
- **Ended**: Session terminated or crashed
- **Error**: Encountered unrecoverable error

## Pattern Detection Examples

### Usage Limit Detection
```
5-hour limit reached. Your limit will reset at 3:30 PM PST (in 4 hours 23 minutes).
```

ccremote extracts:
- Limit type: "5-hour limit"
- Reset time: "3:30 PM PST"
- Duration: "4 hours 23 minutes"

### Approval Detection
```
This operation requires approval. Do you want to continue?

1. Yes, proceed
2. No, cancel
> 1

Please confirm your choice:
```

ccremote detects:
- Question: "This operation requires approval"
- Options: "Yes, proceed" / "No, cancel"
- Current selection: Option 1
- Waiting for user confirmation

### Task Completion Detection
```
File analysis complete. Found 15 issues that need attention.

Summary:
- 8 type errors fixed
- 3 performance optimizations applied
- 4 code style improvements made

>
```

ccremote detects:
- Task finished: "complete", "Summary"
- Command prompt visible: `> `
- No processing indicators present
- Session idle for 10+ seconds

## Monitoring Configuration

### Polling Interval

Control how often ccremote checks session output:

```bash
# Check every 2 seconds (default)
CCREMOTE_MONITORING_INTERVAL=2000

# More frequent (1 second) - higher resource usage
CCREMOTE_MONITORING_INTERVAL=1000

# Less frequent (5 seconds) - lower resource usage  
CCREMOTE_MONITORING_INTERVAL=5000
```

**Considerations**:
- **Shorter intervals**: Faster detection, higher resource usage
- **Longer intervals**: Slower detection, lower resource usage
- **Recommended**: 1-3 seconds for most use cases

### Error Handling

Configure how ccremote handles monitoring errors:

```bash
# Maximum retry attempts (default: 3)
CCREMOTE_MAX_RETRIES=5

# Auto-restart monitoring after failures (default: true)
CCREMOTE_AUTO_RESTART=false
```

### Multiple Sessions

ccremote can monitor multiple sessions simultaneously:

```bash
# Start multiple sessions
ccremote start --name project-a
ccremote start --name project-b
ccremote start --name client-work

# Each session is monitored independently
ccremote list
```

Each session:
- Has its own monitoring process
- Sends separate Discord notifications
- Maintains independent state tracking
- Can be stopped/started individually

## Session Lifecycle

### Starting a Session

When you run `ccremote start`:

1. **tmux Creation**: Creates new tmux session with unique name
2. **Claude Code Launch**: Starts Claude Code inside the tmux session
3. **State Initialization**: Initializes session state as "active"
4. **Monitoring Start**: Begins polling session output
5. **User Attachment**: Automatically attaches you to the session

### During Monitoring

While monitoring is active:

1. **Output Capture**: Captures all tmux session output
2. **Pattern Analysis**: Analyzes output against known patterns
3. **State Updates**: Updates session state based on detected patterns
4. **Notifications**: Sends Discord notifications for important events
5. **Action Triggers**: Performs automatic actions (like continuing sessions)

### Session End

When a session ends:

1. **End Detection**: Detects session termination or crash
2. **Final Notification**: Sends Discord notification about session end
3. **State Cleanup**: Updates session state to "ended"
4. **Monitoring Stop**: Stops polling for that session
5. **Resource Cleanup**: Cleans up monitoring resources

## Monitoring Output Examples

### Normal Session Output
```
[ccremote] Session: ccremote-1 (my-project)
[ccremote] Status: active
[ccremote] Monitoring: ✓ Running
[ccremote] Last check: 2025-01-20 10:30:15
```

### Usage Limit Detected
```
[ccremote] Session: ccremote-1 (my-project)  
[ccremote] Status: waiting_limit_reset
[ccremote] Limit detected at: 2025-01-20 10:30:00
[ccremote] Reset expected: 2025-01-20 15:30:00
[ccremote] Discord notification: ✓ Sent
```

### Approval Required
```
[ccremote] Session: ccremote-1 (my-project)
[ccremote] Status: waiting_approval  
[ccremote] Approval detected at: 2025-01-20 10:30:00
[ccremote] Question: "Do you want to continue?"
[ccremote] Discord notification: ✓ Sent
```

## Advanced Monitoring

### Custom Patterns

For advanced users, ccremote supports custom pattern detection:

```bash
# Add custom patterns for specific use cases
CCREMOTE_CUSTOM_PATTERNS="error:|warning:|custom_trigger"
```

### Logging

Enable detailed logging for troubleshooting:

```bash
# Enable debug logging
export DEBUG=ccremote:*
ccremote start --name debug-session

# Or use verbose mode
ccremote start --name test --verbose
```

### Webhook Integration

Send notifications to custom webhooks instead of Discord:

```bash
CCREMOTE_WEBHOOK_URL=https://your-webhook-url.com/notify
```

## Performance Considerations

### Resource Usage

Monitoring consumes some system resources:
- **CPU**: Minimal (regex pattern matching)
- **Memory**: ~10-20MB per monitored session
- **Network**: Only for Discord notifications
- **Disk**: Session state files in `.ccremote/`

### Optimization Tips

1. **Adjust polling interval**: Balance responsiveness vs resource usage
2. **Limit concurrent sessions**: More sessions = more resource usage
3. **Use efficient patterns**: Custom patterns should be optimized
4. **Monitor system load**: Check if monitoring affects performance

### Scaling

ccremote can handle multiple sessions efficiently:
- **Recommended**: Up to 10 concurrent sessions per user
- **Maximum tested**: 25+ sessions (depends on system resources)
- **Best practice**: Stop unused sessions to free resources

## Troubleshooting Monitoring

### Monitoring Not Working

1. **Check session exists**: `ccremote list` to verify session
2. **Verify tmux access**: `tmux list-sessions` should show session
3. **Test pattern detection**: Check logs for pattern matches
4. **Restart monitoring**: Stop and start session to reset monitoring

### Missing Notifications

1. **Test Discord connection**: `ccremote test-discord`
2. **Check notification settings**: Verify bot permissions
3. **Review patterns**: Make sure detected patterns trigger notifications
4. **Check session state**: Session must be in correct state for notifications

### Performance Issues

1. **Reduce polling frequency**: Increase `CCREMOTE_MONITORING_INTERVAL`
2. **Limit sessions**: Stop unused sessions to free resources
3. **Check system load**: Monitor CPU/memory usage during operation
4. **Optimize patterns**: Simplify custom patterns if used

### Pattern Detection Issues

1. **Enable debug logging**: See exactly what patterns are detected
2. **Check session output**: Manually verify the output contains expected patterns
3. **Test patterns**: Use regex tools to test pattern matching
4. **Update patterns**: ccremote patterns may need updates for new Claude Code versions

## Next Steps

Now that you understand monitoring:

1. **[Commands Reference](./commands.md)** - Complete command reference
2. **[Troubleshooting](./troubleshooting.md)** - Solve common issues
3. **[Configuration](./configuration.md)** - Customize monitoring behavior

For advanced monitoring setups, see the [GitHub repository](https://github.com/generativereality/ccremote) for additional configuration options.