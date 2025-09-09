import type { SessionState } from '../types/index.js';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export class SessionManager {
	private sessionsFile = '.ccremote/sessions.json';
	private sessions: Map<string, SessionState> = new Map();
	private lockFile = '.ccremote/sessions.lock';
	private writeLock: Promise<void> = Promise.resolve();

	async initialize(): Promise<void> {
		await this.ensureConfigDir();
		await this.loadSessions();
	}

	private async ensureConfigDir(): Promise<void> {
		const configDir = dirname(this.sessionsFile);
		try {
			await fs.access(configDir);
		}
		catch {
			await fs.mkdir(configDir, { recursive: true });
		}
	}

	private async loadSessions(): Promise<void> {
		await this.withWriteLock(async () => {
			try {
				const data = await fs.readFile(this.sessionsFile, 'utf-8');
				const sessionData = JSON.parse(data) as Record<string, unknown>;

				this.sessions.clear();
				for (const [id, session] of Object.entries(sessionData)) {
					this.sessions.set(id, session as SessionState);
				}
			}
			catch {
				// File doesn't exist or invalid JSON - start with empty sessions
				this.sessions.clear();
			}
		});
	}

	private async saveSessions(): Promise<void> {
		await this.withWriteLock(async () => {
			await this.writeSessionsToFile();
		});
	}

	private async writeSessionsToFile(): Promise<void> {
		const sessionData: Record<string, SessionState> = {};
		for (const [id, session] of this.sessions) {
			sessionData[id] = session;
		}

		// Write atomically using temp file
		const tempFile = `${this.sessionsFile}.tmp.${randomBytes(4).toString('hex')}`;
		await fs.writeFile(tempFile, JSON.stringify(sessionData, null, 2));
		await fs.rename(tempFile, this.sessionsFile);
	}

	private async loadSessionsFromDisk(): Promise<void> {
		try {
			const data = await fs.readFile(this.sessionsFile, 'utf-8');
			const sessionData = JSON.parse(data) as Record<string, unknown>;

			this.sessions.clear();
			for (const [id, session] of Object.entries(sessionData)) {
				this.sessions.set(id, session as SessionState);
			}
		}
		catch {
			// File doesn't exist or invalid JSON - keep current sessions
		}
	}

	private async mergeFromDisk(): Promise<void> {
		try {
			const data = await fs.readFile(this.sessionsFile, 'utf-8');
			const sessionData = JSON.parse(data) as Record<string, unknown>;

			// Merge disk state with current state, preserving in-memory changes
			for (const [id, diskSession] of Object.entries(sessionData)) {
				const currentSession = this.sessions.get(id);
				if (currentSession) {
					// Update with disk data but preserve recent changes by comparing lastActivity
					const diskState = diskSession as SessionState;
					if (new Date(diskState.lastActivity) > new Date(currentSession.lastActivity)) {
						this.sessions.set(id, diskState);
					}
				}
				else {
					// New session from disk
					this.sessions.set(id, diskSession as SessionState);
				}
			}
		}
		catch {
			// File doesn't exist or invalid JSON - keep current sessions
		}
	}

	private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
		// Chain the operation after the current lock
		const currentLock = this.writeLock;
		let resolve: (value: T) => void;
		let reject: (error: any) => void;

		this.writeLock = new Promise<void>((res, rej) => {
			currentLock.then(async () => {
				try {
					const result = await fn();
					resolve(result);
					res();
				}
				catch (error) {
					reject(error);
					rej(error);
				}
			}).catch(rej);
		});

		return new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
	}

	async createSession(name?: string, channelId?: string): Promise<SessionState> {
		// Generate session ID
		const sessionId = this.generateSessionId();
		const sessionName = name || `session-${sessionId.split('-')[1]}`;

		const session: SessionState = {
			id: sessionId,
			name: sessionName,
			tmuxSession: sessionId,
			channelId: channelId || '',
			status: 'active',
			created: new Date().toISOString(),
			lastActivity: new Date().toISOString(),
		};

		this.sessions.set(sessionId, session);
		await this.saveSessions();

		return session;
	}

	async listSessions(): Promise<SessionState[]> {
		return Array.from(this.sessions.values());
	}

	async getSession(id: string): Promise<SessionState | null> {
		return this.sessions.get(id) || null;
	}

	async getSessionByName(name: string): Promise<SessionState | null> {
		for (const session of this.sessions.values()) {
			if (session.name === name) {
				return session;
			}
		}
		return null;
	}

	async updateSession(id: string, updates: Partial<SessionState>): Promise<void> {
		await this.withWriteLock(async () => {
			// Reload from disk to get latest state
			await this.mergeFromDisk();

			const session = this.sessions.get(id);
			if (!session) {
				throw new Error(`Session not found: ${id}`);
			}

			// Update session
			Object.assign(session, updates, {
				lastActivity: new Date().toISOString(),
			});

			await this.writeSessionsToFile();
		});
	}

	async deleteSession(id: string): Promise<void> {
		await this.withWriteLock(async () => {
			// Reload from disk to get latest state
			await this.mergeFromDisk();

			if (!this.sessions.has(id)) {
				throw new Error(`Session not found: ${id}`);
			}

			this.sessions.delete(id);
			await this.writeSessionsToFile();
		});
	}

	private generateSessionId(): string {
		// Generate ccremote-1, ccremote-2, etc.
		const existingNumbers = Array.from(this.sessions.keys())
			.map((id) => {
				const match = id.match(/^ccremote-(\d+)$/);
				return match ? Number.parseInt(match[1], 10) : 0;
			})
			.filter(n => n > 0);

		const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
		return `ccremote-${nextNumber}`;
	}
}

if (import.meta.vitest) {
	const vitest = await import('vitest');
	const { beforeEach, afterEach, describe, it, expect } = vitest;

	describe('SessionManager', () => {
		const testDir = '.ccremote-test';

		beforeEach(async () => {
			// Clean up test directory
			try {
				await fs.rm(testDir, { recursive: true, force: true });
			}
			catch {
				// Ignore if doesn't exist
			}
		});

		afterEach(async () => {
			// Clean up test directory
			try {
				await fs.rm(testDir, { recursive: true, force: true });
			}
			catch {
				// Ignore if doesn't exist
			}
		});

		it('should create sessions with auto-generated IDs', async () => {
			const sessionManager = new SessionManager();
			(sessionManager as any).sessionsFile = `${testDir}/sessions.json`;

			await sessionManager.initialize();

			const session1 = await sessionManager.createSession();
			expect(session1.id).toBe('ccremote-1');
			expect(session1.name).toBe('session-1');

			const session2 = await sessionManager.createSession('my-session');
			expect(session2.id).toBe('ccremote-2');
			expect(session2.name).toBe('my-session');
		});

		it('should persist sessions across instances', async () => {
			const sessionManager1 = new SessionManager();
			(sessionManager1 as any).sessionsFile = `${testDir}/sessions.json`;

			await sessionManager1.initialize();
			await sessionManager1.createSession('test-persistence');

			const sessionManager2 = new SessionManager();
			(sessionManager2 as any).sessionsFile = `${testDir}/sessions.json`;
			await sessionManager2.initialize();

			const sessions = await sessionManager2.listSessions();
			const testSession = sessions.find(s => s.name === 'test-persistence');
			expect(testSession).toBeDefined();
			expect(testSession?.id).toBe('ccremote-1');
		});

		it('should handle CRUD operations correctly', async () => {
			const sessionManager = new SessionManager();
			(sessionManager as any).sessionsFile = `${testDir}/sessions.json`;

			await sessionManager.initialize();

			// Create
			const session = await sessionManager.createSession('crud-test');
			expect(session.status).toBe('active');

			// Read
			const retrieved = await sessionManager.getSession(session.id);
			expect(retrieved?.name).toBe('crud-test');

			const retrievedByName = await sessionManager.getSessionByName('crud-test');
			expect(retrievedByName?.id).toBe(session.id);

			// Update
			await sessionManager.updateSession(session.id, { status: 'waiting', channelId: '12345' });
			const updated = await sessionManager.getSession(session.id);
			expect(updated?.status).toBe('waiting');
			expect(updated?.channelId).toBe('12345');

			// Delete
			await sessionManager.deleteSession(session.id);
			const deleted = await sessionManager.getSession(session.id);
			expect(deleted).toBe(null);
		});
	});
}
