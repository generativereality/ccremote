# Changelog

All notable changes to ccremote will be documented in this file.

## [v0.2.0] - 2024-09-30

### Added
- **Task Completion Detection**: Get notifications when Claude finishes tasks and is ready for new input (10-second idle detection with 5-minute cooldown)
- **Discord Output Command**: View current session output in Discord with `/output` command (last 50 lines, formatted in code blocks, smart chunking for long output)
- **Orphaned Channel Cleanup**: Automatic cleanup of Discord channels that exist but aren't connected to any active session

### Enhanced
- **Monitoring System**: Extended with idle detection patterns and task completion notification logic
- **Discord Integration**: New `/output` command handler with smart formatting and message chunking capabilities
- **Session Cleanup**: Enhanced `ccremote clean` command now also finds and archives orphaned Discord channels
- **Pattern Detection**: Improved regex patterns for detecting when Claude is waiting for input vs actively processing

### Technical Improvements
- **Error Handling**: Improved error handling for Discord bot failures and graceful degradation when Discord is unavailable
- **Code Quality**: Enhanced type safety and pattern matching for monitoring system

## [v0.1.0] - 2024-01-XX

### Added
- **Core Monitoring System**: Automated tmux session monitoring with smart polling
- **Auto-Continuation**: Automatic session resumption when Claude Code usage limits reset
- **Discord Integration**: Real-time notifications via private Discord bot
- **Remote Approvals**: Handle Claude Code approval dialogs remotely through Discord
- **Session Management**: Complete session lifecycle with persistent state
- **Interactive Setup**: `ccremote init` command with Discord bot configuration guidance
- **Multi-Level Configuration**: Environment variables, dotenv files, and interactive prompts
- **Cross-Platform Support**: Works on macOS, Linux, and Windows (with WSL/tmux)

### CLI Commands
- `ccremote init` - Interactive Discord bot setup
- `ccremote start` - Start monitored Claude Code session (default command)
- `ccremote stop` - Stop session monitoring
- `ccremote list` - List active sessions
- `ccremote status` - Show session status
- `ccremote schedule` - Schedule daily quota window alignment (e.g., 5 AM)
- `ccremote resume` - Resume existing sessions
- `ccremote clean` - Clean up old session files
- `ccremote setup-tmux` - Configure tmux settings for ccremote

### Technical Features
- **Smart Polling**: Sleep/wake cycle robust monitoring with dynamic intervals
- **Pattern Detection**: Advanced regex patterns for limit detection and approval dialogs
- **Channel Management**: Dedicated Discord channels per session with intelligent reuse
- **Error Handling**: Graceful failure recovery and informative error messages
- **Background Operation**: Clean tmux session management with log file output