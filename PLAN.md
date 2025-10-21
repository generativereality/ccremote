# ccremote Development Plan

## Overview

ccremote is a CLI tool that provides remote control for Claude Code sessions with Discord integration. It monitors Claude Code sessions via tmux, automatically continues them when usage limits reset, and provides Discord notifications for session events and approval requests.

**Current Status:** v0.2.0 released with task completion detection, Discord output viewing, enhanced cleanup, and quota scheduling working in production.

---

## Current Release: v0.2.0 - Enhanced Monitoring & Cleanup
**Target: October 2025**

### Implemented Features

#### 1. Task Completion Detection ✅
**Status: Released**

Get notifications when Claude finishes tasks and stops processing.

**Implementation:**
- Idle detection: no output changes for 10+ seconds
- Smart pattern matching for Claude's waiting-for-input state
- New notification type: `task_completed`
- 5-minute cooldown to prevent spam

**Code:**
- `src/core/monitor.ts`: Lines 293-379 (checkTaskCompletion, handleTaskCompletion)
- Pattern detection with `waitingForInput` and `notProcessing` patterns
- Integrated with existing monitoring loop

#### 2. Tmux Output Display ("Screenshots") ✅
**Status: Released**

View current tmux session content in Discord as text.

**Implementation:**
- Discord command: `/output`
- Monospaced formatting using Discord code blocks
- Smart message splitting for long output (Discord 2000 char limit)
- Last 50 lines context with cleaned output

**Code:**
- `src/core/discord.ts`: Lines 182-600
- `handleOutput()` method with session validation
- `formatOutputForDiscord()` with intelligent chunking
- Complete test coverage for edge cases

#### 3. Enhanced Session Cleanup ✅
**Status: Released**

Properly archive Discord channels for ended sessions and detect orphaned channels.

**Implementation:**
- Extended `ccremote clean` command
- Archive Discord channels with "archived-" prefix
- Remove send permissions but preserve read access for history
- Orphaned channel detection and cleanup
- Channel-session mapping cleanup

**Code:**
- `src/core/discord.ts`: Lines 451-712
- `cleanupSessionChannel()` for normal cleanup
- `findOrphanedChannels()` and `archiveOrphanedChannel()` for orphans
- Integrated permission management

#### 4. Quota Scheduling (from v0.3.0) ✅
**Status: Released Early**

Daily quota window alignment with early dummy commands.

**Implementation:**
- `ccremote schedule --time "5:00"` command
- Automatic daily recurrence at specified time
- Smart staging (command typed 5s after start, executed at scheduled time)
- Discord notifications for quota window start

**Code:**
- `src/commands/schedule.ts`: Complete implementation
- `src/core/monitor.ts`: Lines 170-195, 876-933 for execution logic
- `src/utils/quota.ts`: Message generation

---

## Technical Considerations

### Implemented Architecture (v0.1.0-v0.2.0)

**Smart Polling System:**
- Uses polling instead of timers for sleep/wake cycle reliability
- Dynamic intervals: 2s (default), faster near quota reset times
- Self-correcting and platform-independent
- Zero external scheduling dependencies

**Pattern Detection:**
- Comprehensive approval dialog detection with color validation
- Usage limit detection with terminal state validation
- Task completion via idle detection (10s idle threshold)
- Prevents false positives from pasted text and session lists

**Discord Integration:**
- Graceful degradation when Discord unavailable
- Automatic retry with exponential backoff
- Health check system with reconnection
- Channel lifecycle management (create → active → archived)

### Security Model (Current & Planned)

**Current Security (v0.2.0):**
- Channel-based authorization for all Discord commands
- User whitelist for session access
- No sensitive data in Discord messages
- Session state isolation

**Planned Security (v0.3.0):**
- Command execution whitelist (no dangerous commands)
- Per-user rate limiting (5 commands/minute)
- Comprehensive audit logging
- Command sanitization and validation

---

## Future Roadmap

### v0.3.0 - Queue Watcher & Project Automation
**Target: Q1 2026**
**Priority: High**

### Queue-Based Session Orchestration

Transform ccremote into a generic queue watcher that automatically spawns Claude Code sessions to process items in a `_q/` folder structure.

**Use Case:** Any project that needs automated async Claude processing based on a simple queue system.

#### Core Features

**1. Queue Folder Monitoring**
- Watch `_q/high/`, `_q/medium/`, `_q/low/` folders in project directory (CWD)
- Support both files (.md) and folders (for multi-file items like transaction exports)
- Priority-based processing schedules:
  - High: Every 10 seconds
  - Medium: Every 1 minute
  - Low: Every 15 minutes

**2. Automatic Session Spawning**
- Spawn Claude Code sessions with custom prompts describing queue contents
- Use `--permission-mode acceptEdits` flag
- Session naming: `q-{priority}-{timestamp}`
- Discord integration for session tracking

**3. HTTP API (Fastify)**
- `POST /queue` - Create queue items (for Custom GPTs, webhooks)
- `GET /queue/status` - Get item counts per priority
- `GET /queue/items/:priority` - List items in priority folder
- Bearer token authentication via env var
- Customizable port (default: 3000)

**4. Queue Monitoring**
- Session timeout detection (default: 10 minutes)
- High-priority backlog alerts (>10 items)
- Discord notifications for queue status

#### New Commands

```bash
# Start queue watcher in current directory
ccremote watch

# Check queue status
ccremote queue status

# Manually trigger processing
ccremote queue process high

# Monitor sessions + queue backlog  
ccremote monitor
```

#### Implementation Details

**New Files:**
- `src/managers/QueueManager.ts` - Queue watcher logic
- `src/managers/QueueMonitor.ts` - Backlog & timeout monitoring
- `src/api/server.ts` - Fastify HTTP API
- `src/commands/watch.ts` - Watch command
- `src/commands/queue.ts` - Queue status/process commands
- `src/commands/monitor.ts` - Monitoring command

**Key Principles:**
- Works with any project that has `_q/` folder structure
- Claude discovers CLAUDE.md naturally (no --prompt-file flag)
- Custom prompts describe queue contents dynamically
- CWD-based operation (no configuration needed for project path)

**Integration Points:**
- Extends existing SessionManager for spawning
- Uses existing Discord bot for notifications
- Builds on current tmux integration
- Compatible with quota scheduling system

#### Example Workflow

User drops files into queue:
```
my-project/
├── _q/
│   ├── high/
│   │   └── urgent-task.md
│   ├── medium/
│   │   ├── voice-memo-transcription.md
│   │   └── photo-batch/  (folder with multiple files)
│   └── low/
│       └── transactions-export/
├── CLAUDE.md
└── ... other project files
```

ccremote spawns sessions:
```
claude "You have 1 item in high priority queue:
- 📄 urgent-task.md

Please process according to CLAUDE.md..." --permission-mode acceptEdits
```

Claude processes, moves to `_q/archive/{priority}/`, updates project files.

---

**Dependencies:**
- Fastify (HTTP server)
- yaml (for frontmatter parsing)
- Existing ccremote infrastructure

**Estimated Effort:** 2-3 weeks

**Success Criteria:**
- Queue watcher runs reliably in background
- Sessions spawn on schedule (10s, 1min, 15min)
- HTTP API accepts external queue items
- Discord shows queue processing status
- Works with multiple concurrent projects

---

### v0.4.0 - Enhanced Remote Control & Discord Integration
**Target: Q2 2026**
**Priority: Medium**

Tighter Discord integration with better remote control capabilities for active session management.

#### Core Features

**1. Discord Command Sending**
- `/send <command>` - Send commands directly to Claude Code sessions from Discord
- Session-scoped execution (commands only work in session's Discord channel)
- Basic command validation and user authorization

**2. Rich Discord UI**
- Rich embeds with status colors for different notification types
- Better formatted session status information
- Visual indicators for session state (active/waiting/ended)

**3. Interactive Session Controls**
- Pause/resume sessions via Discord commands
- Restart sessions when needed
- Stop/kill session controls from Discord

**4. Multi-Session Management**
- Single Discord bot managing multiple concurrent sessions
- Dedicated channels per session with clear organization
- Session switching and status overview across all active sessions

#### New Commands

```bash
# Discord commands (in session channel):
/send <command>     # Send command to Claude session
/pause              # Pause session
/resume             # Resume session
/restart            # Restart session
/status             # Get detailed session status
```

#### Implementation Details

**New Files:**
- `src/core/session-controller.ts` - Session control operations (pause/resume/restart)
- Enhanced `src/core/discord.ts` - Rich embeds and new command handlers

**Key Improvements:**
- Better Discord UX with embeds and colors
- Real-time session control from Discord
- Cleaner multi-session management
- More responsive session operations

**Integration Points:**
- Extends existing Discord bot with new commands
- Builds on tmux integration for session control
- Uses existing session state management

---

## Implementation Notes

### Architecture Achievements

**Completed in v0.2.0:**
- Task completion detection fully integrated into `src/core/monitor.ts`
- Output formatting built into `DiscordBot.formatOutputForDiscord()` method
- Discord channel lifecycle management (create → active → archived)
- Orphaned resource detection and cleanup
- Quota scheduling system with daily recurrence

**Current Architecture Strengths:**
- Smart polling system handles sleep/wake cycles reliably
- Graceful degradation when Discord is unavailable
- Comprehensive test coverage for monitoring patterns
- Session state persistence across restarts

**Backward Compatibility:**
- All existing commands and patterns remain unchanged
- New features are additive, not breaking
- Configuration remains backward compatible

