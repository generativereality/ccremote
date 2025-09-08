import { promises as fs } from 'fs'
import { dirname } from 'path'
import { SessionState } from '../types/index.js'

export class SessionManager {
  private sessionsFile = '.ccremote/sessions.json'
  private sessions: Map<string, SessionState> = new Map()

  async initialize(): Promise<void> {
    await this.ensureConfigDir()
    await this.loadSessions()
  }

  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.access('.ccremote')
    } catch {
      await fs.mkdir('.ccremote', { recursive: true })
    }
  }

  private async loadSessions(): Promise<void> {
    try {
      const data = await fs.readFile(this.sessionsFile, 'utf-8')
      const sessionData = JSON.parse(data)
      
      for (const [id, session] of Object.entries(sessionData)) {
        this.sessions.set(id, session as SessionState)
      }
    } catch (error) {
      // File doesn't exist or invalid JSON - start with empty sessions
      this.sessions.clear()
    }
  }

  private async saveSessions(): Promise<void> {
    const sessionData: Record<string, SessionState> = {}
    for (const [id, session] of this.sessions) {
      sessionData[id] = session
    }
    
    await fs.writeFile(this.sessionsFile, JSON.stringify(sessionData, null, 2))
  }

  async createSession(name?: string, channelId?: string): Promise<SessionState> {
    // Generate session ID
    const sessionId = this.generateSessionId()
    const sessionName = name || `session-${sessionId.split('-')[1]}`
    
    const session: SessionState = {
      id: sessionId,
      name: sessionName,
      tmuxSession: sessionId,
      channelId: channelId || '',
      status: 'active',
      created: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    }

    this.sessions.set(sessionId, session)
    await this.saveSessions()
    
    return session
  }

  async listSessions(): Promise<SessionState[]> {
    return Array.from(this.sessions.values())
  }

  async getSession(id: string): Promise<SessionState | null> {
    return this.sessions.get(id) || null
  }

  async getSessionByName(name: string): Promise<SessionState | null> {
    for (const session of this.sessions.values()) {
      if (session.name === name) {
        return session
      }
    }
    return null
  }

  async updateSession(id: string, updates: Partial<SessionState>): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) {
      throw new Error(`Session not found: ${id}`)
    }

    // Update session
    Object.assign(session, updates, {
      lastActivity: new Date().toISOString()
    })

    await this.saveSessions()
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.sessions.has(id)) {
      throw new Error(`Session not found: ${id}`)
    }

    this.sessions.delete(id)
    await this.saveSessions()
  }

  private generateSessionId(): string {
    // Generate ccremote-1, ccremote-2, etc.
    const existingNumbers = Array.from(this.sessions.keys())
      .map(id => {
        const match = id.match(/^ccremote-(\d+)$/)
        return match ? parseInt(match[1], 10) : 0
      })
      .filter(n => n > 0)

    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1
    return `ccremote-${nextNumber}`
  }
}