# Private Teleprompter (MVP)

Offline Windows 11 teleprompter overlay built with Electron, React and TypeScript.
No cloud, login or voice-follow. Written from scratch using documented Electron APIs.

## Run & Package (PowerShell)

```powershell
cd d:\Downloads\NotchCopy\teleprompter
npm install
npm start          # build + launch
npm run dev        # Vite dev server + Electron
npm run selftest   # automated check of scroll, pause/resume, settings restore, min size, reopen
npm run typecheck
npm run dist       # generates icon, builds app, packages release\Private-Teleprompter-Setup-0.1.0.exe
```

If nested `npm` calls fail in your environment (when Node's directory is not on `PATH`), run directly with:

```powershell
node scripts/package.mjs
```

`scripts/package.mjs` prepends `path.dirname(process.execPath)` to child `PATH`s without modifying Windows system `PATH`.

## Installer Output

- `release\Private-Teleprompter-Setup-0.1.0.exe` (Windows x64 one-click per-user NSIS installer)
- Custom multi-size icon (`build/icon.ico`: 16, 24, 32, 48, 64, 128, 256 px) applied to the app executable, installer, uninstaller, Desktop shortcut, and Start Menu shortcut.

## Features

- Compact white reading card (`20px` rounded corners, subtle border/shadow, transparent outer window, navy script text, `#2563EB` accents)
- Draggable header bar, resizable edges + bottom-right corner grip, always-on-top overlay
- Script paste/edit (Edit / Done), Start/Pause (button or `Space`), Restart
- Settings popover (gear button) for scroll speed, font size, panel-only opacity, and Reopen overlay
- **Private notes ON/OFF** pill toggle in the header bar; script, settings and window bounds saved locally (`%APPDATA%\private-teleprompter\settings.json`)

## Architecture / security

- `src/main/main.ts` owns the `BrowserWindow` (with single-instance lock) and calls `win.setContentProtection(...)`.
  Windows are created with `show: false`; the saved Private-notes value is applied **before** `show()` on creation and reopen.
- `src/preload/preload.ts` exposes only: `getSettings`, `updateSettings`, `setPrivateNotes`, `reopenOverlay`, `resizeTo`, `quit`. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, navigation and `window.open` blocked, and IPC accepted only from the overlay.

## Validation status

| Check | Status |
|---|---|
| Scroll, pause/resume, settings restore, min-size layout, overlay reopen | Automated (`npm run selftest`), passing |
| Protection applied before first show on (re)creation | Automated, passing (`protect:true,show`) |
| NSIS packaging, silent install, Desktop & Start Menu shortcuts, packaged `.exe` self-test | Verified |
| Visual icon check in Windows Explorer & interactive Desktop double-click with PowerShell closed | **UNVERIFIED** — verify manually on Windows |
| **Capture exclusion in a real Entire-screen share, viewer side, Private notes Off and On** | **UNVERIFIED** — needs a manual Windows 11 call test |

Electron documents that on Windows `setContentProtection` uses display affinity (`WDA_EXCLUDEFROMCAPTURE` on supported builds). It only affects capture methods that honour it; some capture cards, drivers or older capture APIs may still show the window or a black box.

### Manual capture test

1. Close PowerShell and double-click the **Private Teleprompter** Desktop shortcut.
2. Start a private call, share **Entire screen**, with the overlay over visible content.
3. With **Private notes: OFF**, confirm the viewer sees the overlay.
4. Click the **Private notes** pill to switch to **ON**, and confirm the overlay disappears from the viewer's view while staying visible locally.
5. Close and reopen from the Desktop shortcut to verify script and settings restore.
