# Changelog

All notable changes to ccremote will be documented in this file.

## [v0.2.0] - Planned

### Added
- **Discord Command System**: Send commands directly to Claude Code sessions from Discord (`/send <command>`)
- **Task Completion Detection**: Get notifications when Claude finishes tasks and stops processing
- **Tmux Output Display**: View current session content in Discord as formatted text ("screenshots")
- **Security Framework**: Command validation, rate limiting, and audit logging for remote commands

### Enhanced
- **Monitoring System**: Extended with idle detection and completion patterns
- **Discord Integration**: New command handlers and output formatting capabilities

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