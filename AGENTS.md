# Repository Guidance

This workspace is opened at the repository root (`NotchCopy`). It contains one active application package and two read-only reference/artifact directories:

- `teleprompter/` — Active Electron + React + Vite + TypeScript application (`private-teleprompter` v1.0.0).
- `extracted/` — Extracted Electron bundle (`notch`) for reference only (compiled `dist/` only, no `src/` or build scripts).
- `resources/` — Packaged `app.asar` binary artifact.

## Navigation

- **Read [`teleprompter/AGENTS.md`](teleprompter/AGENTS.md) before making any changes in `teleprompter/`.**
- Run all `npm` scripts from inside `teleprompter/`.
- Do not edit `extracted/` or `resources/` unless explicitly asked.

## Search & Indexing

- **Code graph**: A code-only Graphify index for `teleprompter/src` lives at `graphify-out/graph.json` (with `graphify-out/GRAPH_REPORT.md` summarizing communities and hubs). Use it first for cross-file architecture, call paths, and impact analysis (`graphify query`, `graphify path`, `graphify explain`, `graphify affected`, `graphify god-nodes`), then verify in source.
- **Exclusions**: Always exclude `teleprompter/node_modules/`, `teleprompter/dist/`, `teleprompter/release/`, `teleprompter/test-results/`, `teleprompter/playwright-report/`, `extracted/`, `resources/`, and `graphify-out/` from routine text/file searches.
- **Windows shell**: `rg` is not on `PATH`. Use LSP for symbol lookups, `git ls-files` for file discovery, and `Select-String` scoped directly to `teleprompter\src` or `teleprompter\tests` (avoid deep `Get-ChildItem -Exclude` from `teleprompter/`, which still traverses `node_modules`).
