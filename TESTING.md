# Testing Guide for AI Features

This document describes the test suite for the AI features implementation.

## Test Structure

The test suite is organized into three categories:

1. **Unit Tests** - Test individual components in isolation
2. **Integration Tests** - Test interactions between components
3. **Smoke Tests** - End-to-end critical path verification

## Running Tests

**Note**: Tests must be compiled first. Run `npm run compile` before running tests.

### Unit Tests (Node.js)

```bash
# Run all node unit tests
npm run test-node

# Run a specific test file (use node directly, not npm run)
node test/unit/node/index.js --run src/vs/services/ai/common/integration.test.ts

# Run tests matching a pattern
node test/unit/node/index.js --runGlob "**/ai/**/*.test.js"
```

### Unit Tests (Electron - Recommended)

**Note**: Test files should use global `suite` and `test` functions (provided by mocha), not import them:
```typescript
import assert from 'assert';
// Do NOT import: import { suite, test } from 'mocha';
// suite and test are available as globals

suite('My Test Suite', () => {
    test('my test', () => {
        assert.ok(true);
    });
});
```

```bash
# Windows
.\scripts\test.bat

# Linux/Mac
./scripts/test.sh

# Run specific test file
.\scripts\test.bat --run src/vs/services/ai/common/integration.test.ts

# Run tests matching a pattern
.\scripts\test.bat --glob "**/ai/**/*.test.js"
```

### Unit Tests (Browser)

```bash
# Run browser tests
npm run test-browser

# Run specific browser
npm run test-browser -- --browser chromium

# Run specific test file
npm run test-browser -- --run src/vs/services/ai/common/aiService.test.ts
```

### Smoke Tests

```bash
# Run smoke tests (requires VS Code automation)
npm run smoketest

# Note: Smoke tests are in test/smoke/src/areas/ai/ai.test.ts
```

## Test Files

### Unit Tests

#### Core Services
- `src/vs/services/ai/common/aiService.test.ts` - AI Service interface tests
- `src/vs/services/ai/node/aiServiceImpl.test.ts` - AI Service implementation tests
- `src/vs/services/ai/node/contextServiceImpl.test.ts` - Context Service tests
- `src/vs/services/ai/node/projectGraphServiceImpl.test.ts` - Project Graph Service tests
- `src/vs/services/ai/node/agentServiceImpl.test.ts` - Agent Service tests

#### Components
- `src/vs/services/ai/common/adaptivePromptBuilder.test.ts` - Prompt builder tests
- `src/vs/editor/contrib/aiCommands/browser/aiInlineCommandParser.test.ts` - Command parser tests
- `src/vs/workbench/contrib/aiContext/browser/aiContext.contribution.test.ts` - Context contribution tests
- `src/vs/workbench/contrib/aiCommands/browser/aiCommands.contribution.test.ts` - Commands contribution tests
- `src/vs/workbench/contrib/aiAgents/browser/aiAgents.contribution.test.ts` - Agents contribution tests

### Integration Tests

- `src/vs/services/ai/common/integration.test.ts` - Service interaction tests
- `src/vs/services/ai/test/integration.test.ts` - Comprehensive integration tests

### Smoke Tests

- `src/vs/services/ai/common/smoke.test.ts` - Unit-level smoke tests
- `src/vs/services/ai/test/smoke.test.ts` - Comprehensive smoke tests
- `test/smoke/src/areas/ai/ai.test.ts` - End-to-end smoke tests

## Test Utilities

### AITestUtils

Located at `src/vs/services/ai/test/aiTestUtils.ts`, provides helper functions:

- `createMockModel()` - Create mock AI model configurations
- `createMockConfig()` - Create mock config file content
- `createTestWorkspace()` - Create test workspace URIs
- `createTestFile()` - Create test file URIs
- `createMockFileContent()` - Generate mock file content with imports/exports
- `wait()` - Async delay utility

## Test Coverage

### AI Service Tests

**Coverage:**
- Model configuration loading
- Model switching
- Completion requests
- Error handling
- Event emission

**Key Tests:**
- `getModels returns empty array when no models configured`
- `setActiveModel validates model exists`
- `reloadModelConfiguration loads from config file`
- `requestCompletion throws when model not configured`
- `onDidChangeActiveModel fires when model changes`

### Context Service Tests

**Coverage:**
- File indexing
- Semantic search
- Vector similarity calculation
- File filtering
- Index persistence

**Key Tests:**
- `indexFile stores content correctly`
- `search returns results ordered by score`
- `cosineSimilarity calculates correctly`
- `shouldIndexFile excludes node_modules`
- `removeFile removes from index`

### Project Graph Service Tests

**Coverage:**
- Import/export parsing
- Call chain analysis
- Dependency resolution
- Graph building
- Relationship queries

**Key Tests:**
- `parseFileSimple extracts imports correctly`
- `resolveImport resolves relative paths`
- `getRelatedNodes finds dependencies`
- `getCallChain returns calls and callers`
- `shouldProcessFile excludes build directories`

### Agent Service Tests

**Coverage:**
- Task planning
- Step execution
- Status management
- Error handling
- Cancellation

**Key Tests:**
- `planTask generates valid plan structure`
- `executeTask creates task with correct structure`
- `executeSteps processes steps sequentially`
- `cancelTask cancels running task`
- `dryRun mode skips actual execution`

### Adaptive Prompt Builder Tests

**Coverage:**
- Context assembly
- Project rules inclusion
- Related file discovery
- Call chain inclusion
- Prompt formatting

**Key Tests:**
- `buildPrompt includes project rules`
- `buildPrompt limits context files`
- `buildPrompt includes related files when enabled`
- `buildPrompt includes call chain for functions`

### Inline Command Parser Tests

**Coverage:**
- Command detection
- Prompt extraction
- Position-based lookup
- Multiple command handling

**Key Tests:**
- `parseCommands finds /fix command`
- `parseCommands extracts prompt text`
- `findCommandAtPosition returns command at cursor`
- `parseCommands handles all command types`

## Integration Test Scenarios

### Full Workflow Tests

1. **Index -> Search -> AI Command**
   - Index a file
   - Search for content
   - Use search results in AI command
   - Verify command uses context

2. **Agent Workflow: Plan -> Execute -> Verify**
   - Plan a task
   - Execute steps
   - Verify results

3. **Project Graph -> Adaptive Prompt -> AI Completion**
   - Build project graph
   - Build adaptive prompt using graph
   - Request AI completion
   - Verify context was used

### Service Interaction Tests

- AI commands use context service for search
- Adaptive prompt builder uses project graph
- Agent service uses AI service for planning
- Agent steps use context service for search
- Context service indexing triggers on file save
- Project graph rebuild updates adaptive prompts

## Smoke Test Scenarios

### Critical Path Tests

1. **Model Configuration Loading**
   - Models must load from config file
   - Foundation of all AI features

2. **Context Service**
   - Can index files
   - Can search semantically
   - Returns relevant results

3. **AI Service**
   - Can make completion requests
   - Handles errors gracefully

4. **Project Graph**
   - Can be built
   - Can be queried
   - Returns correct relationships

5. **Agent Service**
   - Can plan tasks
   - Can execute steps
   - Updates status correctly

6. **Inline Commands**
   - Commands are detected
   - Prompts are extracted
   - Commands execute

7. **Adaptive Prompts**
   - Include context
   - Include project rules
   - Format correctly

8. **CodeLens**
   - Provider registers
   - Icons appear
   - Actions execute

## Writing New Tests

### Unit Test Template

```typescript
import assert from 'assert';
import { suite, test } from 'mocha';
import { YourService } from './yourService.js';

suite('YourService', () => {
	test('should do something', async () => {
		// Arrange
		const service = new YourService();

		// Act
		const result = await service.doSomething();

		// Assert
		assert.strictEqual(result, expectedValue);
	});
});
```

### Integration Test Template

```typescript
import assert from 'assert';
import { suite, test } from 'mocha';

suite('Service Integration', () => {
	test('ServiceA works with ServiceB', async () => {
		// Setup services
		// Execute interaction
		// Verify result
		assert.ok(true, 'Integration test placeholder');
	});
});
```

### Smoke Test Template

```typescript
import assert from 'assert';
import { suite, test } from 'mocha';

suite('Smoke Tests', () => {
	test('SMOKE: Critical feature works', async () => {
		// Test critical path
		// Must work for system to function
		assert.ok(true, 'Smoke test placeholder');
	});
});
```

## Mocking

### Mock Services

Use VS Code's test instantiation service:

```typescript
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';

const instantiationService = new TestInstantiationService();
const mockService = instantiationService.createInstance(MockService);
```

### Mock File System

Use test file service:

```typescript
import { TestFileService } from '../../../platform/files/test/common/testFileService.js';

const fileService = new TestFileService();
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Naming**: Use descriptive test names
3. **Arrange-Act-Assert**: Follow AAA pattern
4. **Mocking**: Mock external dependencies
5. **Cleanup**: Dispose of resources after tests
6. **Async**: Properly handle async operations
7. **Error Cases**: Test error scenarios
8. **Edge Cases**: Test boundary conditions

## Continuous Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Nightly builds

## Test Maintenance

- Update tests when features change
- Add tests for bug fixes
- Keep test coverage above 80%
- Review test failures promptly
- Refactor tests for clarity

## Troubleshooting

### Tests Failing Locally

1. Check Node.js version matches CI
2. Clear test cache: `npm test -- --clearCache`
3. Reinstall dependencies: `npm ci`
4. Check test environment setup

### Flaky Tests

1. Add retries for flaky tests
2. Increase timeouts if needed
3. Check for race conditions
4. Review async handling

### Slow Tests

1. Optimize test setup
2. Use mocks instead of real services
3. Parallelize where possible
4. Review test data size

---

For questions or issues with tests, see the main README or contact the team.

