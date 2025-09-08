export type SessionState = {
	id: string;
	name: string;
	tmuxSession: string;
	channelId: string;
	status: 'active' | 'waiting' | 'error';
	created: string;
	lastActivity: string;
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
	type: 'limit' | 'continued' | 'approval' | 'error';
	sessionId: string;
	sessionName: string;
	message: string;
	metadata?: {
		resetTime?: string;
		toolName?: string;
		command?: string;
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
