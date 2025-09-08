export interface SessionState {
  id: string
  name: string
  tmuxSession: string
  channelId: string
  status: 'active' | 'waiting' | 'error'
  created: string
  lastActivity: string
}

export interface LimitInfo {
  detected: boolean
  resetTime?: Date
  message: string
}

export interface ApprovalInfo {
  detected: boolean
  question: string
  toolName: string
  command?: string
}

export interface MonitorState {
  sessionId: string
  isRunning: boolean
  pollingInterval: number
  lastCheck: number
  scheduledResetTime?: Date
  lastContinuationTime?: number
}

export interface NotificationMessage {
  type: 'limit' | 'continued' | 'approval' | 'error'
  sessionId: string
  sessionName: string
  message: string
  metadata?: {
    resetTime?: string
    toolName?: string
    command?: string
  }
}

export interface ScheduledTask {
  id: string
  sessionId: string
  type: 'continuation' | 'early_window'
  executeAt: Date
  executed: boolean
  payload?: any
}