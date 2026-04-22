# CLAUDE.md

Guidance for Claude Code working on this repo.

## Project

**claude-log-compressor** — An MCP server that intercepts build/test/install commands, runs them, and returns a compressed summary to Claude instead of raw multi-thousand-token output. Goal: cut context consumption for Claude Code users (especially Pro tier) during iterative build/test loops.

Authoritative implementation spec: **`SPEC.md`**. High-level pitch/roadmap: `spec-overview.md`.

Success bar (see SPEC §2): on a real Android Gradle project, `smart_build` returns < 15% of original log tokens while preserving 100% of error messages.

## Stack & constraints

- TypeScript strict mode, Node ≥ 18, ESM.
- **Runtime deps: `@modelcontextprotocol/sdk` only.** Everything else must come from Node stdlib (`child_process`, `fs`, `path`, `crypto`, `os`). Do NOT add `execa`, `strip-ansi`, `tiktoken`, `zod`, etc. If you think you need one, re-read this line.
- Build: `tsc` (no bundler — MCP servers are small, keep it simple).
- Tests: `vitest`.
- Lint/format: `biome` (single tool, zero fuss).
- Distribution: `npx claude-log-compressor` via npm.

## Layout

```
src/
  index.ts                    # shebang entrypoint, prune cache, connect stdio
  server.ts                   # MCP tool registration + dispatch
  executor.ts                 # spawn wrapper (timeout, maxBuffer, stripAnsi)
  classifier.ts               # command + firstKb → OutputKind
  cache.ts                    # ~/.cache/claude-log-compressor/<logId>.log, 7d TTL
  tokens.ts                   # chars/4 estimator (MVP heuristic)
  types.ts                    # Compressor, CompressedResult, ExecResult, etc.
  tools/
    smart-run.ts              # any command → classify → compress
    smart-build.ts            # gradle/npm/cargo/make dispatch
    smart-test.ts             # jest/pytest/junit/go dispatch
    read-log-section.ts       # grep + line-range over cached log
  compressors/
    index.ts                  # registry/dispatcher
    generic.ts                # dedupe consecutive + preserve /error|fail|…/ + middle-truncate
    gradle.ts                 # M3
    npm.ts                    # M4
    jest.ts                   # M4
    pytest.ts                 # M4
    junit.ts                  # M4
test/
  fixtures/                   # real captured logs (gradle-success.log, jest-*.log, …)
```

## Pipeline (§3 of SPEC)

```
raw output → executor (stripAnsi, timeout, maxBuffer)
           → classifier (command + firstKb 1KB)
           → compressor (type-specific, falls back to generic)
           → cache full log to ~/.cache/claude-log-compressor/<logId>.log
           → format response (summary + body + stats + log_id hint)
```

Every response MUST include the `log_id` and a hint that `read_log_section` exists — Claude needs to know the escape hatch.

## Response format (§7 of SPEC — don't change without updating SPEC)

```
<summary line with status>

<body: errors, warnings (with dedupe counts), final task>

---
[Compressed from ~X tokens → ~Y tokens (Z% reduction)]
[Full log cached as log_id="prefix_abc123". Use read_log_section to query details.]
```

Log IDs are prefixed by output kind: `grd_…`, `npm_…`, `jest_…`, `pytest_…`, `junit_…`, `generic_…`.

## Conventions

- **stdout is the MCP transport — never write to it.** Diagnostic logs go to `~/.cache/claude-log-compressor/server.log` via `cache.ts#serverLogPath`. Use `process.stderr` only for last-resort fatals.
- Every tool handler wraps its body in try/catch (done in `server.ts`). Never let an exception crash the MCP server.
- Every compressor must **always preserve lines matching `/error|fail(ed|ure)?|exception|fatal|panic/i`** — dropping a real error is the only unrecoverable bug. When in doubt, fall back to generic.
- Strip ANSI in the executor, not in compressors.
- No `any` without a justification comment. Brute-force readable code beats clever functional chains — SPEC §11.
- Keep log IDs short but collision-safe: `<prefix>_<12 hex>`.
- Cache cleanup: prune logs older than 7 days at server start (happens in `index.ts#main`).

## Commands

- `npm run build` — `tsc` → `dist/`, postbuild adds shebang + chmod +x
- `npm run dev` — `tsc --watch`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest once
- `npm run lint` / `npm run format` — biome
- `npx @modelcontextprotocol/inspector node dist/index.js` — manually exercise tools

## MVP milestones (SPEC §8 — do not expand without explicit ask)

- **M1** scaffolding — done at commit of this refactor.
- **M2** executor + generic compressor + `smart_run` — generic.ts wired, real error paths next.
- **M3** gradle compressor + `smart_build` auto-detect + fixtures.
- **M4** npm + jest + pytest + junit compressors + `smart_test` auto-detect.
- **M5** `read_log_section` polish (grep + context + line range + token cap).
- **M6** README with benchmark table, demo recording, CI, npm publish.
- **M7** real Claude Code dogfood on an Android project, measure token delta, tag v0.1.0.

Out of MVP: streaming, `.claude-log-compress.toml` config, HTTP transport, native Windows, Cargo/Maven/Go/.NET compressors, web dashboard.

## Benchmark rule

Every compressor ships with at least one fixture in `test/fixtures/`. A test asserts the compressor hits the target reduction % (SPEC §10 table). If a change drops reduction below target, treat it as a regression and fix it before merging.
