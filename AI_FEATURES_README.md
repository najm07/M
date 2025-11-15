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

- **Multi-Model Support**: Use OpenAI, Anthropic, or local models (Ollama)
- **Context-Aware Intelligence**: Understands your entire codebase with SQLite vector store
- **Inline Commands**: Execute AI actions directly in code
- **Agent Automation**: Multi-step task execution with secure sandbox
- **Project Graph Reasoning**: Hierarchical code understanding
- **Extension Bridge SDK**: Extend AI capabilities through extensions
- **Diff Review UI**: Review AI changes before applying them
- **Terminal AI Commands**: Use `@workspace` and `@git` commands in terminal

## Quick Start

### 1. Configure AI Models

The configuration file is automatically created at `~/.void/config.json` when you first use AI features. You can manage models through the UI (see section 2 below) or edit the file directly.

**Manual Configuration** (if you prefer editing JSON directly):

Create or edit `~/.void/config.json`:

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

### 2. Using the UI to Manage Models

You can manage AI models through a graphical interface:

**Add a New Model:**
- Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) → Type "AI: Add AI Model"
- Follow the step-by-step wizard:
  1. Enter a unique model ID (e.g., `ollama-llama3`)
  2. Enter the API URL (e.g., `http://localhost:11434` for Ollama or `https://api.openai.com/v1` for OpenAI)
  3. Select the model family (Ollama, OpenAI, Anthropic, or Custom)
  4. Enter API key if needed (for cloud APIs)
  5. Choose whether to set as default model

**Manage Models:**
- Press `Ctrl+Shift+P` → Type "AI: Manage AI Models"
- View all configured models
- Switch between models
- Set default model
- Delete models

**Open Config File:**
- Press `Ctrl+Shift+P` → Type "AI: Open AI Configuration File"
- Edit the JSON file directly if you prefer

**Switch Models Quickly:**
- Press `Ctrl+Alt+M` (or `Cmd+Alt+M` on Mac) to open the model picker
- Or use Command Palette → "AI: Switch AI Model"

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

The system builds a hierarchical graph of your project with enhanced multi-language support:

**What it tracks:**
- Import/export relationships
- Function call chains
- File dependencies
- Symbol references
- Class and function definitions

**Supported Languages:**
- TypeScript/JavaScript (with language service integration)
- Python (with tree-sitter WASM)
- Java, C/C++, C#, Go, Rust, Ruby, PHP (with tree-sitter WASM)
- Falls back to regex parsing for unsupported languages

**Location:** `.vscode/context/graph.json`

**Benefits:**
- AI understands code relationships across multiple languages
- Better context for refactoring
- Smarter code suggestions
- Dependency-aware changes
- Fast WASM-based parsing for performance-critical indexing

**Visual Graph Viewer:**
- Press `Ctrl+Shift+G` (or `Cmd+Shift+G` on Mac) to open the visual project graph
- Interactive D3.js visualization of your codebase structure
- Click nodes to open files
- Drag nodes to rearrange the graph
- Refresh button to rebuild the graph

**Rebuild Graph:**
```typescript
// Via command palette: "AI: Rebuild Project Graph"
// Or use the refresh button in the visual graph viewer
```

**Performance:**
- Uses WASM-based analyzers for fast parsing
- Parallel processing for large codebases
- Language service integration for TypeScript/JavaScript for best accuracy

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

Execute complex multi-step tasks with secure sandbox execution:

**Basic Usage:**
1. Press `Ctrl+Shift+P` and run "AI: Execute Agent Task"
2. Describe your task: "Refactor API routes to TypeScript"
3. The agent plans and executes steps:
   - Search for related files
   - Generate refactored code
   - Apply changes
   - Run tests (in secure sandbox)
   - Verify changes

**Agent Steps:**
- **Search**: Find relevant files or code
- **Generate**: Create new code
- **Edit**: Modify existing code
- **Test**: Run tests in isolated sandbox
- **Verify**: Validate changes before applying

**Secure Sandbox:**
All agent-executed code runs in an isolated sandbox with:
- **Isolation**: Code runs in temporary directories
- **Safety Checks**: Validates for dangerous patterns (eval, process.exit, etc.)
- **Timeouts**: Automatic termination of long-running operations
- **Resource Limits**: Memory and execution time constraints
- **Command Whitelist**: Only approved commands can execute
- **Automatic Cleanup**: Sandbox directories cleaned after execution

**Monitor Tasks:**
- View active tasks: "AI: View Active Agent Tasks"
- Cancel tasks: "AI: Cancel Agent Task"

**Example Tasks:**
- "Add error handling to all API endpoints"
- "Convert all callbacks to async/await"
- "Generate unit tests for authentication module"
- "Refactor duplicate code into shared utilities"

### 8. Diff Review UI

Review AI-generated changes before applying them:

**How it works:**
1. When AI generates code changes, a diff review is automatically created
2. A diff editor opens showing original vs modified code
3. Review changes side-by-side
4. Accept, reject, or partially accept changes

**Commands:**
- `AI: Accept AI Changes` - Accept all changes from a review
- `AI: Reject AI Changes` - Reject and discard changes
- `AI: Show Pending AI Reviews` - View all pending reviews

**Usage:**
```typescript
// After AI generates changes, a diff review opens automatically
// Review the changes in the diff editor
// Click "Accept" or "Reject" buttons, or use commands
```

**Partial Acceptance:**
You can accept only specific hunks from a diff review. The system tracks which parts were accepted.

### 9. Terminal AI Commands

Use AI-powered commands directly in the terminal:

**@workspace Command:**
Query your workspace with natural language:
```bash
@workspace How does authentication work in this project?
@workspace Where is the user model defined?
@workspace Show me error handling patterns
```

**@git Command:**
Get AI assistance with git operations:
```bash
@git status
@git commit message for these changes
@git how to undo last commit
@git create branch for feature
```

**How it works:**
1. Type `@workspace` or `@git` followed by your question/command
2. The system intercepts the command
3. AI processes it with workspace/git context
4. Results are displayed in the terminal

**Features:**
- **@workspace**: Uses semantic search to find relevant code
- **@git**: Analyzes git status and history for context-aware suggestions
- **Safety**: Dangerous git commands are flagged with warnings
- **Automatic**: Commands are intercepted and processed automatically

**Examples:**
```bash
# Workspace queries
@workspace find all API endpoints
@workspace explain the authentication flow
@workspace where are database models defined

# Git assistance
@git what changed in the last 3 commits?
@git how to merge feature branch safely
@git create commit message for staged changes
```

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

The context index uses a high-performance SQLite vector store:
- **Primary**: `.vscode/context/context-{workspaceId}.db` (SQLite database)
- **Fallback**: `.vscode/context/index.json` (JSON format)
- **Automatic**: Falls back to JSON if SQLite is unavailable

**Benefits of SQLite Vector Store:**
- Faster semantic search with optimized vector similarity
- Efficient storage of embeddings as BLOBs
- Full-text search fallback using FTS5
- Better performance on large codebases
- Automatic workspace isolation

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

### Extension Bridge SDK

Extend AI capabilities through VS Code extensions using the Extension Bridge API:

**Register a Context Provider:**
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Register a context provider
  const provider = vscode.ai.registerContextProvider({
    provideContext(query, token) {
      // Return custom context items
      return [
        {
          id: 'custom-item-1',
          type: 'file',
          uri: vscode.Uri.file('/path/to/file.ts'),
          content: 'Custom context content',
          metadata: { source: 'my-extension' }
        }
      ];
    },
    getContext(uri, symbol, token) {
      // Return context for specific file/symbol
      return {
        id: `${uri.toString()}#${symbol}`,
        type: 'symbol',
        uri,
        metadata: { custom: 'data' }
      };
    },
    getRelated(itemId, relationshipTypes, token) {
      // Return related items
      return [];
    }
  });

  context.subscriptions.push(provider);
}
```

**Query Context:**
```typescript
// Query the AI context system
const results = await vscode.ai.queryContext({
  query: 'authentication middleware',
  maxResults: 10,
  filters: {
    languageIds: ['typescript'],
    filePatterns: ['**/*.ts']
  }
});

// Get context for a specific file
const context = await vscode.ai.getContext(
  vscode.Uri.file('/path/to/file.ts'),
  'functionName'
);

// Get related context
const related = await vscode.ai.getRelatedContext('item-id', [
  'imports', 'calls', 'references'
]);

// Contribute your own context
vscode.ai.contributeContext({
  id: 'my-context-item',
  type: 'metadata',
  content: 'Custom context data',
  metadata: { extension: 'my-extension' }
});
```

**Use Cases:**
- Add domain-specific context (database schemas, API docs)
- Integrate external tools (Jira, Confluence, documentation)
- Provide framework-specific insights
- Share context across workspace extensions

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
4. Check SQLite database is accessible (if using vector store)
5. Review logs for SQLite errors: View → Output → "AI Service"

### Agent Tasks Failing

**Problem:** Agent steps fail or timeout

**Solutions:**
1. Check AI model is configured and accessible
2. Verify workspace has required files
3. Check step descriptions are clear
4. Review logs: View → Output → "AI Agent"
5. **Sandbox Issues**: Check if test commands are whitelisted
6. **Timeout**: Increase timeout in sandbox options if tests take longer
7. **Validation Errors**: Review sandbox validation errors for dangerous patterns

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
5. **SQLite Vector Store**: Automatically provides better performance than JSON storage
6. **Vector Store**: Check if SQLite database is being used (check logs)
7. **Large Workspaces**: Consider rebuilding index periodically

## Architecture

### Service Layer

- **IAIService**: Core AI operations (completion, streaming, diff)
- **IContextService**: Semantic search and file indexing
- **IProjectGraphService**: Code relationship tracking
- **IAgentService**: Multi-step task execution
- **IAIDiffReviewService**: Diff review and change management
- **ITerminalCommandService**: Terminal command interception and processing
- **IExtensionBridgeService**: Extension API for context sharing

### Integration Points

- **Editor**: CodeLens, inline commands, editor context
- **Workbench**: Commands, progress, notifications
- **File System**: Indexing, graph building, rules loading

### Data Storage

- **Model Config**: `~/.void/config.json`
- **Context Index**: `.vscode/context/context-{workspaceId}.db` (SQLite) or `.vscode/context/index.json` (fallback)
- **Project Graph**: `.vscode/context/graph.json`
- **Project Rules**: `.vscode/ai/rules.md`
- **Sandbox**: `.vscode/sandbox/` (temporary, auto-cleaned)
- **Diff Reviews**: `.vscode/ai-diff-reviews/` (temporary, auto-cleaned)

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

### Example 4: Diff Review

**Scenario:** AI suggests refactoring a function

**Process:**
1. AI generates changes
2. Diff review opens automatically
3. Review changes side-by-side
4. Accept or reject changes

**Result:** Changes applied only after review and approval.

### Example 5: Terminal Commands

**@workspace Query:**
```bash
@workspace How does the authentication middleware work?
```

**Result:** AI searches codebase and explains authentication flow with code references.

**@git Command:**
```bash
@git create commit message for staged changes
```

**Result:** AI analyzes changes and suggests a commit message.

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

## Local AI Support (Ollama)

VS Code Apex includes native support for local AI models via Ollama, enabling offline AI assistance and privacy-first development.

### Setting Up Ollama

1. **Install Ollama**: Download from [ollama.ai](https://ollama.ai)

2. **Pull a Model**:
   ```bash
   ollama pull llama3.1
   ollama pull codellama
   ```

3. **Configure in VS Code**:
   Edit `~/.void/config.json`:
   ```json
   {
     "models": {
       "llama3.1": {
         "api": "http://localhost:11434",
         "family": "ollama",
         "default": true
       },
       "codellama": {
         "api": "http://localhost:11434",
         "family": "ollama"
       },
       "gpt-4": {
         "api": "https://api.openai.com/v1",
         "key": "sk-your-key",
         "family": "openai"
       }
     }
   }
   ```

### Hybrid Routing (Local → Cloud Fallback)

The system automatically:
- **Tries local Ollama first** for faster, private responses
- **Falls back to cloud** if Ollama is unavailable or fails
- **Seamlessly switches** between local and cloud models

This provides:
- **Privacy**: Code never leaves your machine when using local models
- **Speed**: Lower latency for local requests
- **Reliability**: Automatic fallback ensures you're never blocked
- **Cost**: Free local inference vs paid cloud APIs

### Health Checks

The system automatically checks Ollama availability before each request. If Ollama is down or unreachable, it gracefully falls back to configured cloud models.

## Future Enhancements

- [x] Local Ollama integration with hybrid routing
- [x] SQLite-based vector store for better performance
- [x] Secure sandbox for agent execution
- [x] Extension Bridge SDK for context sharing
- [x] Diff mode UI for reviewing AI changes
- [x] Terminal integration for @workspace, @git commands
- [x] Enhanced language service integration
- [x] Multi-language project graph support
- [x] Visual project graph viewer
- [x] WASM-based analyzers for performance-critical indexing

## Support

For issues or questions:
1. Check logs: View → Output → "AI Service"
2. Review this documentation
3. Check configuration files
4. Rebuild indexes if needed

---

**Note:** This is a native implementation integrated directly into VS Code. No extensions required!

