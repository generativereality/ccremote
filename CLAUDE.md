# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Important**: Always read the README.md file in full before starting any task. It contains essential user-facing information about requirements, setup, and usage that may be critical for helping users effectively.

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

### Build and Release

- `bun run build` - Build distribution files with tsdown  
- `bun run check` - Full validation (lint + typecheck + test + build)
- `bun run release` - Complete release workflow (check + version bump with bumpp)
- `npm publish` - Publish to npm registry (triggers prepack build + publint validation)

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
- **Sessions**: Global user directory `~/.ccremote/sessions.json` (shared across all projects)
- Auto-generated IDs: `ccremote-1`, `ccremote-2`, etc.
- Status tracking: `active`, `waiting`, `waiting_approval`, `ended`
- **Logs**: Global user directory `~/.ccremote/logs/` with project-specific naming: `{projectName}-{sessionId}.log`

**Pattern Detection**
- Usage limit detection: `/(?:5-hour limit reached.*resets|usage limit.*resets)/i`
- Approval dialog detection: Requires question + numbered options + selection arrow
- Command continuation: Automated after 5-hour reset

**Discord Integration**
- Notification types: `limit`, `continued`, `approval`, `error`
- Per-user bots recommended for privacy
- Approval workflow: detect → notify → wait for user response
- **Permissions Policy**: Bot requires these Discord permissions (as implemented in src/core/discord.ts):
  - **Administrator** (recommended): Full channel management without hierarchy issues
  - OR minimal permissions:
    - **Manage Channels**: Create private session channels (falls back to DMs if missing)
    - **Manage Roles**: Set channel permission overwrites for privacy
    - **Send Messages**: Send notifications to channels/DMs
    - **Read Message History**: Read user approval responses
  - **Message Content Intent**: Required gateway intent for approval commands

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

## Global Development Installation

To install ccremote globally for development and testing:

```bash
# Build the project
bun run build

# Create and install package globally (recommended approach)
bun run release:test                 # Runs all checks, builds, packages, and installs globally

# Test global installation
ccremote --help

# After making changes, simply run:
bun run release:test                 # Rebuilds, repackages, and reinstalls globally
```

**Note**: Avoid using `bun link` or manual symlinks as they can cause module resolution issues with PM2's internal dependencies when the daemon processes are started.

### Bundling Notes

- PM2 is bundled with the distribution (included in `files` array)
- PM2 binary is resolved at runtime from multiple possible locations
- No external dependencies need to be installed when using ccremote in other projects

## Release Process

### Key Principles

- **Use GitHub PRs**: Never merge to `main` locally - always use GitHub pull requests
- **Test before merging**: Bump version and test releases (`npm pack` + local install) on feature branches
- **Publish from main**: Only publish to npm from `main` branch after PR merge
- **Tag releases**: Create git tags for published versions

### Release Commands

```bash
# Full release process (main branch only)
bun run release

# Test package without releasing
bun run release:test
```

### Workflow

1. **Merge features**: All features merged to main via GitHub PRs
2. **Release**: On main branch, run `bun run release`
   - Validates you're on main branch
   - Runs all checks (lint, typecheck, tests, build)
   - Creates and tests package locally
   - Interactive version bump
   - Publishes to npm and creates git tag
3. **Bug fixes**: If issues found, fix on main and re-run `bun run release`
