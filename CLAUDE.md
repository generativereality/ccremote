# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ccremote is a CLI tool that provides remote control for Claude Code sessions with Discord integration. It monitors Claude Code sessions, automatically continues them when usage limits reset, and provides Discord notifications for session events and approval requests.

## Development Commands

### Essential Commands
- `bun run dev` - Run in development mode
- `bun run build` - Build for production using tsdown
- `bun run test` - Run tests with vitest
- `bun run lint` - Lint code with ESLint
- `bun run typecheck` - Type check with TypeScript compiler
- `bun run check` - All checks (lint + typecheck + test + build)
- `bun run release` - Full release process (all checks + version bump)

### Testing
- Tests are located alongside source files using vitest's in-source testing
- Use `import.meta.vitest` blocks for tests within source files
- Test config: vitest with globals enabled, node environment
- Run single test file: `vitest run src/core/monitor.ts`

## Architecture

### Core Components

**Command System (`src/commands/`)**
- CLI interface using command pattern
- Commands: `init`, `start`, `stop`, `list`, `status`
- Entry point: `src/index.ts` → `src/commands/index.ts`

**Core Services (`src/core/`)**
- `config.ts`: Configuration management with env file precedence
- `session.ts`: Session state management with JSON persistence
- `tmux.ts`: Tmux session integration and command sending
- `monitor.ts`: Pattern detection and event monitoring system
- `discord.ts`: Discord bot integration for notifications

**Configuration Priority (highest to lowest):**
1. Environment variables (CCREMOTE_* prefix)
2. ./ccremote.env
3. ./.env  
4. ~/.ccremote.env

### Key Patterns

**Session Management**
- Sessions stored in `.ccremote/sessions.json`
- Auto-generated IDs: `ccremote-1`, `ccremote-2`, etc.
- Status tracking: `active`, `waiting`, `waiting_approval`, `ended`

**Pattern Detection**
- Usage limit detection: `/(?:5-hour limit reached.*resets|usage limit.*resets)/i`
- Approval dialog detection: Requires question + numbered options + selection arrow
- Command continuation: Automated after 5-hour reset

**Discord Integration**
- Notification types: `limit`, `continued`, `approval`, `error`
- Per-user bots recommended for privacy
- Approval workflow: detect → notify → wait for user response

## Configuration

### Required Environment Variables
```bash
CCREMOTE_DISCORD_BOT_TOKEN=your_discord_bot_token
CCREMOTE_DISCORD_OWNER_ID=your_discord_user_id
```

### Optional Configuration
```bash
CCREMOTE_DISCORD_AUTHORIZED_USERS=user1,user2  # Additional users
CCREMOTE_MONITORING_INTERVAL=2000              # Poll interval (ms)
CCREMOTE_MAX_RETRIES=3                         # Error retry limit
CCREMOTE_AUTO_RESTART=true                     # Auto-restart on failure
```

## Code Style

- Uses @ryoppippi/eslint-config with TypeScript support
- Strict TypeScript configuration with ESNext modules
- Console logging: only warn, error, info allowed (no plain console.log)
- Top-level await enabled
- Vitest for testing with in-source test blocks

## Build System

- **tsdown**: Modern TypeScript bundler (replaces tsc)
- **Output**: ESM format with declaration files
- **Entry**: `src/index.ts`
- **Distribution**: `dist/` directory
- **Binary**: Executable CLI via `dist/index.js`

## Development Workflow

1. Make changes to source files in `src/`
2. Run `bun run check` to verify types, run tests, lint etc
3. Use `bun run dev` for local testing of CLI commands
4. Build with `bun run build` before publishing