# How to Run Visual Studio Code from Source

## Prerequisites

Before running VS Code from source, ensure you have:

1. **Node.js** (v18.x or later recommended)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version` and `npm --version`

2. **Python** (for native module compilation)
   - Download from: https://www.python.org/
   - VS Code build scripts may require Python 2.7 or 3.x

3. **Git** (if not already installed)
   - Download from: https://git-scm.com/

4. **Build Tools** (for Windows)
   - Visual Studio Build Tools or Visual Studio with C++ workload
   - Required for compiling native Node.js modules

## Quick Start (Windows)

### Step 1: Install Dependencies

Open PowerShell in the project root directory and run:

```powershell
npm install
```

This will:
- Install all Node.js dependencies
- Run pre-install and post-install scripts
- Set up the build environment

**Note:** This may take 10-20 minutes depending on your internet connection.

### Step 2: Compile the Source Code

Compile TypeScript source code to JavaScript:

```powershell
npm run compile
```

**Note:** This will take several minutes on first build (5-15 minutes depending on your machine).

### Step 3: Run VS Code

Launch the development version:

```powershell
.\scripts\code.bat
```

Or simply:

```powershell
scripts\code.bat
```

This will:
- Download Electron if needed
- Ensure the code is compiled
- Download built-in extensions
- Launch VS Code in development mode

## Development Workflow

### Watch Mode (Recommended for Development)

For active development, use watch mode which automatically recompiles on file changes:

```powershell
# Terminal 1: Watch for changes and recompile
npm run watch

# Terminal 2: Launch VS Code (run this after watch has started)
.\scripts\code.bat
```

The `watch` command runs both:
- `watch-client` - watches and recompiles main VS Code code
- `watch-extensions` - watches and recompiles built-in extensions

### Individual Watch Commands

You can also run watch commands separately:

```powershell
# Watch only client code (faster, good for UI changes)
npm run watch-client

# Watch only extensions (good for extension development)
npm run watch-extensions
```

### Run with Watch (Auto-restart)

For automatic restarts during development:

```powershell
# Start watch daemon
npm run watchd

# In another terminal, run VS Code
.\scripts\code.bat

# To stop watch daemon
npm run kill-watchd
```

## Alternative: Web Version

To run VS Code in the browser:

```powershell
# Compile web version
npm run compile-web

# Run web server
.\scripts\code-web.bat
```

Or with watch mode:

```powershell
# Watch web version
npm run watch-web

# In another terminal
.\scripts\code-web.bat
```

## Common Issues and Solutions

### Issue: `npm install` fails

**Solution:**
- Ensure you have Node.js 18+ installed
- Clear npm cache: `npm cache clean --force`
- Delete `node_modules` folder and `package-lock.json`, then run `npm install` again
- On Windows, you may need to run PowerShell as Administrator

### Issue: Native modules fail to compile

**Solution:**
- Install Visual Studio Build Tools with C++ workload
- Install Python and ensure it's in your PATH
- Run: `npm install --global windows-build-tools` (deprecated but may help)

### Issue: Electron download fails

**Solution:**
- Check your internet connection
- The preLaunch script will download Electron automatically
- If it fails, you can manually download Electron and place it in `.build/electron/`

### Issue: Out of memory during compilation

**Solution:**
- Increase Node.js memory limit: `$env:NODE_OPTIONS="--max-old-space-size=8192"`
- Close other applications
- The build scripts already use `--max-old-space-size=8192` by default

### Issue: Build is slow

**Solution:**
- Use watch mode instead of full compile for development
- Disable antivirus scanning of the project directory (add exclusion)
- Use an SSD for better I/O performance
- Close unnecessary applications

## File Structure After Build

After running the build, you'll see:

```
.build/
  electron/          # Electron binaries
  builtin/           # Built-in extensions

out/                 # Compiled JavaScript output
  vs/                # Main application code
  bootstrap-*.js     # Bootstrap scripts
  main.js            # Main entry point

extensions/          # Built-in extensions source
src/                 # TypeScript source code
```

## Running Specific Tests

```powershell
# Run unit tests
npm run test-node

# Run browser tests (requires Playwright)
npm run test-browser

# Run smoke tests
npm run smoketest
```

## Environment Variables

You can set these environment variables for development:

- `VSCODE_SKIP_PRELAUNCH=1` - Skip pre-launch checks (faster startup)
- `VSCODE_DEV=1` - Development mode (already set by code.bat)
- `ELECTRON_ENABLE_LOGGING=1` - Enable Electron logging
- `NODE_ENV=development` - Development environment

## Troubleshooting

### Check if everything is set up correctly:

```powershell
# Check Node.js version
node --version

# Check npm version
npm --version

# Verify dependencies are installed
Test-Path node_modules

# Verify code is compiled
Test-Path out

# Verify Electron is downloaded
Test-Path .build\electron
```

### Clean Build

If you encounter issues, try a clean build:

```powershell
# Remove compiled files
Remove-Item -Recurse -Force out
Remove-Item -Recurse -Force .build
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json

# Reinstall
npm install
npm run compile
```

## Additional Resources

- [VS Code Wiki - How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
- [VS Code Wiki - Build](https://github.com/microsoft/vscode/wiki/How-to-Contribute#build)
- [VS Code GitHub Issues](https://github.com/microsoft/vscode/issues)

## Quick Reference

```powershell
# First time setup
npm install
npm run compile
.\scripts\code.bat

# Development (recommended)
npm run watch          # Terminal 1
.\scripts\code.bat     # Terminal 2

# Clean build
npm run compile

# Run tests
npm run test-node
```

