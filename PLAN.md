# 🚀 CCRemote Development Plan

## 📋 **Project Overview**

**CCRemote** is a minimalistic Claude Code remote control package that provides automated continuation and remote approval features via Discord/Slack integration. Built on modern, simple architecture inspired by ccusage, it focuses exclusively on tmux monitoring-based features without dependency on Claude Code hooks or complex integrations.

---

## 🏗️ **Current State Analysis**

### **✅ What We Have:**
- **Prototyped Features**: Auto-continuation and remote approvals working with tmux monitoring
- **Clean Structure**: ccusage-based architecture with TypeScript, Gunshi CLI, modern build tools
- **Working Demos**: Features implemented in `features/` directory

### **❌ What Claude-Code-Remote Analysis Revealed:**
- **Too bloated**: Unnecessary integrations (email, Line, complex hooks)
- **Hook dependency issues**: Cumbersome to configure, unreliable
- **Over-engineered**: Multiple notification channels, complex state management
- **Not our use case**: Features we don't need (email workflows, complex scheduling)

### **✅ Our Simplified Approach:**
- **Discord/Slack first**: Start with Discord, add Slack support later
- **Tmux-only monitoring**: No hook dependencies, just tmux pane monitoring
- **Minimal features**: Auto-continuation, remote approvals, early window scheduling
- **Simple scheduler**: Basic polling with smart intervals, no complex alarm systems
- **ccusage-inspired structure**: Clean TypeScript, modern tooling, simple architecture

---

## 🎯 **Target Architecture**

### **Updated Package Structure:**
```
ccremote/
├── src/
│   ├── commands/
│   │   ├── index.ts              # Main CLI entry point
│   │   ├── start.ts              # Start new session (replaces claude code)
│   │   ├── list.ts               # List active sessions
│   │   ├── stop.ts               # Stop session
│   │   └── status.ts             # Show session status
│   ├── core/
│   │   ├── session.ts            # Session management & state
│   │   ├── tmux.ts               # Tmux monitoring & command injection
│   │   ├── discord.ts            # Discord bot connection & handlers
│   │   ├── monitor.ts            # Auto-continuation & approval monitoring
│   │   └── parser.ts             # Time/pattern parsing utilities
│   ├── types/
│   │   └── index.ts              # TypeScript type definitions
│   └── index.ts                  # Package exports
├── website/                     # Simple documentation site
│   ├── index.html              # Landing page
│   ├── setup.html              # Setup guide
│   └── examples.html           # Usage examples
├── package.json                # Package metadata
└── README.md                   # Main documentation
```

### **Tech Stack (Inherited from ccusage):**
- **TypeScript**: Modern type-safe development
- **Gunshi**: CLI framework for command handling
- **Bun**: Fast package manager and runtime
- **Zod**: Runtime type validation
- **tsdown**: TypeScript compilation
- **ESLint**: Code quality and formatting

---

## 🔧 **Core Features (Simplified)**

### **1. ccremote as Claude Code Replacement**

**Purpose**: Replace `claude` command with `ccremote` that sets up monitored tmux sessions with Discord integration.

**Implementation:**
```typescript
// src/commands/start.ts
export const startCommand = {
  name: 'start',
  description: 'Start monitored Claude Code session',
  options: {
    name: { type: 'string', description: 'Session name (auto-generated if not provided)' },
    channel: { type: 'string', description: 'Discord channel ID (optional)' }
  }
}
```

**Usage Examples:**
```bash
# Replace: claude code
ccremote start

# Named session
ccremote start --name my-session

# Specific Discord channel
ccremote start --name my-session --channel 123456789
```

**Key Components:**
- **Simple Tmux Monitoring**: Basic pane capture and pattern detection
- **Event-based Scheduling**: "Execute once at X, latest by Y" - handles sleep/wake robustly
- **Discord Bot Integration**: Real-time notifications and interactive responses
- **Basic State Management**: Simple cooldown and spam prevention

---

## ⏰ **Scheduling System**

Smart polling approach is used for reliability across laptop sleep/wake cycles. See **[docs/SCHEDULING.md](docs/SCHEDULING.md)** for detailed scheduling system design and implementation rationale.

### **2. Early Window Scheduling**

**Purpose**: Schedule a dummy command early (3-5am) to start the first 5-hour window earlier, optimizing daily usage windows.

**Implementation:**
```typescript
// src/commands/schedule.ts  
export const scheduleCommand = {
  name: 'schedule',
  description: 'Schedule early window start (3am, 8am, 1pm, 6pm pattern)',
  options: {
    time: { type: 'string', default: '04:00' },
    session: { type: 'string', default: 'claude' }
  }
}
```

**Key Components:**
- **Simple Cron-like Scheduler**: Basic time-based execution
- **Dummy Command Injection**: Send harmless command to start window
- **Window Optimization**: 5am→10am→3pm→8pm daily pattern

---

## 🤖 **Discord Bot Integration**

### **Bot Architecture:**
```typescript
type SessionNotification = {
  sessionId: string
  sessionName: string
  channelId: string
  type: 'limit' | 'continued' | 'approval'
  message: string
  metadata?: {
    resetTime?: string
    command?: string
  }
}
```

### **Discord Bot Implementation:**
- **Token-based**: Discord bot connects via `DISCORD_BOT_TOKEN`
- **Persistent Connection**: Listens for messages, can respond immediately
- **Channel per Session**: Each ccremote session gets its own Discord channel
- **Interactive Commands**: `approve`, `deny`, `status` within each channel

### **Session Management:**
```typescript
type SessionState = {
  id: string
  name: string
  tmuxSession: string
  channelId: string
  status: 'active' | 'waiting' | 'error'
  lastActivity: string
}
```

### **Security Model:**
- **Private Channels Only**: Bot only works in private channels/DMs
- **Authorized Users**: Only bot owner and invited users can control sessions
- **Channel Isolation**: Each session responds only to its designated channel
- **Command Validation**: Verify user permissions before executing commands

---

## 🔒 **Security & Access Control**

### **Bot Security Strategy:**
```typescript
type AuthConfig = {
  ownerId: string                    // Primary bot owner (from DISCORD_OWNER_ID)
  authorizedUsers: string[]          // Additional authorized user IDs
  authorizedChannels: string[]       // Allowed channel IDs
  requirePrivateChannel: boolean     // Only work in private channels
}
```

### **Access Control Levels:**
1. **Bot Owner**: Full access, can authorize others
2. **Authorized Users**: Can create/control sessions in allowed channels
3. **Channel Members**: Can view session status (read-only)
4. **Everyone Else**: No access

### **Security Implementation:**
- **User ID Validation**: Check `message.author.id` against authorized list
- **Channel Type Check**: Reject commands from public channels (optional setting)
- **Session Ownership**: Users can only control sessions they created
- **Command Rate Limiting**: Prevent spam/abuse
- **Audit Logging**: Log all commands with user ID and timestamp

### **Setup Security:**
```bash
# Required: Bot owner Discord user ID
DISCORD_OWNER_ID=your_discord_user_id

# Optional: Additional authorized users
DISCORD_AUTHORIZED_USERS=user1,user2,user3

# Optional: Restrict to private channels only
REQUIRE_PRIVATE_CHANNELS=true
```

### **Team Collaboration:**
- **Invite Colleagues**: Add their Discord user IDs to authorized list
- **Shared Channels**: Create private channels for team projects
- **Session Sharing**: Team members can view status but not control others' sessions
- **Override Mode**: Owner can control any session for emergencies

---

## 📦 **Minimal Configuration**

### **Environment Variables (.env):**
```bash
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_OWNER_ID=your_discord_user_id    # For security validation

# Optional: Default channel for new sessions
DISCORD_DEFAULT_CHANNEL=channel_id
```

### **Session Storage (.ccremote/sessions.json):**
```json
{
  "ccremote-1": {
    "id": "ccremote-1",
    "name": "my-session",
    "tmuxSession": "ccremote-1",
    "channelId": "123456789",
    "status": "active",
    "created": "2025-01-15T10:30:00Z",
    "lastActivity": "2025-01-15T11:45:00Z"
  }
}
```

### **Simple Configuration:**
- Minimal environment setup
- Local JSON file for session tracking
- Auto-generated session names (ccremote-1, ccremote-2, etc.)
- Easy cleanup and session management

---

## 🚧 **Implementation Plan**

Detailed engineering implementation plan with specific steps, file structure, and timelines available in **[docs/ENGINEERING-PLAN.md](docs/ENGINEERING-PLAN.md)**.

### **Summary Timeline:**
- **Phase 1**: Project setup, session management, Discord bot ⏱️ 3 days
- **Phase 2**: Smart polling monitor, auto-continuation, approvals ⏱️ 3.5 days  
- **Phase 3**: Integration, testing, edge cases ⏱️ 2 days
- **Phase 4**: Build, package, deployment preparation ⏱️ 0.5 days

**Total Estimated Time: 8-10 days**

---

## 📋 **Development Approach**

### **Start Fresh, Learn from ccusage:**
- [ ] New repository with clean ccusage-inspired structure
- [ ] Modern TypeScript setup (tsdown, Gunshi CLI)
- [ ] Copy working proof-of-concept logic directly
- [ ] Focus on getting basic features working first

### **Key Principles:**
- **Simplicity over features**: Only what we actually need
- **Working over perfect**: Get it functional, then polish
- **Proven patterns**: Use what worked in the proof of concepts
- **No premature optimization**: Basic polling is fine for now

### **Avoid ccusage Pitfalls:**
- ❌ Don't copy cost analysis or usage tracking
- ❌ Don't build MCP servers or complex APIs
- ❌ Don't over-engineer the configuration system
- ✅ Keep the modern tooling and project structure
- ✅ Use the CLI framework and TypeScript setup

---

## 🎯 **Success Criteria**

### **Functional Requirements:**
- ✅ **Auto-continuation**: Reliably detects usage limits and continues sessions
- ✅ **Remote approval**: Secure approval workflow via Discord
- ✅ **Cross-platform**: Works on macOS, Linux, Windows (with tmux)
- ✅ **Configuration**: Simple setup with environment variables
- ✅ **Documentation**: Clear installation and usage instructions

### **Quality Requirements:**
- ✅ **Type Safety**: Full TypeScript coverage with Zod validation
- ✅ **Error Handling**: Graceful failures and informative error messages  
- ✅ **Performance**: Efficient polling, minimal resource usage
- ✅ **Security**: Secure Discord integration, approval safeguards
- ✅ **Maintainability**: Clean code structure, comprehensive tests

### **Distribution Requirements:**
- ✅ **NPM Package**: Published and installable via `npm install -g ccremote`
- ✅ **Domain**: ccremote.dev with documentation and examples
- ✅ **CLI Usage**: `bunx ccremote` for quick execution
- ✅ **GitHub**: Open source repository with releases

---

## 🌟 **Future Enhancements** (Post-MVP)

### **Platform Expansion:**
- **Slack Support**: Same webhook approach as Discord
- **Multiple Sessions**: Support monitoring multiple tmux sessions
- **Better Scheduling**: More sophisticated early window scheduling

### **Quality of Life:**
- **Web Interface**: Simple status page (maybe)
- **Better Error Handling**: More robust failure recovery
- **Configuration UI**: Simple setup wizard (maybe)

### **Advanced Features (Maybe):**
- **Multi-user**: Team approval workflows
- **Custom Commands**: User-defined automation
- **Integration**: VS Code extension or shell integration

### **Website & Documentation:**
- **ccremote.dev**: Simple landing page with setup guide
- **Interactive Examples**: Copy-paste setup instructions
- **Usage Patterns**: Common workflow documentation
- **Similar to**: CC Remote's readme style but as a website

---

## 🌐 **Simple Website Plan (ccremote.dev)**

### **Website Structure (Similar to CC Remote Style):**
```
ccremote.dev/
├── index.html              # Landing page with hero, features, quick start
├── setup.html              # Step-by-step setup guide  
├── examples.html           # Usage examples and workflows
├── css/
│   └── style.css           # Simple, clean styling
└── js/
    └── main.js             # Basic interactivity (copy buttons, etc.)
```

### **Content Strategy:**
- **Hero Section**: "Remote Claude Code Control Made Simple"
- **Feature Highlights**: Session management, Auto-continuation, Remote approvals, Early scheduling
- **Quick Start**: `npm install -g ccremote` → setup Discord bot → `ccremote start`
- **Setup Guide**: Discord bot creation, token setup, channel creation, first session
- **Examples**: Multi-session workflows, team collaboration, troubleshooting

### **Key Usage Examples:**
```bash
# Instead of: claude code
ccremote start

# Named project session
ccremote start --name my-app

# Check what's running
ccremote list

# Get session details
ccremote status my-app
```

### **Design Approach:**
- **Clean & minimal**: Similar to CC Remote readme but as a proper website
- **Copy-paste friendly**: Easy to select commands and config examples
- **Mobile responsive**: Works well on phones for reference
- **No complexity**: Static HTML/CSS/JS, no frameworks needed

---

**🎉 End Goal**: A production-ready, minimalistic package that makes Claude Code usage seamless for remote developers, with automatic continuation and secure remote approvals via Discord/Slack.
