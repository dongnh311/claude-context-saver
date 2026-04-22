# Claude Log Compressor — Implementation Spec

> An MCP server that intercepts build/test/install commands, runs them, and returns a compressed summary to Claude instead of the raw multi-thousand-token output. Goal: dramatically reduce context consumption for Claude Code users (especially Pro tier) during iterative build/test loops.

---

## 1. Context & Goal

### Problem
When Claude Code runs commands like `gradle build`, `npm install`, `pytest`, or reads large log files, the output often consumes 5,000–20,000 tokens per invocation. Over a coding session with many iterations, this exhausts the context window and Pro-tier rate limits much faster than necessary. The vast majority of this output is noise (progress bars, repeated warnings, framework stack frames, passed test details).

### Solution
An MCP (Model Context Protocol) server that exposes "smart" versions of these commands. Claude Code calls the MCP tool instead of running the command via bash; the MCP server executes the command, captures the full output, classifies it, compresses it based on type, caches the full log to disk, and returns only the essential information to Claude — along with a reference ID so Claude can request deeper detail if needed.

### Non-goals
- Do NOT route requests to cheaper models.
- Do NOT modify Claude Code's internal prompts or behavior beyond adding tools.
- Do NOT replace all bash usage — only commands with predictable noisy output.
- Do NOT do semantic code analysis, only log compression.

---

## 2. Success Criteria

The project is successful when:

1. A user runs `npx claude-log-compressor` and it registers as an MCP server in Claude Code without manual config gymnastics.
2. For a real Android Gradle project, `smart_build` returns < 15% of the original log token count while preserving 100% of error messages and failure signals.
3. Claude Code can retrieve the full log on demand via a second tool call when the compressed view is insufficient.
4. Works reliably on macOS, Linux, and Windows (WSL acceptable for Windows).
5. Zero-config for common cases; opt-in config file for custom rules.

---

## 3. Architecture

```
┌─────────────┐         stdio/JSON-RPC          ┌──────────────────────┐
│ Claude Code │ ─────────────────────────────►  │  MCP Server (Node)   │
└─────────────┘                                  │                      │
     ▲                                           │  ┌────────────────┐  │
     │  compressed output                        │  │  Tool router   │  │
     │                                           │  └────────┬───────┘  │
     │                                           │           ▼          │
     │                                           │  ┌────────────────┐  │
     │                                           │  │  Executor      │  │
     │                                           │  │  (child_proc)  │  │
     │                                           │  └────────┬───────┘  │
     │                                           │           ▼          │
     │                                           │  ┌────────────────┐  │
     │                                           │  │  Classifier    │  │
     │                                           │  └────────┬───────┘  │
     │                                           │           ▼          │
     │                                           │  ┌────────────────┐  │
     │                                           │  │  Compressor    │  │
     │                                           │  │  (per-type)    │  │
     │                                           │  └────────┬───────┘  │
     │                                           │           ▼          │
     │                                           │  ┌────────────────┐  │
     │                                           │  │  Cache (disk)  │  │
     │                                           │  └────────────────┘  │
     │                                           └──────────────────────┘
```

---

## 4. MVP Scope (Phase 1 — target 2 weeks)

### Tools to expose

#### `smart_run`
Generic fallback. Runs an arbitrary shell command and compresses output using the generic compressor.

**Input schema:**
```json
{
  "command": "string (required)",
  "cwd": "string (optional, default = process.cwd())",
  "timeout_seconds": "number (optional, default = 300)",
  "max_output_tokens": "number (optional, default = 2000)"
}
```

#### `smart_build`
Dispatches to the right build-tool compressor based on auto-detection or explicit hint.

**Input schema:**
```json
{
  "tool": "string (optional: 'gradle' | 'npm' | 'cargo' | 'make' | 'auto', default = 'auto')",
  "args": "string (optional, default = '')",
  "cwd": "string (optional)"
}
```

#### `smart_test`
Runs a test command and returns only failures + summary.

**Input schema:**
```json
{
  "framework": "string (optional: 'junit' | 'jest' | 'pytest' | 'go' | 'auto', default = 'auto')",
  "pattern": "string (optional, filters which tests to run)",
  "cwd": "string (optional)"
}
```

#### `read_log_section`
Retrieves a section of a previously cached full log.

**Input schema:**
```json
{
  "log_id": "string (required, from a previous compressed result)",
  "grep": "string (optional, filter lines matching this pattern)",
  "lines_around": "number (optional, context lines around matches, default = 3)",
  "start_line": "number (optional)",
  "end_line": "number (optional)"
}
```

### Compressors to implement in MVP

1. **Gradle compressor** — the showcase compressor. Keep: `BUILD FAILED/SUCCESSFUL`, errors with file:line, unique warnings (deduped), final task summary. Drop: `Download ...`, progress lines, `> Task :xxx UP-TO-DATE`, configure-on-demand chatter.

2. **npm/yarn compressor** — Keep: errors, `npm ERR!` blocks, final "added X packages". Drop: progress bars, deprecation warnings (collapse to count), audit noise.

3. **Generic compressor** — Fallback. Dedupe consecutive identical lines, truncate middle if output is huge (keep first 30% + last 50%), preserve all lines matching `/error|fail|exception|fatal/i` (case-insensitive).

4. **Test compressors** — JUnit XML parser (for Gradle/Maven), Jest text parser, Pytest text parser. Keep: failed test name, assertion message, relevant stack frames (filter out node_modules / framework internals). Drop: passed test names (collapse to count).

### Out of MVP (Phase 2+)
- Streaming output for long-running commands
- Project-specific `.claude-log-compress.toml` config
- HTTP transport
- Windows native (non-WSL) support
- Cargo, Maven, Go, .NET compressors
- Web dashboard to inspect cached logs

---

## 5. Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js >= 18
- **MCP SDK:** `@modelcontextprotocol/sdk` (latest stable)
- **Process execution:** Node's `child_process.spawn` (NOT `exec` — need streaming for large outputs)
- **Testing:** `vitest`
- **Build:** `tsc` (no bundler — keep it simple, MCP servers are small)
- **Lint/format:** `biome` (single tool, fast, zero-config friendly)

**Rationale for Node over Python:** MCP TypeScript SDK is the most mature; npx distribution is frictionless for end users; no Python version hell.

---

## 6. File Structure

```
claude-log-compressor/
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── LICENSE                       # MIT
├── .gitignore
├── .npmignore
├── src/
│   ├── index.ts                  # Entry point with shebang, wires up server
│   ├── server.ts                 # MCP server setup, tool registration
│   ├── tools/
│   │   ├── smart-run.ts
│   │   ├── smart-build.ts
│   │   ├── smart-test.ts
│   │   └── read-log-section.ts
│   ├── executor.ts               # spawn wrapper with timeout + stdout/stderr capture
│   ├── classifier.ts             # Detect output type from content/command
│   ├── compressors/
│   │   ├── index.ts              # Compressor registry + dispatcher
│   │   ├── gradle.ts
│   │   ├── npm.ts
│   │   ├── generic.ts
│   │   ├── jest.ts
│   │   ├── pytest.ts
│   │   └── junit.ts
│   ├── cache.ts                  # Disk cache for full logs (~/.cache/claude-log-compressor/)
│   ├── tokens.ts                 # Rough token estimation (chars/4 is fine for MVP)
│   └── types.ts                  # Shared types
├── test/
│   ├── fixtures/
│   │   ├── gradle-success.log
│   │   ├── gradle-failure.log
│   │   ├── npm-install.log
│   │   └── ...
│   ├── compressors.test.ts
│   └── executor.test.ts
└── bin/                          # (Optional — or use "bin" field pointing to dist/index.js)
```

---

## 7. Interface Contracts

### Compressor interface

Every compressor must implement:

```typescript
interface Compressor {
  name: string;
  // Should this compressor handle this output? Used for auto-detection.
  canHandle(input: ClassifierInput): boolean;
  compress(fullLog: string, context: CompressContext): CompressedResult;
}

interface ClassifierInput {
  command: string;          // The command that was run
  cwd: string;
  exitCode: number;
  firstKb: string;          // First 1KB of output for quick sniffing
}

interface CompressContext {
  maxTokens: number;
  logId: string;            // For referencing back to full log
}

interface CompressedResult {
  summary: string;          // Short high-level: "BUILD FAILED (2 errors, 14 warnings)"
  body: string;             // The compressed content Claude will read
  originalTokens: number;   // Estimated
  compressedTokens: number; // Estimated
  logId: string;            // Cache key for full log
  truncatedSections: TruncatedSection[]; // Hints for read_log_section
}

interface TruncatedSection {
  description: string;      // "Passed tests (127)"
  startLine: number;
  endLine: number;
}
```

### Output format returned to Claude

Every tool response must use this consistent text format so Claude learns the pattern:

```
BUILD FAILED (2 errors, 14 warnings)

Errors:
  app/build.gradle.kts:45 — Unresolved reference: viewBinding
  MainActivity.kt:128 — Type mismatch: expected String, found Int?

Warnings (14 unique, showing top 3 by frequency):
  [×8] 'foo' is deprecated. Use 'bar' instead.
  [×4] Unused import: com.example.Baz
  [×2] Variable 'x' is never used

Final task: :app:compileDebugKotlin FAILED

---
[Compressed from ~15,234 tokens → ~1,847 tokens (87% reduction)]
[Full log cached as log_id="grd_abc123". Use `read_log_section` tool to query details.]
```

Always include the `log_id` and a hint about `read_log_section` — Claude needs to know the escape hatch exists.

---

## 8. Implementation Milestones

Implement in this order — each milestone should end with a working, committable state.

### M1: Scaffolding (day 1)
- [ ] Init npm package, tsconfig, biome config, gitignore
- [ ] Install `@modelcontextprotocol/sdk`
- [ ] Minimal `src/index.ts` that starts an MCP server over stdio with zero tools
- [ ] Verify it launches: `node dist/index.js` starts and accepts MCP handshake
- [ ] Add `"bin"` field so `npx .` works locally

### M2: Executor + Generic compressor + smart_run (days 2–3)
- [ ] `executor.ts`: spawn wrapper with timeout, captures stdout+stderr, returns `{stdout, stderr, exitCode, durationMs}`
- [ ] `cache.ts`: write full logs to `~/.cache/claude-log-compressor/<logId>.log`, with auto-cleanup of logs older than 7 days
- [ ] `compressors/generic.ts`: dedupe, preserve error-matching lines, middle-truncate
- [ ] `tools/smart-run.ts`: wire executor → generic compressor → formatted response
- [ ] Register tool, test via MCP inspector (`npx @modelcontextprotocol/inspector`)

### M3: Gradle compressor (days 4–5)
- [ ] `compressors/gradle.ts`: parse Gradle output, extract BUILD status, errors with file:line, dedup warnings, final task
- [ ] Test fixtures: capture real outputs from a sample Android project (success + various failure modes: compile error, test failure, resource error, dependency resolution failure)
- [ ] `tools/smart-build.ts` with auto-detection (look for `build.gradle*` or `gradlew` in cwd)
- [ ] Benchmark: document token reduction % on fixtures

### M4: npm compressor + Test compressors (days 6–8)
- [ ] npm compressor (install, run scripts)
- [ ] Jest compressor
- [ ] Pytest compressor
- [ ] JUnit XML parser for Gradle/Maven test results
- [ ] `tools/smart-test.ts` with auto-detection

### M5: read_log_section (day 9)
- [ ] Implement grep with context lines
- [ ] Implement line-range reads
- [ ] Return a token-bounded slice (default 2000 tokens max)

### M6: Polish + release prep (days 10–12)
- [ ] README with: 30-second pitch, install command, benchmark table, example Claude Code config, FAQ
- [ ] Demo recording (asciinema or GIF) showing token reduction
- [ ] CI: GitHub Actions running tests on macOS + Linux, Node 18/20/22
- [ ] `npm publish --access public` (or `--dry-run` first)

### M7: Integration testing with real Claude Code (days 13–14)
- [ ] Configure locally, run through a realistic Android build/test session
- [ ] Measure actual token usage in Claude Code before/after
- [ ] Fix issues surfaced by real usage
- [ ] Tag v0.1.0

---

## 9. How Claude Code Picks This Up

Two distribution mechanisms — document both in README.

### Option A: User config file

Claude Code reads MCP config from `~/.claude/mcp.json` (or project-local `.claude/mcp.json`). User adds:

```json
{
  "mcpServers": {
    "log-compressor": {
      "command": "npx",
      "args": ["-y", "claude-log-compressor"]
    }
  }
}
```

### Option B: One-liner install script

Provide `npx claude-log-compressor install` that:
1. Detects Claude Code config location
2. Adds the server entry if not already present
3. Prints next steps

This is the "wow" path — most users will use this.

### Ensuring Claude Code prefers smart_* over bash

This is the subtle part. Claude Code's model already has strong priors to use `bash` for builds. Two strategies:

1. **Tool descriptions are the lever.** Write tool descriptions that explicitly say when to prefer them. Example:

   ```
   smart_build: Run a build command with automatic output compression.
   ALWAYS prefer this over running gradle/npm/cargo via bash — it returns
   the same information in 5–10× fewer tokens, preserving all errors and
   warnings while stripping noise. Use bash only if this tool fails.
   ```

2. **Project-level CLAUDE.md guidance.** In the README, show users how to add to their project's `CLAUDE.md`:

   ```markdown
   ## Build/test commands
   Always use the `smart_build` and `smart_test` tools (from the
   log-compressor MCP server) instead of invoking gradle/npm/jest
   directly via bash. They return compressed, Claude-friendly output.
   ```

The model cannot be forced, but with clear tool descriptions + project-level guidance, adherence is high in practice.

---

## 10. Testing Strategy

### Unit tests (vitest)
- Each compressor: feed fixture → assert compressed output contains expected signals and drops expected noise.
- Executor: timeout behavior, exit code propagation, large output handling.
- Cache: write, read, expiry.

### Integration tests
- Spawn the MCP server as a subprocess, send JSON-RPC calls, assert responses.
- Use `@modelcontextprotocol/sdk`'s client utilities.

### Manual validation
- Run against a real Android project (use the user's own side project `Walkin` as a test bed).
- Record before/after token counts.

### Benchmark script
Add `scripts/benchmark.ts` that runs all fixtures through their compressors and prints a table:

```
Fixture                        Original    Compressed  Reduction
gradle-android-success.log     14,832      892         94.0%
gradle-android-compile-err.log 16,214      1,643       89.9%
npm-install-large.log          8,421       412         95.1%
jest-100-tests-3-fail.log      22,103      1,284       94.2%
```

This table goes into the README verbatim.

---

## 11. Code Style Rules

- TypeScript strict mode. No `any` unless commented with justification.
- Brute force first, readable over clever. No fancy functional chains when a `for` loop is clearer.
- All comments in English only.
- No external runtime deps beyond `@modelcontextprotocol/sdk` for MVP. Node stdlib (child_process, fs, path, crypto) covers everything else.
- Error handling: every tool handler wraps its body in try/catch and returns a structured error response; never let an exception crash the MCP server.
- Logging: write diagnostic logs to `~/.cache/claude-log-compressor/server.log`, NEVER to stdout (stdout is the MCP transport).

---

## 12. Known Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Claude Code model ignores `smart_*` and uses bash anyway | Strong tool descriptions + README guidance on CLAUDE.md snippet |
| Compressor drops a critical line | `read_log_section` escape hatch; always preserve lines matching error patterns; include `log_id` in every response |
| Gradle output format varies across versions | Fixtures from Gradle 7.x and 8.x; classify by sniffing version banner |
| User's CI sets `NO_COLOR=0` and output has ANSI codes | Strip ANSI in executor before passing to compressor |
| Very long-running builds hit timeout | Make timeout configurable; consider streaming in Phase 2 |
| Disk cache grows unbounded | 7-day auto-cleanup on each server start |

---

## 13. First Deliverable

After M2, there should be a working end-to-end flow:

1. User configures MCP server in Claude Code.
2. User asks Claude to run `npm install` in a directory.
3. Claude calls `smart_run` with `command: "npm install"`.
4. Server runs it, generic compressor compresses, returns summary + log_id.
5. Claude sees the compressed output and can ask for details via `read_log_section`.

If this works, everything after is incremental improvement.

---

## 14. Questions to Resolve Before Starting

Before writing code, confirm with the project owner:

1. **Package name availability** — run `npm view claude-log-compressor`. If taken, fall back to `@dongnh/claude-log-compressor`.
2. **License** — MIT as assumed, or something else?
3. **GitHub org** — personal repo or org?
4. **Analytics/telemetry** — none for v0.1.0. Revisit later if needed, but must be opt-in.
