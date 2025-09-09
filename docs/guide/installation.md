# Installation

## Requirements

Before installing ccremote, make sure you have the following requirements:

### Node.js
ccremote requires **Node.js 20.19.4 or higher**.

Check your version:
```bash
node --version
```

If you need to install or upgrade Node.js:
- **macOS**: Use [Homebrew](https://brew.sh/): `brew install node`
- **Linux**: Use your package manager or [NodeSource](https://github.com/nodesource/distributions)
- **Windows**: Download from [nodejs.org](https://nodejs.org/)

### tmux

ccremote uses tmux for session management. 

#### macOS Important Note ⚠️
**macOS ships with tmux 3.3a which has a critical bug causing crashes when mouse mode is enabled.** You must install the latest version:

```bash
# Install latest tmux via Homebrew
brew install tmux

# Verify you have the latest version (4.0+)
tmux -V
```

#### Other Platforms
- **Linux**: `sudo apt install tmux` (Ubuntu/Debian) or `sudo yum install tmux` (RHEL/CentOS)
- **Windows**: Use WSL2 with tmux installed inside

### Discord Account
You'll need a Discord account to create a bot for notifications. The setup process is covered in the [Discord Setup guide](./discord-setup.md).

## Install ccremote

### Global Installation (Recommended)

Install ccremote globally so you can use it from anywhere:

```bash
# Using npm
npm install -g ccremote

# Using bun (faster)
bun install -g ccremote
```

### Local Installation

If you prefer to install locally in a project:

```bash
# Using npm
npm install ccremote

# Using bun
bun add ccremote
```

With local installation, run commands using `npx`:
```bash
npx ccremote init
npx ccremote start
```

## Verify Installation

Check that ccremote is installed correctly:

```bash
ccremote --version
```

You should see the version number displayed.

## Development Installation

If you want to contribute to ccremote or run the latest development version:

```bash
# Clone the repository
git clone https://github.com/augmentedmind/ccremote.git
cd ccremote

# Install dependencies
bun install

# Run from source
bun run dev --help

# Or build and link globally
bun run build
npm link
```

## Next Steps

Now that ccremote is installed:

1. **[Quick Start](./quick-start.md)** - Get up and running with the interactive setup
2. **[Discord Setup](./discord-setup.md)** - Create your Discord bot for notifications
3. **[Configuration](./configuration.md)** - Learn about configuration options

## Troubleshooting

### Command Not Found

If you get "command not found" after global installation:

1. **Check your PATH**: Make sure your npm/bun global bin directory is in your PATH
2. **Restart terminal**: Close and reopen your terminal
3. **Check installation location**: 
   ```bash
   # npm
   npm list -g ccremote
   
   # bun  
   bun pm ls -g | grep ccremote
   ```

### Permission Errors

If you get permission errors during global installation:

```bash
# macOS/Linux: Use sudo (not recommended, use nvm instead)
sudo npm install -g ccremote

# Better: Use nvm to manage Node.js without sudo
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install node
npm install -g ccremote
```

### tmux Issues

If tmux commands fail:

1. **Check tmux is installed**: `tmux -V`
2. **macOS users**: Make sure you installed the latest tmux via Homebrew
3. **Permission issues**: Make sure your user can create tmux sessions

### Still Having Issues?

Check our [Troubleshooting guide](./troubleshooting.md) or open an issue on [GitHub](https://github.com/augmentedmind/ccremote/issues).