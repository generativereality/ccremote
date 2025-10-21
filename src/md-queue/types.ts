/**
 * md-queue: Markdown-Based Queue System
 *
 * Core type definitions for queue items, locks, and processing.
 * Designed to work with both Bun (ccremote) and Node (Electron).
 */

/**
 * Queue item phase in the state machine
 */
export type Phase = 'pending' | 'processing' | 'done' | 'error';

/**
 * Processing status with state machine tracking
 */
export interface Status {
  /** Current phase in the state machine */
  phase: Phase;

  /** ISO 8601 timestamp of last status update */
  last_update: string;

  /** Number of processing attempts */
  attempts: number;

  /** Lock string (host:pid:timestamp) or null if not locked */
  lock: string | null;

  /** Error message if phase is 'error' */
  last_error?: string;

  /** Reason for reprocessing (if item was reset from done/error to pending) */
  reprocess_reason?: string;
}

/**
 * Lock information (parsed from lock string)
 */
export interface Lock {
  /** Hostname of the machine holding the lock */
  host: string;

  /** Process ID holding the lock */
  pid: number;

  /** Unix timestamp (ms) when lock was acquired */
  timestamp: number;
}

/**
 * Model processing result (e.g., Whisper transcription, VLM caption)
 */
export interface ModelResult {
  /** Model identifier (e.g., 'base', 'minicpm-v:4.5') */
  model: string;

  /** ISO 8601 timestamp when processed */
  at: string;

  /** Model output (transcript, caption, etc.) */
  text: string;

  /** Detected language code (for Whisper) */
  detected_language?: string;

  /** Language detection confidence (0-1) */
  confidence?: number;

  /** Any additional metadata */
  [key: string]: any;
}

/**
 * Previous processing attempt (for reprocessing tracking)
 */
export interface PreviousAttempt {
  /** Phase reached in this attempt */
  phase: Phase;

  /** Model used (if applicable) */
  model?: string;

  /** Language detected (if applicable) */
  detected_language?: string;

  /** Confidence score (if applicable) */
  confidence?: number;

  /** ISO 8601 timestamp */
  at: string;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Queue item frontmatter structure
 */
export interface Frontmatter {
  /** Item type (e.g., 'voice_memo', 'photo', 'rollup') */
  type: string;

  /** Processing status */
  status: Status;

  /** Model processing results (e.g., whisper, vision_caption) */
  models?: {
    [modelType: string]: ModelResult;
  };

  /** Source information (e.g., original file path, photo UUID) */
  source?: {
    /** Path to source file */
    path?: string;

    /** Photo UUID (for photos) */
    uuid?: string;

    /** Creation timestamp */
    created_at?: string;

    /** File size in bytes */
    size?: number;

    /** Duration in seconds (for audio/video) */
    duration?: number;

    [key: string]: any;
  };

  /** Previous processing attempts (for reprocessing) */
  previous_attempts?: PreviousAttempt[];

  /** Processing options/overrides */
  options?: {
    /** Force specific language (override auto-detection) */
    force_language?: string;

    /** Force specific model */
    force_model?: string;

    [key: string]: any;
  };

  /** Priority for rollup items */
  priority?: 'high' | 'medium' | 'low';

  /** Timestamp when item was created */
  timestamp?: string;

  /** Allow additional fields */
  [key: string]: any;
}

/**
 * Complete queue item (frontmatter + content)
 */
export interface QueueItem {
  /** Absolute path to the markdown file */
  path: string;

  /** Parsed frontmatter */
  frontmatter: Frontmatter;

  /** Markdown content (after frontmatter) */
  content: string;
}

/**
 * Reconciliation report from directory sweep
 */
export interface ReconciliationReport {
  /** Number of items in pending phase */
  pending: number;

  /** Number of items in processing phase */
  processing: number;

  /** Number of items in done phase */
  done: number;

  /** Number of items in error phase */
  error: number;

  /** Number of stale locks reset to pending */
  staleReset: number;

  /** ISO 8601 timestamp of reconciliation */
  timestamp: string;
}

/**
 * Processing report from batch processing
 */
export interface ProcessReport {
  /** Number of items successfully processed */
  processed: number;

  /** Number of items that failed */
  failed: number;

  /** Number of items skipped (already processing) */
  skipped: number;

  /** Total processing time in milliseconds */
  duration: number;

  /** ISO 8601 timestamp when processing started */
  started_at: string;

  /** ISO 8601 timestamp when processing finished */
  finished_at: string;
}

/**
 * Filter options for finding items
 */
export interface FilterOptions {
  /** Filter by phase */
  phase?: Phase | Phase[];

  /** Filter by type */
  type?: string | string[];

  /** Filter by priority */
  priority?: 'high' | 'medium' | 'low';

  /** Include done items */
  includeDone?: boolean;

  /** Include error items */
  includeError?: boolean;

  /** Maximum items to return */
  limit?: number;
}

/**
 * Processing options
 */
export interface ProcessOptions {
  /** Maximum concurrent processing */
  maxConcurrent?: number;

  /** Lock timeout in milliseconds (default: 5 minutes) */
  lockTimeout?: number;

  /** Maximum retries on error (default: 3) */
  maxRetries?: number;

  /** Stop on first error */
  stopOnError?: boolean;
}

/**
 * Configuration for md-queue
 */
export interface QueueConfig {
  /** Base path to vault/project */
  basePath: string;

  /** Default lock timeout in milliseconds */
  lockTimeout?: number;

  /** Default max retries */
  maxRetries?: number;

  /** Hostname for locks (auto-detected if not provided) */
  hostname?: string;
}
