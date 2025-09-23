export type SessionState = {
	id: string;
	name: string;
	tmuxSession: string;
	channelId: string;
	status: 'active' | 'waiting' | 'error' | 'waiting_approval' | 'ended';
	created: string;
	lastActivity: string;
	projectPath: string; // Track which project this session belongs to
	workingDirectory: string; // Current working directory when session was created
	quotaSchedule?: {
		time: string; // Original time string (e.g., "5:00")
		command: string; // Command to execute
		nextExecution: string; // ISO string of next execution time
	};
};

export type LimitInfo = {
	detected: boolean;
	resetTime?: Date;
	message: string;
};

export type ApprovalInfo = {
	detected: boolean;
	question: string;
	toolName: string;
	command?: string;
};

export type MonitorState = {
	sessionId: string;
	isRunning: boolean;
	pollingInterval: number;
	lastCheck: number;
	scheduledResetTime?: Date;
	lastContinuationTime?: number;
};

export type NotificationMessage = {
	type: 'limit' | 'continued' | 'approval' | 'error' | 'session_ended';
	sessionId: string;
	sessionName: string;
	message: string;
	metadata?: {
		resetTime?: string;
		toolName?: string;
		command?: string;
		detectedAt?: string;
		action?: string;
		question?: string;
		approvalRequested?: boolean;
		timestamp?: string;
		nextScheduledExecution?: string;
		quotaWindowTime?: string;
	};
};

export type ScheduledTask = {
	id: string;
	sessionId: string;
	type: 'continuation' | 'early_window';
	executeAt: Date;
	executed: boolean;
	payload?: any;
};
