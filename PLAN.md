# ccremote Development Plan

## Overview

ccremote is a CLI tool that provides remote control for Claude Code sessions with Discord integration. It monitors Claude Code sessions via tmux, automatically continues them when usage limits reset, and provides Discord notifications for session events and approval requests.

**Current Status:** v0.1.0 released with core monitoring, auto-continuation, and Discord approval system working in production.

---

## Next Release: v0.2.0 - Remote Control Features

### Planned Features

#### 1. Discord-to-Claude Command System
**Priority: High**

Send commands from Discord directly to Claude Code sessions.

**Implementation:**
- New Discord command: `/send <command>`
- Security-first design with command validation whitelist
- Rate limiting (5 commands/minute per user)
- Full audit logging for all executed commands
- Session-scoped execution (commands only work in session's Discord channel)

**Security Considerations:**
- Whitelist approach: only safe commands allowed (no `rm`, `sudo`, etc.)
- Authorization: only authorized users in session-specific channels
- Command sanitization and validation before execution

#### 2. Task Completion Detection
**Priority: Medium**

Get notifications when Claude finishes tasks and stops processing.

**Implementation:**
- Idle detection: no output changes for 10+ seconds
- Smart pattern matching for Claude's waiting-for-input state
- New notification type: `task_completed`
- Debounced notifications to prevent spam

**Integration:**
- Extends existing monitoring system in `src/core/monitor.ts`
- Uses established Discord notification patterns

#### 3. Tmux Output Display ("Screenshots")
**Priority: Medium**

View current tmux session content in Discord as text.

**Implementation:**
- New Discord command: `/output` or `/screenshot`
- Monospaced formatting using Discord code blocks
- Smart message splitting for long output (Discord 2000 char limit)
- Configurable context (default: last 50 lines)

**Technical Approach:**
- Leverages existing `tmux.capturePane()` functionality
- Formats output with triple backticks for readability

#### 4. Enhanced Session Cleanup
**Priority: Low**

Improve the cleanup process to properly archive Discord channels for ended sessions.

**Implementation:**
- Extend existing `ccremote clean` command
- Archive Discord channels instead of leaving them orphaned
- Rename channels with "archived-" prefix
- Remove send permissions but preserve read access for history
- Clean up channel-session mappings

**Integration:**
- Enhances existing cleanup in `DiscordBot.cleanupSessionChannel()`
- Extends `ccremote clean` command functionality

---

## Technical Considerations

### Smart Polling Architecture

The monitoring system uses intelligent polling rather than timer-based scheduling to handle laptop sleep/wake cycles reliably:

**Why Polling Over Timers:**
- `setTimeout()` breaks on laptop sleep (timers fire late or not at all)
- Node.js scheduling libraries have sleep/wake drift issues
- Polling is self-correcting and sleep-robust

**Dynamic Polling Intervals:**
- 30 seconds: Normal monitoring (low CPU usage)
- 5 seconds: When reset time approaches
- 1 second: Final moments before reset

This approach provides reliability across all platforms without external dependencies.

### Security Model

**Command Execution Security:**
- Whitelist-only command validation
- Per-user rate limiting
- Session isolation (commands bound to Discord channels)
- Comprehensive audit logging

**Discord Integration Security:**
- Channel-based authorization (existing pattern)
- No sensitive data in Discord messages
- Session state isolation

---

## Future Roadmap

### v0.3.0 - Smart Scheduling
**Target: Q2 2024**

- Early window scheduling (3-5am commands to optimize usage windows)
- 5-hour window pattern optimization (5am→10am→3pm→8pm)
- Sleep/wake robust scheduling system
- Smart retry logic with exponential backoff

### v0.4.0 - Enhanced Discord Integration
**Target: Q3 2024**

- Rich Discord embeds with status colors
- Interactive session management via Discord
- Multi-session support through single Discord bot
- Customizable notification preferences

### v0.5.0 - Session Management
**Target: Q4 2024**

- Session templates and presets
- Advanced logging and session history
- Session sharing and collaboration features
- Integration with other development tools

---

## Implementation Notes

### New Components Required

1. **CommandValidator** (`src/security/command-validator.ts`)
   - Command whitelist management
   - Rate limiting implementation
   - Security validation and sanitization

2. **TaskCompletionDetector** (extend existing `src/core/monitor.ts`)
   - Idle detection patterns
   - Completion state recognition
   - Notification debouncing

3. **OutputFormatter** (`src/utils/output-formatter.ts`)
   - Discord message formatting
   - Message length handling
   - Monospace code block generation

### Integration Strategy

- Extend existing `DiscordBot` message handling
- Add new notification types to existing system
- Leverage current tmux integration
- Maintain backward compatibility

This plan focuses on enhancing remote control capabilities while maintaining the robust foundation established in v0.1.0.