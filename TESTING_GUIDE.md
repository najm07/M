# Testing Guide for VS Code Features

This guide explains how to test new features in the VS Code codebase on Windows.

## Prerequisites

1. **Compile the code first** (if not already done):
   ```powershell
   npm run compile
   ```

2. **Ensure dependencies are installed**:
   ```powershell
   npm install
   ```

## Types of Tests

### 1. Unit Tests

Unit tests verify individual components and functions in isolation.

#### Run Unit Tests in Electron (Recommended)

This runs tests in an Electron environment, closest to the production VS Code:

```powershell
# Run all unit tests
.\scripts\test.bat

# Run with debug window (opens DevTools for debugging)
.\scripts\test.bat --debug

# Run specific test files
.\scripts\test.bat --glob **/your-feature*.test.js

# Run tests matching a pattern
.\scripts\test.bat --run src/vs/workbench/contrib/your-feature/**/*.test.ts
```

**Example**: To test a chat feature:
```powershell
.\scripts\test.bat --glob **/chat*.test.js
```

#### Run Unit Tests in Browser (Playwright)

Tests run in Chromium/WebKit browsers:

```powershell
# Run browser tests (installs Playwright if needed)
npm run test-browser

# Run in specific browsers
npm run test-browser -- --browser chromium
npm run test-browser -- --browser webkit

# Run without installing Playwright (faster if already installed)
npm run test-browser-no-install -- --browser chromium
```

#### Run Unit Tests in Node.js

For tests that don't need DOM or Electron APIs:

```powershell
npm run test-node -- --run src/vs/your-feature/test/**/*.test.ts
```

### 2. Integration Tests

Integration tests verify that VS Code APIs work correctly with extensions.

#### Run Integration Tests

```powershell
# Run all integration tests
.\scripts\test-integration.bat

# Run with debug window
.\scripts\test-integration.bat --debug

# Run web integration tests
.\scripts\test-web-integration.bat --browser chromium
.\scripts\test-web-integration.bat --browser webkit --debug
```

**Note**: Integration tests require compiled extensions. They will compile automatically if needed.

### 3. Smoke Tests (UI Tests)

Smoke tests are automated UI tests that verify end-to-end workflows.

#### Run Smoke Tests

```powershell
# Run smoke tests (compiles if needed)
npm run smoketest

# Run without compilation (faster if already compiled)
npm run smoketest-no-compile

# Run specific test suites
npm run smoketest -- -g "chat"
npm run smoketest -- -g "terminal"

# Run with verbose logging
npm run smoketest -- --verbose

# Run in headless mode (for web tests)
npm run smoketest -- --web --browser chromium --headless
```

**Available smoke test areas**:
- `chat` - Chat features
- `terminal` - Terminal functionality
- `notebook` - Notebook features
- `search` - Search functionality
- `extensions` - Extension management
- `preferences` - Settings UI
- And more in `test/smoke/src/areas/`

## Testing Specific Features

### Finding Test Files

To find test files for a specific feature:

```powershell
# Search for test files related to your feature
Get-ChildItem -Recurse -Filter "*test*.ts" | Select-String -Pattern "your-feature-name"
```

Or use grep:
```powershell
# Search for test files
grep -r "your-feature" test/ --include="*.test.ts"
```

### Running Tests for a Specific Feature

1. **Identify the feature location**:
   - Check `src/vs/workbench/contrib/` for workbench features
   - Check `src/vs/platform/` for platform services
   - Check `extensions/` for extension features

2. **Find corresponding test files**:
   - Unit tests: Usually in `src/**/test/` directories
   - Smoke tests: In `test/smoke/src/areas/`

3. **Run the specific tests**:
   ```powershell
   # Unit test example
   .\scripts\test.bat --glob **/your-feature*.test.js

   # Smoke test example
   npm run smoketest -- -g "your-feature"
   ```

## Debugging Tests

### Debug Unit Tests

1. **Open DevTools**:
   ```powershell
   .\scripts\test.bat --debug
   ```

2. **Set breakpoints** in your test files or source code

3. **Use console.log** for quick debugging:
   ```typescript
   console.log('Debug info:', variable);
   ```

### Debug Smoke Tests

1. **Run with verbose logging**:
   ```powershell
   npm run smoketest -- --verbose -g "your-feature"
   ```

2. **Use Playwright debug mode** (for web tests):
   ```powershell
   $env:DEBUG="pw:*"
   npm run smoketest -- --web --browser chromium
   ```

### Debug Integration Tests

```powershell
# Run with debug window
.\scripts\test-integration.bat --debug
```

## Development Workflow

### Recommended Workflow

1. **Start watch mode** (in one terminal):
   ```powershell
   npm run watch
   ```

2. **Run tests** (in another terminal):
   ```powershell
   # After making changes, tests will auto-recompile
   .\scripts\test.bat --glob **/your-feature*.test.js
   ```

### Quick Test Cycle

```powershell
# 1. Make code changes
# 2. Run specific test
.\scripts\test.bat --glob **/your-feature*.test.js

# 3. If test passes, run related smoke test
npm run smoketest -- -g "your-feature"
```

## Test Coverage

To generate coverage reports:

```powershell
# Windows (coverage support may vary)
.\scripts\test.bat --coverage
```

Coverage reports will be in `.build/coverage/` directory.

## Common Test Patterns

### Testing a New Workbench Feature

1. **Unit tests**: `src/vs/workbench/contrib/your-feature/test/**/*.test.ts`
2. **Smoke tests**: Create or update `test/smoke/src/areas/your-feature/your-feature.test.ts`

### Testing a New Extension Feature

1. **Unit tests**: In the extension's `test/` directory
2. **Integration tests**: Use `extensions/vscode-api-tests` for API testing

### Testing a New API

1. **Unit tests**: Test the API implementation
2. **Integration tests**: Add tests to `extensions/vscode-api-tests/`

## Troubleshooting

### Tests fail to compile

```powershell
# Clean and recompile
npm run compile
```

### Tests timeout

- Increase timeout in test file: `this.timeout(10000);`
- Check for async operations not being awaited

### Electron not found

```powershell
# Download Electron
npm run electron
```

### Playwright browsers not installed

```powershell
# Install Playwright browsers
npm run playwright-install
```

### Smoke tests fail

- Ensure VS Code is not already running
- Check for state pollution between tests
- Review `test/smoke/Audit.md` for common pitfalls

## Best Practices

1. **Run tests before committing**: Always run relevant tests before pushing changes
2. **Write tests for new features**: Add unit tests for new functionality
3. **Test edge cases**: Don't just test the happy path
4. **Keep tests fast**: Avoid long-running operations in unit tests
5. **Use descriptive test names**: Make it clear what each test verifies

## Additional Resources

- **Unit Test README**: `test/unit/README.md`
- **Integration Test README**: `test/integration/browser/README.md`
- **Smoke Test README**: `test/smoke/README.md`
- **How to Run**: `HOW_TO_RUN.md`

## Quick Reference

```powershell
# Unit tests (Electron)
.\scripts\test.bat [--debug] [--glob pattern]

# Unit tests (Browser)
npm run test-browser -- --browser chromium

# Unit tests (Node)
npm run test-node -- --run path/to/test.ts

# Integration tests
.\scripts\test-integration.bat [--debug]

# Smoke tests
npm run smoketest [-- -g "pattern"] [--verbose]

# Watch mode (for development)
npm run watch
```

