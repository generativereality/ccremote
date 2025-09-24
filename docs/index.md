---
layout: home

hero:
  name: ccremote
  text: Claude Code Remote
  tagline: Remote approvals (Discord), quota-aware auto-continuation, and quota scheduling
  image:
    src: /logo.svg
    alt: ccremote logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/generativereality/ccremote

features:
  - icon: 💬
    title: Remote approvals
    details: Approve Claude Code prompts (file edits, shell commands) from Discord, so sessions don't stall when you're away.
    link: /guide/discord-setup
  - icon: 🔄
    title: Quota-aware continuation
    details: Detect when a session stops due to quota limits, wait until the 5-hour window resets, then automatically continue.
    link: /guide/monitoring
  - icon: ⏰
    title: Quota scheduling
    details: Schedule an early dummy command (e.g. 5 AM) so quota windows align with your workday → effectively 3 usable windows instead of 2.
    link: /guide/commands
  - icon: 🖥️
    title: Tmux Integration
    details: Seamless tmux session management with proper cleanup and easy attachment
  - icon: 🎯
    title: Pattern Detection
    details: Intelligent detection of usage limits, errors, approval dialogs, and continuation opportunities
  - icon: ⚡
    title: Smart Polling
    details: Efficient monitoring with configurable intervals and retry logic to minimize resource usage
  - icon: 🔒
    title: Secure Configuration
    details: Environment-based configuration with support for project-specific and global settings
    link: /guide/configuration
  - icon: 🚀
    title: Quick Setup
    details: Interactive initialization guide helps you set up Discord bot and configuration in minutes
    link: /guide/quick-start
  - icon: 💡
    title: Approval Workflow
    details: Handles Claude Code approval dialogs by notifying you via Discord when user input is needed
---

## How It Works

ccremote monitors your Claude Code sessions and takes action automatically:

1. **Smart Monitoring**: Polls your tmux session every 2 seconds, analyzing output for Claude Code patterns
2. **Usage Limit Detection**: Recognizes when Claude Code hits usage limits and tracks reset times
3. **Auto-Continuation**: Waits for limits to reset (typically 5 hours) and automatically continues your session
4. **Discord Notifications**: Sends real-time updates about session status, limits, and approval requests
5. **Approval Handling**: Detects when Claude Code needs user input and notifies you via Discord

## Quick Start

```bash
# Install globally
npm install -g ccremote

# Interactive setup
ccremote init

# Start a monitored Claude Code session
ccremote
```

That's it! You'll be automatically attached to a Claude Code session with monitoring active.

## Why ccremote?

- **Never lose progress**: Your Claude Code sessions continue automatically when limits reset
- **Stay informed**: Get Discord notifications about session status wherever you are  
- **Save time**: No more manually checking if your session can continue
- **Multiple sessions**: Monitor and manage multiple projects simultaneously
- **Privacy focused**: Each user creates their own Discord bot for complete privacy