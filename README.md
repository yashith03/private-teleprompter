# 🎙️ Private Teleprompter (`Notch-Copy`) — v1.0.0

An offline-first **Windows 11 teleprompter overlay & AI Q&A assistant** built with Electron, React, TypeScript, and Vite. Designed for **live presentations, speeches, thesis defenses, and video calls**—staying invisible on your screen share while keeping your script, slide progress, practice timer, and live Q&A right at the top of your screen.

---

## 📦 Installation (Windows 11) & Microsoft Defender Instructions

Download from the `release/` folder or GitHub Releases:
- **Installer (Recommended)**: `Private-Teleprompter-Setup-1.0.0.exe` — One-click installer that automatically creates a **Desktop shortcut** and **Start Menu shortcut**.
- **Portable**: `Private Teleprompter-1.0.0-win-x64.zip` — Extract anywhere and run `Private Teleprompter.exe`.

### ⚠️ Microsoft Defender SmartScreen ("Windows protected your PC")
Because this app is not signed with a paid SSL/code-signing certificate, Windows Defender SmartScreen will show a warning the first time you run the installer or `.exe`:

1. Click **More info** on the blue *"Windows protected your PC"* popup.
2. Click **Run anyway** to launch the installer or app.
3. *(If your browser warns on download)* Click **Keep** / **Keep anyway**, or right-click the downloaded file → **Properties** → check **Unblock** → **Apply** → **OK**.

---

## 🛡️ Privacy & Screen-Share Hiding (Google Meet, Zoom, Teams, Discord)

- **🔒 Private notes (`ON` by default)**:
  - Uses Windows `SetWindowDisplayAffinity` (`WDA_EXCLUDEFROMCAPTURE`) via Electron's `setContentProtection(true)`.
  - When `ON`, your teleprompter overlay is **hidden from the other side** during Google Meet, Zoom, Microsoft Teams, Discord, and OBS screen shares—while remaining **completely visible to you**.
  - When `OFF`, the window appears normally in screen shares and screenshots (useful for recording demos).
- **👻 Taskbar & Windows Peek Hiding**:
  - While open, the app hides its taskbar icon (`setSkipTaskbar(true)`) and uses a Windows DWM helper (`dwmHelper.exe`) to block taskbar Peek and thumbnail previews from leaking your notes.
- **➖ Minimizing & Restoring**:
  - Clicking **Minimize (`–`)** temporarily shows the taskbar icon so you can restore the window, stops any active mic/system audio stream, and **releases `Ctrl + Space`** so other apps can use it.
  - Restoring the window hides the taskbar icon again and automatically re-registers `Ctrl + Space`.
- *Note: Screen-capture exclusion depends on Windows display affinity support—always do a quick test share in your call app before going live.*

---

## 📑 Slide Scrubber Bar & `Slide 1:` Rules

The horizontal **Slide Scrubber Bar** at the top of the Script reader automatically detects slides in your script and lets you track progress or jump directly to any slide:

### ✅ Formatting Rules
Write each slide heading on its **own standalone line** using `Slide <number>`:
- `Slide 1`
- `Slide 1: Introduction`
- `Slide 02 - Problem Statement`
- `## Slide 3: Methodology`
- `**Slide 4: Results & Demo**`

### ⚠️ Important Rules & Tips
- **Standalone lines only**: Inline mentions inside a paragraph (e.g., *"As we saw on Slide 2..."*) are ignored so they won't break your scrubber.
- **Line length**: Heading lines must be 100 characters or fewer.
- **Numbering warnings**: If you have duplicate slide numbers or skipped numbers, the editor displays a helpful warning in Edit mode.
- **Scrubbing**: Click any numbered pill or drag across the slide bar to jump straight to that section of your speech.

---

## ⌨️ Keyboard Shortcuts & Controls

| Shortcut | Scope | Action |
| :--- | :--- | :--- |
| **`Ctrl + Space`** | **Global** (while open & unminimized) | **Start / Pause** script auto-scroll (fixed) |
| **`Ctrl + Up`** | **Global** (when Script reader is active) | Step script **up** (`80px`, customizable) |
| **`Ctrl + Down`** | **Global** (when Script reader is active) | Step script **down** (`80px`, customizable) |
| **`Esc`** | In-app | Close Settings popover / cancel shortcut capture |

### Shortcut Rules
- **`Ctrl + Space` works everywhere while open**: It works even when **PowerPoint, Google Slides, or your browser** has focus, and even when you are on the **AI Q&A** tab (the hidden Script reader preserves its exact scroll position without jumping).
- **Released on Minimize & Quit**: Minimizing Notch-Copy unregisters `Ctrl + Space` so other apps can use it; restoring re-registers it automatically without needing to click the Script tab.
- **Plain `Space`, `Enter`, and `Alt`**: Plain `Space` never starts, pauses, or jumps the reader (while still working normally in text fields, on focused buttons, and in other apps). `Enter` and `Alt` do not control scrolling.
- **Conflict handling**: If another app (e.g., PowerToys Run or an input switcher) already owns `Ctrl + Space`, Settings displays an unavailable notice; the on-screen **Start / Pause** button and focused `Ctrl + Space` continue to work.

---

## ⏱️ Practice Stopwatch (`00:00:00`)

Located on the right side of the top bar (immediately left of Minimize and Close):
- **`[Start Timer]` `00:00:00` `[Reset]`**
- Cycles **`Start Timer`** → **`Pause Timer`** → **`Resume Timer`**, with **`Reset`** returning to `00:00:00`.
- Runs **completely independently** of script auto-scroll, `Ctrl + Space`, slide jumps, and `Script` / `AI Q&A` tab switching—ideal for timing presentation rehearsals.

---

## ⚙️ Settings & Appearance Options

Click the **Settings (sliders)** icon in the bottom-right toolbar to configure:
- **🎚️ Speed (`2–100`)**: Auto-scroll speed in pixels per second.
- **🔤 Font (`16–96`)**: Reader text size.
- **🪟 Background (`0.30–1.00`)**: Card background opacity (window text stays 100% opaque and legible).
- **🛡️ Private notes (`ON` / `OFF`)**: Toggle screen-capture exclusion.
- **🌗 Theme (`Light` / `Dark`)**: Switch between Light and Dark glass themes.
- **⌨️ Script Controls**: Toggle **Global shortcuts (`ON` / `OFF`)**, view `Ctrl + Space`, customize `Step up` / `Step down` (Space is disallowed), or **Reset** to defaults.
- **🔄 Reopen**: Recreates the protected overlay window if needed.

---

## 🤖 AI Q&A & Adding API Keys

Switch to the **`AI Q&A`** tab in the top bar to answer live audience questions using your presentation material.

### 🔑 Adding API Keys & Choosing a Provider
Open **Settings → AI Provider**:
1. Choose a **Provider**:
   - **Gemini** (`https://generativelanguage.googleapis.com/v1beta/openai`)
   - **Groq** (`https://api.groq.com/openai/v1`)
   - **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`)
   - **Custom (OpenAI-compatible)** — Enter any local or self-hosted base URL (e.g., Ollama, LM Studio, vLLM).
2. Paste your **API Key** and click **Save** (keys are encrypted locally using Windows OS `safeStorage` in `ai-secrets.json` and are never returned in plaintext).
3. Choose **Model Mode**:
   - **Auto**: Automatically discovers and picks the fastest eligible chat model.
   - **Manual**: Pick a discovered model or enter a model ID manually.
4. Click **Test Connection** to verify your key and endpoint.

### 📚 Prepare Q&A (Grounded Answers)
Inside **AI Q&A → Prepare Q&A**, you can add:
- **Slide Speech / Research Notes**: Only relevant retrieved excerpts are sent to the AI—keeping answers fast and grounded.
- **Approved Q&A Pairs**: Pre-written question + answer pairs that match **locally with 0 API calls** for instant, exact responses.
- **Glossary**: Define project-specific terms and acronyms for better matching.
- **Answer Instructions**: Customize tone, length, and formatting rules.
- Every answer displays its **source mode** (`Approved Q&A`, `Retrieved`, or `No matching evidence`) and separates **verified** vs. **unverified** references.

---

## 🎙️ Voice Input (Microphone & System Audio)

Open **Settings → Speech-to-Text (STT)** to ask or capture live audience questions by voice:

- **🏠 Local Whisper (Offline, Default)**:
  - Runs 100% offline with zero cloud audio uploads.
  - Set your **Whisper executable (`.exe`) path** and **Whisper model (`.bin`) path**, plus language (default `en`).
- **☁️ Deepgram Streaming (Cloud)**:
  - Low-latency real-time WebSocket transcription supporting `flux-general-en` and `nova-3`.
  - Save your **Deepgram API Key** (encrypted via Windows `safeStorage`).
- **🎧 Audio Source & Device Options**:
  - **Microphone (`mic`)**: Capture questions from your mic (with selectable input device).
  - **System Audio (`system`)**: Capture audio playing from Google Meet / Zoom / Teams via Windows loopback audio so you can transcribe audience questions directly.
  - **Auto-listen**: Optionally start/stop listening automatically with Q&A mode.

---

## 🛠️ Build & Package from Source

Run all commands inside `teleprompter/`:

```powershell
cd teleprompter
npm install
npm run typecheck   # Type-check main, preload, shared, and renderer
npm run build       # Build renderer (Vite) + main/preload (tsc)
npm run selftest    # Run automated Electron self-test suite
npm run test:e2e    # Run Playwright Electron E2E suite
npm run dist        # Build NSIS installer + portable x64 ZIP into release/
```

---

## 📄 License / Privacy Note

All script text, settings, Q&A knowledge bases, and encrypted API keys stay **locally on your machine** under your Windows `userData` folder. Network requests are only made to the AI or Deepgram endpoints you explicitly configure.
