# 🔧 **CCRemote Engineering Implementation Plan**

## **Project Structure Setup**

### **1. Initialize Project** ⏱️ 0.5 days
```bash
# Create clean project structure inspired by ccusage
mkdir ccremote && cd ccremote
npm init
```

#### **Package.json Configuration:**
```json
{
  "name": "ccremote",
  "type": "module",
  "bin": {
    "ccremote": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsdown",
    "dev": "tsx src/cli.ts",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit"
  }
}
```

#### **Dependencies:**
```bash
# Core dependencies
npm install discord.js zod

# Dev dependencies  
npm install -D typescript @types/node tsdown tsx eslint
```

#### **TypeScript Config (tsconfig.json):**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

---

## **Core Implementation**

### **2. Session Management** ⏱️ 1 day

#### **Session State Storage:**
```typescript
// src/core/session.ts
interface SessionState {
  id: string
  name: string
  tmuxSession: string
  channelId: string
  status: 'active' | 'waiting' | 'error'
  created: string
  lastActivity: string
}

class SessionManager {
  private sessionsFile = '.ccremote/sessions.json'
  
  async createSession(name?: string, channelId?: string): Promise<SessionState>
  async listSessions(): Promise<SessionState[]>
  async getSession(id: string): Promise<SessionState | null>
  async updateSession(id: string, updates: Partial<SessionState>): Promise<void>
  async deleteSession(id: string): Promise<void>
}
```

#### **Tmux Integration:**
```typescript
// src/core/tmux.ts
class TmuxManager {
  async createSession(sessionName: string): Promise<void>
  async capturePane(sessionName: string): Promise<string>
  async sendKeys(sessionName: string, keys: string): Promise<void>
  async sessionExists(sessionName: string): Promise<boolean>
  async killSession(sessionName: string): Promise<void>
}
```

### **3. Discord Bot** ⏱️ 1 day

#### **Bot Setup:**
```typescript
// src/core/discord.ts
import { Client, GatewayIntentBits } from 'discord.js'

class DiscordBot {
  private client: Client
  private authorizedUsers: string[]
  private ownerId: string
  
  async start(token: string): Promise<void>
  async sendNotification(channelId: string, message: string): Promise<void>
  async createPrivateChannel(userId: string): Promise<string>
  private isAuthorized(userId: string): boolean
  private handleMessage(message: Message): Promise<void>
}
```

#### **Message Handlers:**
```typescript
// Handle commands in Discord channels
private async handleMessage(message: Message) {
  if (!this.isAuthorized(message.author.id)) return
  
  const content = message.content.toLowerCase().trim()
  const sessionId = this.getSessionForChannel(message.channel.id)
  
  if (content === 'approve') {
    await this.handleApproval(sessionId, true)
  } else if (content === 'deny') {
    await this.handleApproval(sessionId, false)
  } else if (content === 'status') {
    await this.handleStatus(sessionId)
  }
}
```

### **4. CLI Commands** ⏱️ 1 day

#### **CLI Structure (using Gunshi-style):**
```typescript
// src/cli.ts
import { createCLI } from './lib/cli-framework'

const cli = createCLI({
  name: 'ccremote',
  version: '1.0.0',
  commands: {
    start: () => import('./commands/start.js'),
    list: () => import('./commands/list.js'),
    stop: () => import('./commands/stop.js'),
    status: () => import('./commands/status.js')
  }
})

cli.run()
```

#### **Start Command:**
```typescript
// src/commands/start.ts
export default {
  description: 'Start monitored Claude Code session',
  options: {
    name: { type: 'string', description: 'Session name' },
    channel: { type: 'string', description: 'Discord channel ID' }
  },
  async handler(options) {
    // 1. Create session in session manager
    // 2. Create tmux session
    // 3. Start Claude Code in tmux
    // 4. Create/assign Discord channel
    // 5. Start monitoring loop
  }
}
```

---

## **Monitoring Implementation**

### **5. Smart Polling Monitor** ⏱️ 1.5 days

#### **Monitor Core:**
```typescript
// src/core/monitor.ts
class SessionMonitor {
  private sessions = new Map<string, MonitorState>()
  
  async startMonitoring(sessionId: string): Promise<void> {
    const state = {
      sessionId,
      isRunning: true,
      pollingInterval: 30000,
      lastCheck: Date.now()
    }
    
    this.sessions.set(sessionId, state)
    this.monitorLoop(sessionId)
  }
  
  private async monitorLoop(sessionId: string): Promise<void> {
    // Main monitoring loop with smart polling
    // See docs/SCHEDULING.md for detailed implementation
  }
}
```

#### **Pattern Detection:**
```typescript
// src/core/parser.ts
const LIMIT_PATTERNS = [
  /5-hour limit reached.*resets (\d{1,2}(?::\d{2})?(?:am|pm))/i,
  /usage limit.*resets (\d{1,2}(?::\d{2})?(?:am|pm))/i,
  // More patterns from proof of concept
]

class PatternParser {
  detectLimit(tmuxOutput: string): LimitInfo | null
  detectApproval(tmuxOutput: string): ApprovalInfo | null
  parseResetTime(timeString: string): Date
}
```

### **6. Auto-continuation Logic** ⏱️ 1 day

#### **Continuation Handler:**
```typescript
// Port from docs/working-proof-of-concepts/auto-continuation-daemon.js
class ContinuationHandler {
  async handleLimitDetected(sessionId: string, resetTime: Date): Promise<void> {
    // Try immediate continuation
    const success = await this.attemptContinuation(sessionId)
    
    if (!success) {
      // Schedule for reset time with smart polling
      await this.scheduleContination(sessionId, resetTime)
    }
  }
  
  private async attemptContinuation(sessionId: string): Promise<boolean> {
    // Send 'continue' command to tmux session
    // Check if limit message disappears
    // Return success/failure
  }
}
```

### **7. Remote Approval System** ⏱️ 1 day

#### **Approval Handler:**
```typescript
// Port from docs/working-proof-of-concepts/remote-approval-daemon.js  
class ApprovalHandler {
  private pendingApprovals = new Map<string, ApprovalRequest>()
  
  async handleApprovalRequest(sessionId: string, approvalInfo: ApprovalInfo): Promise<void> {
    // Send Discord notification with approve/deny options
    // Store pending approval state
    // Wait for user response
  }
  
  async processApproval(sessionId: string, approved: boolean): Promise<void> {
    // Send '1' (approve) or '2' (deny) to tmux session
    // Clean up pending approval state
    // Notify user of result
  }
}
```

---

## **Integration & Testing**

### **8. End-to-End Integration** ⏱️ 1 day

#### **Main Application:**
```typescript
// src/app.ts
class CCRemoteApp {
  private sessionManager: SessionManager
  private discordBot: DiscordBot
  private monitor: SessionMonitor
  
  async start(): Promise<void> {
    // Initialize all components
    // Load existing sessions
    // Resume monitoring for active sessions
    // Start Discord bot
  }
}
```

#### **Session Lifecycle:**
```typescript
async startSession(name?: string, channelId?: string) {
  // 1. SessionManager.createSession()
  // 2. TmuxManager.createSession() 
  // 3. Start `claude code` in tmux
  // 4. DiscordBot.setupChannel()
  // 5. SessionMonitor.startMonitoring()
  // 6. Return session info to user
}
```

### **9. Testing & Validation** ⏱️ 1 day

#### **Manual Testing Scenarios:**
- [ ] Create session with `ccremote start`
- [ ] Trigger usage limit in Claude Code
- [ ] Verify Discord notification sent
- [ ] Test auto-continuation after reset time
- [ ] Test approval workflow (dangerous command)
- [ ] Test Discord approve/deny responses
- [ ] Test session cleanup with `ccremote stop`

#### **Edge Cases:**
- [ ] Session creation when tmux not available
- [ ] Discord bot offline during notifications
- [ ] Malformed reset time parsing
- [ ] Multiple simultaneous approval requests
- [ ] Session monitoring during system sleep/wake

---

## **Deployment Preparation**

### **10. Build & Package** ⏱️ 0.5 days

#### **Build Setup:**
```json
// package.json scripts
{
  "build": "tsdown",
  "prepublishOnly": "npm run build",
  "postpack": "rm -rf dist"
}
```

#### **CLI Binary:**
```typescript
// src/cli.ts - ensure proper shebang and exports
#!/usr/bin/env node
import { createCLI } from './lib/cli-framework.js'
// ... rest of CLI setup
```

---

## **File Structure**

```
ccremote/
├── src/
│   ├── cli.ts              # Main CLI entry point
│   ├── app.ts              # Main application class
│   ├── commands/
│   │   ├── start.ts        # Start new session
│   │   ├── list.ts         # List sessions  
│   │   ├── stop.ts         # Stop session
│   │   └── status.ts       # Session status
│   ├── core/
│   │   ├── session.ts      # Session management
│   │   ├── tmux.ts         # Tmux operations
│   │   ├── discord.ts      # Discord bot
│   │   ├── monitor.ts      # Session monitoring
│   │   └── parser.ts       # Pattern detection
│   ├── handlers/
│   │   ├── continuation.ts # Auto-continuation logic
│   │   └── approval.ts     # Remote approvals
│   ├── lib/
│   │   └── cli-framework.ts # Simple CLI framework
│   └── types/
│       └── index.ts        # TypeScript definitions
├── docs/
│   ├── SCHEDULING.md       # Scheduling system design
│   └── ENGINEERING-PLAN.md # This file
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

---

## **Total Estimated Time: 8-10 days**

This plan provides specific, actionable steps to implement ccremote from scratch using the proven patterns from your proof of concepts while maintaining the modern architecture inspired by ccusage.