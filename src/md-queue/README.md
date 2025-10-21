# md-queue API Design

**Version:** 1.0.0
**Status:** Design Complete - Ready for Implementation
**Date:** 2025-10-20

This directory contains the TypeScript API design for **md-queue**, the unified markdown-based queue system used by both ccremote and the RememberThis Mac app.

## Overview

md-queue is a queue system that uses markdown files with YAML frontmatter for state persistence. It provides:

- **Per-asset tracking** - Each item is a markdown file with state machine
- **Soft locks** - Coordinate processing across multiple workers
- **Atomic writes** - Safe for sync services (Obsidian Sync, Dropbox)
- **Reconciliation** - Find and reset stale items
- **Reprocessing** - Support for retrying with different parameters

## Files

### Core Types

**`types.ts`** - Core type definitions
- `QueueItem` - Complete queue item (frontmatter + content)
- `Frontmatter` - YAML frontmatter structure
- `Status` - Processing status with state machine
- `Phase` - State machine phases (pending/processing/done/error)
- `Lock` - Lock information
- `ModelResult` - AI model processing results
- `ReconciliationReport` - Reconciliation statistics
- `ProcessReport` - Processing statistics
- `FilterOptions` - Item filtering criteria
- `ProcessOptions` - Processing configuration
- `QueueConfig` - Queue configuration

### Managers

**`AssetManager.ts`** - File operations
- `read()` - Read queue item from disk
- `create()` - Create new queue item
- `updateFrontmatter()` - Update frontmatter fields
- `atomicWrite()` - Atomic write (safe for sync)
- `delete()` - Delete queue item
- `move()` - Move/rename queue item

**`LockManager.ts`** - Lock operations
- `createLock()` - Create lock for current process
- `parseLock()` - Parse lock string
- `isStale()` - Check if lock is stale
- `acquireLock()` - Acquire lock on item
- `releaseLock()` - Release lock
- `resetStaleLock()` - Reset stale lock to pending

**`StateManager.ts`** - State transitions
- `transition()` - Transition to new phase
- `markDone()` - Mark item as done
- `markError()` - Mark item as error
- `resetToPending()` - Reset for reprocessing
- `hasExceededRetries()` - Check retry limit

**`Reconciler.ts`** - Directory sweeps
- `findItems()` - Find items with filters
- `findPending()` - Find pending items
- `findStale()` - Find stale locks
- `findErrors()` - Find error items
- `reconcile()` - Reconcile directory
- `findProcessable()` - Find items ready to process
- `getStats()` - Get queue statistics

**`Processor.ts`** - Processing orchestration
- `processItem()` - Process single item (claim → execute → update)
- `processDirectory()` - Process all pending in directory
- Concurrency control
- Retry logic
- Error handling

**`index.ts`** - Public API
- `createQueue()` - Initialize queue with all managers
- `createFrontmatter()` - Create basic frontmatter
- Helper functions
- Exports all types and classes

## Usage Example

### Basic Setup

```typescript
import { createQueue } from 'md-queue';

const queue = createQueue({
  basePath: '/Users/me/vault',
  lockTimeout: 5 * 60 * 1000, // 5 minutes
  maxRetries: 3
});
```

### Voice Memo Processing (Mac App)

```typescript
// Create per-asset file when voice memo detected
const frontmatter = createFrontmatter('voice_memo', voiceMemoPath);
frontmatter.source = {
  path: voiceMemoPath,
  created_at: new Date().toISOString(),
  duration: audioDuration,
  size: fileSize
};

await queue.assetManager.create(
  'life-assets/voice/2025/memo-001.md',
  frontmatter,
  '' // No content yet
);

// Reconcile and process pending
const pending = await queue.reconciler.findPending('life-assets/voice');

for (const item of pending) {
  await queue.processor.processItem(item, async (item) => {
    // Transcribe
    const transcript = await transcribeAudio(item.frontmatter.source.path);

    // Update with result
    await queue.assetManager.updateFrontmatter(item.path, {
      status: { phase: 'done' },
      models: {
        whisper: {
          model: 'base',
          at: new Date().toISOString(),
          text: transcript,
          detected_language: 'en',
          confidence: 0.95
        }
      }
    });

    // Emit rollup
    await emitRollup(item, transcript);
  });
}
```

### Queue Processing (ccremote)

```typescript
// Watch _q/high/ folder
const pending = await queue.reconciler.findPending('_q/high');

await queue.processor.processDirectory(
  '_q/high',
  async (item) => {
    // Build Claude prompt
    const prompt = buildQueuePrompt(item);

    // Spawn Claude session
    await spawnClaudeSession({
      name: `q-high-${Date.now()}`,
      prompt,
      discord: true
    });

    // Archive
    await queue.assetManager.move(
      item.path,
      item.path.replace('_q/high', '_q/archive/high')
    );
  },
  {
    maxConcurrent: 3,
    stopOnError: false
  }
);
```

### Reprocessing (Wrong Language Detected)

```typescript
// Find item to reprocess
const item = await queue.assetManager.read(
  'life-assets/voice/2025/memo-001.md'
);

// Check if reprocessing needed
if (item.frontmatter.models?.whisper?.confidence < 0.5) {
  // Reset to pending with reason
  await queue.stateManager.resetToPending(
    item,
    'low_confidence_language_detection',
    queue.assetManager
  );

  // Set language override
  await queue.assetManager.updateFrontmatter(item.path, {
    options: {
      force_language: 'en'
    }
  });
}
```

### Reconciliation

```typescript
// Run periodic reconciliation
setInterval(async () => {
  const report = await queue.reconciler.reconcile('life-assets/voice');

  console.log('Reconciliation Report:', {
    pending: report.pending,
    processing: report.processing,
    done: report.done,
    error: report.error,
    staleReset: report.staleReset,
    timestamp: report.timestamp
  });

  // Alert if too many errors
  if (report.error > 10) {
    sendDiscordNotification('Too many errors in voice queue');
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

## State Machine

```
pending ──────────► processing ──────────► done
   ▲                     │
   │                     │
   └─────────────────────┴──────────► error
```

**Valid Transitions:**
- `pending → processing` - Lock acquired, processing starts
- `processing → done` - Processing succeeded
- `processing → error` - Processing failed
- `done → pending` - Reprocessing requested
- `error → pending` - Retry after error

## Frontmatter Structure

### Voice Memo Example

```yaml
---
type: voice_memo
status:
  phase: done
  last_update: 2025-10-20T20:30:00Z
  attempts: 1
  lock: null
source:
  path: ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/memo.m4a
  created_at: 2025-10-20T20:25:00Z
  duration: 12.7
  size: 45632
models:
  whisper:
    model: base
    at: 2025-10-20T20:30:15Z
    text: "Avåsosenthal är 11 av november klockan 12 30..."
    detected_language: sv
    confidence: 0.865
timestamp: 2025-10-20T20:25:00Z
---

# Transcription

...
```

### Rollup Queue Item Example

```yaml
---
type: rollup
priority: high
status:
  phase: pending
  last_update: 2025-10-20T20:31:00Z
  attempts: 0
  lock: null
source:
  type: voice_memo
  asset_path: life-assets/voice/2025/memo-001.md
timestamp: 2025-10-20T20:31:00Z
---

New voice memo transcribed: [link to asset]

Transcript:
> Avåsosenthal är 11 av november...

Please process this into the diary.
```

## Implementation Notes

### Bun vs Node Compatibility

Write in vanilla TypeScript. Avoid:
- Bun-specific APIs
- Node-specific APIs (where possible)

Use conditional imports or runtime detection where needed.

### Atomic Writes

Always use `.tmp` → rename pattern:

```typescript
// Write to temporary file
await fs.writeFile(`${path}.tmp`, content);

// Atomic rename
await fs.rename(`${path}.tmp`, path);
```

This ensures sync services never see partial files.

### Lock Timeout

Default: **5 minutes**

Adjust based on task duration:
- Voice transcription: 1-2 minutes (short timeout OK)
- Photo captioning: 5-10 seconds (very short)
- Claude processing: 5-10 minutes (longer timeout)

### Error Handling

- **Transient errors**: Retry with exponential backoff
- **Permanent errors**: Mark as error, require manual intervention
- **Max retries**: Default 3, configurable

### Concurrency

Default: **1** (sequential processing)

Can be increased for:
- Bulk imports
- Batch processing
- High-volume queues

Use `maxConcurrent` option carefully - locks prevent conflicts, but file system can still be overwhelmed.

## Next Steps

1. **Implement in ccremote** (Step 3)
   - Create `ccremote/src/md-queue/` directory
   - Copy these files
   - Implement all methods
   - Write tests

2. **Use in ccremote** (Step 4)
   - Update QueueManager to use md-queue
   - Test with `_q/` folders

3. **Use in Electron** (Step 5)
   - Import md-queue from ccremote
   - Update voice processor
   - Test with voice memos

4. **End-to-end testing** (Step 7)
   - Voice memo → diary entry
   - Photo → diary entry
   - Manual queue item → Claude processing

## Files in This Design

- `README.md` - This file (design overview)
- `types.ts` - Core type definitions
- `AssetManager.ts` - File operations
- `LockManager.ts` - Lock management
- `StateManager.ts` - State transitions
- `Reconciler.ts` - Directory sweeps
- `Processor.ts` - Processing orchestration
- `index.ts` - Public API

All files are TypeScript **interfaces only** - no implementation yet. These will be moved to `ccremote/src/md-queue/` and implemented there.

---

**Status:** ✅ Design complete, ready for implementation
**Next:** Move to ccremote and implement
