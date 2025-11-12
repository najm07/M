# AI Features for VS Code

This document describes the native AI enhancements integrated into VS Code, designed to outperform Cursor Editor with context-aware, multi-model AI assistance.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Features](#core-features)
- [Configuration](#configuration)
- [Usage Guide](#usage-guide)
- [Advanced Features](#advanced-features)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

This implementation adds native AI capabilities directly into VS Code, eliminating the need for extensions. The system provides:

- **Multi-Model Support**: Use OpenAI, Anthropic, or local models
- **Context-Aware Intelligence**: Understands your entire codebase
- **Inline Commands**: Execute AI actions directly in code
- **Agent Automation**: Multi-step task execution
- **Project Graph Reasoning**: Hierarchical code understanding

## Quick Start

### 1. Configure AI Models

Create `~/.void/config.json`:

```json
{
  "models": {
    "gpt-4": {
      "api": "https://api.openai.com/v1",
      "key": "sk-your-openai-key",
      "family": "openai",
      "default": true
    },
    "claude": {
      "api": "https://api.anthropic.com/v1",
      "key": "sk-ant-your-anthropic-key",
      "family": "anthropic"
    },
    "local": {
      "api": "http://localhost:11434",
      "family": "local"
    }
  }
}
```

### 2. Switch Models

Press `Ctrl+Shift+M` (or `Cmd+Shift+M` on Mac) to open the model picker and switch between configured models.

### 3. Start Using AI Commands

- **Inline Commands**: Type `// /fix` or `// /refactor` in comments
- **CodeLens**: Click AI icons above functions
- **Command Palette**: Press `Ctrl+Shift+/` for quick AI commands

## Core Features

### 1. Inline Commands

Execute AI actions directly in your code using comment-based commands:

```typescript
// /fix Add error handling to this function
function processData(data: any) {
  return data.map(item => item.value);
}

// /refactor Convert to async/await pattern
function fetchUser(id: string) {
  return fetch(`/api/users/${id}`).then(r => r.json());
}

// /explain What does this code do?
const result = complexAlgorithm(input);

// /doc Add JSDoc documentation
function calculateTotal(items: Item[]): number {
  // ...
}

// /test Generate unit tests
function validateEmail(email: string): boolean {
  // ...
}

// /optimize Improve performance
function sortLargeArray(arr: number[]): number[] {
  // ...
}
```

**How it works:**
1. Type a command in a comment (`// /fix`, `// /refactor`, etc.)
2. The system detects the command and executes it
3. AI analyzes the code and provides suggestions or applies changes

### 2. CodeLens Integration

AI action icons appear above function definitions:

- **✨ Explain** - Get explanation of the function
- **🪄 Refactor** - Refactor the function
- **🧪 Test** - Generate unit tests

**Usage:**
1. Open a file with function definitions
2. Look for AI icons above functions
3. Click an icon to execute the action

### 3. Command Palette

Quick access to all AI commands:

1. Press `Ctrl+Shift+/` (or `Cmd+Shift+/` on Mac)
2. Select an AI command:
   - Explain
   - Refactor
   - Fix
   - Generate Tests
   - Document
   - Optimize
3. The command executes on your selected code (or entire file if nothing selected)

### 4. Context-Aware Search

The system automatically indexes your codebase for semantic search:

**Automatic Indexing:**
- Files are indexed when saved
- New files are indexed on creation
- Deleted files are removed from index

**Manual Rebuild:**
```typescript
// Via command palette: "AI: Rebuild Context Index"
```

**Search API:**
The context service provides semantic search across your codebase:
- Finds related code by meaning, not just keywords
- Returns relevant snippets with similarity scores
- Used automatically by AI commands for better context

### 5. Project Graph Reasoning

The system builds a hierarchical graph of your project:

**What it tracks:**
- Import/export relationships
- Function call chains
- File dependencies
- Symbol references

**Location:** `.vscode/context/graph.json`

**Benefits:**
- AI understands code relationships
- Better context for refactoring
- Smarter code suggestions
- Dependency-aware changes

**Rebuild Graph:**
```typescript
// Via command palette: "AI: Rebuild Project Graph"
```

### 6. Adaptive Prompt Assembly

AI prompts are automatically enhanced with relevant context:

**What gets included:**
- Related files from project graph
- Call chains for functions
- Dependencies
- Semantic search results
- Project-specific rules

**Example:**
When you ask to refactor a function, the system:
1. Finds files that import this function
2. Finds functions this function calls
3. Includes related code from semantic search
4. Applies project rules
5. Builds a comprehensive prompt

### 7. Agent-Based Automation

Execute complex multi-step tasks:

**Basic Usage:**
1. Press `Ctrl+Shift+P` and run "AI: Execute Agent Task"
2. Describe your task: "Refactor API routes to TypeScript"
3. The agent plans and executes steps:
   - Search for related files
   - Generate refactored code
   - Apply changes
   - Run tests
   - Verify changes

**Agent Steps:**
- **Search**: Find relevant files or code
- **Generate**: Create new code
- **Edit**: Modify existing code
- **Test**: Run tests
- **Verify**: Check if changes work

**Monitor Tasks:**
- View active tasks: "AI: View Active Agent Tasks"
- Cancel tasks: "AI: Cancel Agent Task"

**Example Tasks:**
- "Add error handling to all API endpoints"
- "Convert all callbacks to async/await"
- "Generate unit tests for authentication module"
- "Refactor duplicate code into shared utilities"

## Configuration

### Model Configuration

Edit `~/.void/config.json`:

```json
{
  "models": {
    "model-id": {
      "api": "https://api.provider.com/v1",
      "key": "your-api-key",
      "family": "provider-name",
      "default": true,
      "metadata": {
        "custom": "settings"
      }
    }
  }
}
```

**Fields:**
- `api`: API endpoint URL
- `key`: API key (optional for local models)
- `family`: Provider family (openai, anthropic, local)
- `default`: Set as default model (optional)
- `metadata`: Additional configuration (optional)

### Project Rules

Create `.vscode/ai/rules.md` in your workspace:

```markdown
# Project AI Rules

- Always prefer functional components over class components
- Use async/await instead of .then() chains
- Use JSDoc for all public APIs
- Follow TypeScript strict mode
- Prefer const over let
- Use descriptive variable names
```

Rules are automatically included in all AI prompts.

### Context Index Location

The context index is stored at:
- **File-based**: `.vscode/context/index.json` (workspace)
- **Fallback**: VS Code storage (if file write fails)

### Project Graph Location

The project graph is stored at:
- `.vscode/context/graph.json`

## Usage Guide

### Basic Workflow

1. **Configure Models** (one-time setup)
   - Create `~/.void/config.json`
   - Add your API keys

2. **Open Workspace**
   - The system automatically indexes your code
   - Project graph is built in the background

3. **Use AI Commands**
   - Type inline commands: `// /fix`
   - Click CodeLens icons
   - Use command palette: `Ctrl+Shift+/`

4. **Monitor Progress**
   - Check notifications for AI responses
   - View agent task progress in status bar

### Advanced Workflow

1. **Set Project Rules**
   - Create `.vscode/ai/rules.md`
   - Define coding standards

2. **Rebuild Indexes** (if needed)
   - Rebuild context index: "AI: Rebuild Context Index"
   - Rebuild project graph: "AI: Rebuild Project Graph"

3. **Use Agents for Complex Tasks**
   - Describe multi-step refactoring
   - Let agent plan and execute
   - Review and approve changes

## Advanced Features

### Custom Agent Steps

Extend agent capabilities by implementing custom step types:

```typescript
// In agentServiceImpl.ts
case AgentStepType.Custom:
  return this.executeCustomStep(step, context, token);
```

### Context Service API

Use the context service programmatically:

```typescript
const contextService = accessor.get(IContextService);
const results = await contextService.search("authentication middleware", 10);
// Returns: Array of { uri, score, snippet, range }
```

### Project Graph API

Query project relationships:

```typescript
const graphService = accessor.get(IProjectGraphService);
const related = await graphService.getRelatedNodes(fileUri, symbol, 2);
const dependents = await graphService.getDependents(fileUri);
const dependencies = await graphService.getDependencies(fileUri);
const callChain = await graphService.getCallChain(fileUri, "functionName");
```

### Adaptive Prompt Builder

Build custom prompts with context:

```typescript
const builder = new AdaptivePromptBuilder(
  projectGraphService,
  contextService,
  fileService
);

const prompt = await builder.buildPrompt(editorContext, userPrompt, {
  maxContextFiles: 10,
  includeRelatedFiles: true,
  includeCallChain: true,
  includeDependencies: true,
  projectRules: ["Custom rule 1", "Custom rule 2"]
});
```

## Troubleshooting

### Models Not Loading

**Problem:** No models available in picker

**Solutions:**
1. Check `~/.void/config.json` exists and is valid JSON
2. Verify API endpoints are correct
3. Check API keys are valid
4. Restart VS Code

### Context Index Not Updating

**Problem:** Search results are outdated

**Solutions:**
1. Manually rebuild: "AI: Rebuild Context Index"
2. Check file permissions for `.vscode/context/`
3. Verify embedding service is enabled

### Agent Tasks Failing

**Problem:** Agent steps fail or timeout

**Solutions:**
1. Check AI model is configured and accessible
2. Verify workspace has required files
3. Check step descriptions are clear
4. Review logs: View → Output → "AI Agent"

### Project Graph Empty

**Problem:** No relationships found

**Solutions:**
1. Ensure code files are in workspace
2. Rebuild graph: "AI: Rebuild Project Graph"
3. Check file extensions are supported (.ts, .tsx, .js, .jsx)
4. Verify imports use relative paths

### Performance Issues

**Problem:** Slow indexing or search

**Solutions:**
1. Exclude large directories in `.vscode/ai/rules.md`
2. Limit context file count in prompts
3. Use smaller embedding models for local indexing
4. Disable auto-indexing for very large workspaces

## Architecture

### Service Layer

- **IAIService**: Core AI operations (completion, streaming, diff)
- **IContextService**: Semantic search and file indexing
- **IProjectGraphService**: Code relationship tracking
- **IAgentService**: Multi-step task execution

### Integration Points

- **Editor**: CodeLens, inline commands, editor context
- **Workbench**: Commands, progress, notifications
- **File System**: Indexing, graph building, rules loading

### Data Storage

- **Model Config**: `~/.void/config.json`
- **Context Index**: `.vscode/context/index.json`
- **Project Graph**: `.vscode/context/graph.json`
- **Project Rules**: `.vscode/ai/rules.md`

## Examples

### Example 1: Quick Fix

```typescript
// /fix Add null check for user parameter
function getUserData(user: User) {
  return user.data;
}
```

**Result:** AI adds null check and error handling.

### Example 2: Refactoring

```typescript
// /refactor Extract validation logic into separate function
function processOrder(order: Order) {
  if (!order.id || !order.items || order.items.length === 0) {
    throw new Error("Invalid order");
  }
  // ... rest of function
}
```

**Result:** AI extracts validation into `validateOrder()` function.

### Example 3: Agent Task

**Command:** "AI: Execute Agent Task"
**Description:** "Add TypeScript types to all JavaScript files in src/api"

**Agent Plan:**
1. Search for .js files in src/api
2. Generate TypeScript type definitions
3. Convert files to .ts
4. Update imports
5. Run TypeScript compiler
6. Verify no errors

**Result:** All files converted with proper types.

## Best Practices

1. **Keep Rules Updated**: Update `.vscode/ai/rules.md` as project evolves
2. **Rebuild Indexes**: Rebuild after major refactoring
3. **Use Specific Commands**: More specific prompts yield better results
4. **Review Agent Plans**: Review agent plans before execution
5. **Monitor Context Size**: Limit context files to avoid token limits
6. **Test Changes**: Always test AI-generated code

## Limitations

- **Language Support**: Best support for TypeScript/JavaScript (can be extended)
- **Large Workspaces**: May be slow on very large codebases (>100k files)
- **Model Dependencies**: Requires configured AI models
- **Embedding Service**: Requires embedding service for semantic search

## Testing

The AI features include comprehensive test coverage with unit, integration, and smoke tests.

### Running Tests

**Unit Tests:**
```bash
npm test -- --grep "Unit"
npm test -- src/vs/services/ai/common/aiService.test.ts
```

**Integration Tests:**
```bash
npm test -- --grep "Integration"
npm test -- src/vs/services/ai/common/integration.test.ts
```

**Smoke Tests:**
```bash
npm run test:smoke
npm run test:smoke -- --area ai
```

### Test Coverage

- **Unit Tests**: 14 test files covering all core services and components
- **Integration Tests**: Service interaction and workflow tests
- **Smoke Tests**: End-to-end critical path verification

See [TESTING.md](./TESTING.md) for detailed testing documentation.

## Future Enhancements

- [ ] Diff mode UI for reviewing AI changes
- [ ] Terminal integration for @workspace, @git commands
- [ ] Enhanced language service integration
- [ ] SQLite-based vector store for better performance
- [ ] Multi-language project graph support
- [ ] Visual project graph viewer

## Support

For issues or questions:
1. Check logs: View → Output → "AI Service"
2. Review this documentation
3. Check configuration files
4. Rebuild indexes if needed

---

**Note:** This is a native implementation integrated directly into VS Code. No extensions required!

