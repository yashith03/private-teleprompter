# teleprompter (`private-teleprompter`)

## Purpose

Offline-first Windows 11 Electron + React + Vite + TypeScript teleprompter overlay (`v1.0.0`) with capture exclusion (`privateNotes`), Windows DWM taskbar preview protection, customizable script shortcuts, local/cloud AI Q&A with knowledge-base retrieval (`QaPanel`), and local Whisper / Deepgram speech-to-text.

## Commands

Run all commands from `teleprompter/`:

- `npm run typecheck` — Type-check main/preload/shared and renderer (`tsc -p tsconfig.main.json --noEmit && tsc -p tsconfig.renderer.json --noEmit`).
- `npm run build` — Build renderer (`vite build`) and main/preload (`tsc -p tsconfig.main.json`) into `dist/`.
- `npm run dev` — Start Vite on port `5173`, build main, and launch Electron with `VITE_DEV_URL`.
- `npm start` — Build and launch Electron.
- `npm run selftest` — Build and run automated Electron self-test (`TELEPROMPTER_SELFTEST=1 electron .`).
- `npm run test:e2e` — Build and run Playwright Electron E2E suite (`playwright test`; runs sequentially with `workers: 1`).
- `npm run dist` — Run `node scripts/package.mjs` to build, copy `dwmHelper.exe` + `logo.png`, and output NSIS installer + x64 ZIP to `release/`.
- `npm run icon` — Regenerate `build/icon.ico`, `build/icon.png`, and `src/main/windows/logo.png` via `scripts/make-icon.mjs`.

## Structure

```text
teleprompter/
├── build/                 # dwmHelper.cs, dwmHelper.exe (ignored), icon.ico, icon.png
├── scripts/               # make-icon.mjs, package.mjs
├── src/
│   ├── main/              # Electron main process, IPC, stores, AI, STT, DWM helper, selftest
│   │   └── windows/       # Runtime dwmHelper.exe and logo.png (ignored/copied on dist)
│   ├── preload/           # contextBridge API (preload.ts)
│   ├── renderer/          # React 19 + Vite UI (App.tsx, QaPanel.tsx, CustomSelect.tsx, styles.css, icons.tsx)
│   └── shared/            # Pure TS types, slide parser, shortcut normalization (compiled by both tsconfigs)
├── tests/
│   ├── e2e/               # Playwright Electron specs (app-launch, audio-listen, edge-cases, models, providers, questions) + helpers.ts
│   └── fixtures/          # sample-speech.wav
├── playwright.config.ts   # Sequential Electron E2E config (timeout 30s, workers: 1)
├── tsconfig.main.json     # CommonJS build for src/main, src/preload, src/shared -> dist/
├── tsconfig.renderer.json # Bundler noEmit check for src/renderer, src/shared
└── vite.config.ts         # Renderer root src/renderer -> dist/renderer
```

## Important Files

| Path | Why |
| --- | --- |
| `src/main/main.ts` | App lifecycle, single-instance lock, overlay `BrowserWindow`, `registerIpc()`, global shortcuts, content protection |
| `src/main/settingsStore.ts` | Atomic JSON persistence (`userData/settings.json`) with numeric clamping and bounds validation |
| `src/main/aiSecretStore.ts` | AI provider config (`ai-config.json`) + `safeStorage`-encrypted API keys (`ai-secrets.json`) |
| `src/main/aiProvider.ts` | `AiProviderService`: Gemini, Groq, NVIDIA, and OpenAI-compatible custom endpoint model discovery & streaming |
| `src/main/qaKnowledge.ts` | `QaKnowledgeStore`: approved Q&A matching, glossary, slide/script excerpt retrieval, reference verification |
| `src/main/sttProvider.ts` | `TranscriptionProvider` interface and `DeepgramStreamingSession` (Node RFC 6455 WebSocket client) |
| `src/main/whisperStt.ts` | `WhisperSttService`: local Whisper CLI transcription, 16kHz mono WAV encoding, Deepgram key/config management |
| `src/main/windowsPreview.ts` | Spawns `dwmHelper.exe` to configure Windows DWM Peek exclusion and iconic thumbnail |
| `src/main/selftest.ts` | `runSelfTest()`: automated end-to-end self-test suite triggered by `TELEPROMPTER_SELFTEST=1` |
| `src/preload/preload.ts` | `contextBridge` exposing `window.teleprompter` (`TeleprompterApi`) |
| `src/shared/types.ts` | Shared `Settings`, `AiProviderId`, `SttConfig`, `QaKnowledgeBase`, `TeleprompterApi`, `DEFAULT_SCRIPT` |
| `src/shared/slides.ts` | Standalone slide heading parser (`parseSlides`) and scroll progress math (`computeSlideProgress`) |
| `src/shared/shortcuts.ts` | Default script shortcuts (`Enter`, `Ctrl+Up`, `Ctrl+Down`) and binding normalization/validation |
| `src/renderer/App.tsx` | Teleprompter UI, `requestAnimationFrame` scroller, slide scrubber, settings/shortcuts UI, `QaPanel` host |
| `src/renderer/QaPanel.tsx` | AI Q&A drawer, voice input capture/streaming, Prepare Q&A knowledge editor, provider/model settings |
| `src/renderer/CustomSelect.tsx` | In-window portal select menu (keeps dropdowns inside the content-protected `BrowserWindow`) |
| `scripts/package.mjs` | Windows packaging script invoking `vite`, `tsc`, and `electron-builder` via `process.execPath` |

## Conventions

- **TypeScript split**: No path aliases; use relative imports. `src/shared/` is compiled by both `tsconfig.main.json` (CommonJS) and `tsconfig.renderer.json` (ESNext/Bundler) — keep it free of Node-only or DOM-only imports.
- **Electron IPC & security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. All `ipcMain` handlers in `src/main/main.ts` must verify `trusted(e)` (`e.sender === overlay.webContents`). Preload exposes only `TeleprompterApi` (`src/renderer/global.d.ts`). Plaintext AI/Deepgram API keys must never be returned to the renderer or written unencrypted to disk.
- **Privacy & window lifecycle**: Overlay is created with `show: false`, applies `setContentProtection(s.privateNotes)` before `show()` on `ready-to-show`, and updates `privateNotes` solely through `privacy:set` (whitelisted out of `settings:update`). Use `CustomSelect` instead of native `<select>` so dropdowns stay inside the protected window.
- **Windows DWM helper**: `windowsPreview.ts` resolves `process.resourcesPath/windows` when packaged and `__dirname/windows` in dev. `scripts/package.mjs` copies `src/main/windows/{dwmHelper.exe,logo.png}` to `dist/main/windows/`.
- **UI & styling**: Plain CSS in `src/renderer/styles.css` and inline SVGs in `src/renderer/icons.tsx` (no Tailwind or icon packages).
- **Persistence**: `SettingsStore` debounces writes (250ms) and writes atomically via `.tmp` + rename; `App.tsx` debounces `updateSettings` (200ms) and merges pending patches.
- **No linter/unit-test runner**: No ESLint, Prettier, or Jest/Vitest is configured. Verify with `typecheck`, `selftest`, and `test:e2e`.

## Search and Verification

- **Graphify index**: `../graphify-out/graph.json` (from `teleprompter/`) or `graphify-out/graph.json` (from repo root), built from `teleprompter/src` (code-only AST; `styles.css`, `tests/`, `scripts/`, and `build/` are not in the graph).
  - Query: `graphify query "<question>" --graph ../graphify-out/graph.json` (also `graphify path "A" "B"`, `graphify explain "<symbol>"`, `graphify affected "<symbol>"`, `graphify god-nodes`; omit `--graph` when running from repo root).
  - Overview: read `graphify-out/GRAPH_REPORT.md` for community structure and architectural hubs.
  - Refresh after structural changes (from repo root): `graphify extract .\teleprompter\src --code-only --out . --force` (and `graphify cluster-only . --no-label --no-viz` to update `GRAPH_REPORT.md`). Do not add watchers or rebuild on every small edit.
- **Search order**:
  1. Use Graphify for cross-file structure, dependencies, call paths, and impact analysis (`affected`).
  2. Use LSP for known symbol definitions/references; use `Select-String` scoped to `src\` or `tests\` (`rg` is not on `PATH`) for literal text, CSS, test specs, and single-file lookups.
  3. If Graphify misses, is stale, or lacks coverage (e.g., `styles.css`, `tests/`), fall back to LSP or scoped `Select-String` immediately.
  4. Batch independent reads, read targeted line ranges, and verify graph findings in the actual source before editing.
- Exclude `node_modules/`, `dist/`, `release/`, `test-results/`, `playwright-report/`, `../graphify-out/`, `../extracted/`, `../resources/`, and binary assets (`*.exe`, `*.ico`, `*.png`, `*.wav`) from routine searches.
- Verify after edits: `npm run typecheck` after any TS change; run `npm run selftest` for main/IPC/packaging changes; run `npm run test:e2e` (or `npx playwright test tests/e2e/<spec>.spec.ts`) for UI, Q&A, or STT changes.
