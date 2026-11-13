import { app, BrowserWindow, globalShortcut, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { SettingsStore } from './settingsStore';
import type {
  AiChatStreamEvent,
  AiConfigPatch,
  AiProviderId,
  AiSendMessageInput,
  QaKnowledgePatch,
  Settings,
  ShortcutAction,
  ShortcutBindingStatus,
  SttConfig
} from '../shared/types';
import { runSelfTest } from './selftest';
import { applyWindowsTaskbarPreviewProtection } from './windowsPreview';
import { AiSecretStore } from './aiSecretStore';
import { AiProviderService } from './aiProvider';
import { QaKnowledgeStore } from './qaKnowledge';
import { WhisperSttService } from './whisperStt';

const SELFTEST = process.env.TELEPROMPTER_SELFTEST === '1';
const E2E_USER_DATA = process.env.TELEPROMPTER_E2E_USER_DATA;
if (SELFTEST) {
  app.setPath('userData', path.join(app.getPath('temp'), `teleprompter-selftest-${Date.now()}`));
} else if (E2E_USER_DATA) {
  app.setPath('userData', E2E_USER_DATA);
}

// Single instance: a second double-click focuses the running overlay instead of opening another.
const gotLock = SELFTEST || Boolean(E2E_USER_DATA) || app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let store: SettingsStore;
let aiStore: AiSecretStore;
let qaStore: QaKnowledgeStore;
let sttService: WhisperSttService;
const aiProvider = new AiProviderService();
let overlay: BrowserWindow | null = null;
/** Ordered log of main-process window events, used by the self-test. */
export const eventLog: string[] = [];

const SHORTCUT_SPECS: ReadonlyArray<{
  electronAccelerator: string;
  displayAccelerator: ShortcutBindingStatus['accelerator'];
  action: ShortcutAction;
  description: string;
}> = [
  { electronAccelerator: 'Control+Space', displayAccelerator: 'Ctrl+Space', action: 'toggle-scroll', description: 'Start / Pause' },
  { electronAccelerator: 'Control+Up', displayAccelerator: 'Ctrl+Up', action: 'step-up', description: 'Step up' },
  { electronAccelerator: 'Control+Down', displayAccelerator: 'Ctrl+Down', action: 'step-down', description: 'Step down' }
];

const VALID_SHORTCUT_ACTIONS = new Set<ShortcutAction>(SHORTCUT_SPECS.map((s) => s.action));
let shortcutStatus: ShortcutBindingStatus[] = SHORTCUT_SPECS.map((s) => ({
  action: s.action,
  accelerator: s.displayAccelerator,
  description: s.description,
  registered: false
}));

/** Sends only supported shortcut actions to a visible overlay without focusing or reopening it. */
export function dispatchShortcutAction(action: ShortcutAction): void {
  if (!VALID_SHORTCUT_ACTIONS.has(action)) return;
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  eventLog.push(`shortcut-fire:${action}`);
  overlay.webContents.send('shortcut:action', action);
}

/** Registers global shortcuts in main and records whether each binding succeeded without falling back. */
export function registerGlobalShortcuts(
  registerFn: (accelerator: string, callback: () => void) => boolean = (acc, cb) => globalShortcut.register(acc, cb)
): ShortcutBindingStatus[] {
  globalShortcut.unregisterAll();
  shortcutStatus = SHORTCUT_SPECS.map((spec) => {
    const ok = Boolean(registerFn(spec.electronAccelerator, () => dispatchShortcutAction(spec.action)));
    eventLog.push(`shortcut:${spec.displayAccelerator}:${ok ? 'registered' : 'unavailable'}`);
    return {
      action: spec.action,
      accelerator: spec.displayAccelerator,
      description: spec.description,
      registered: ok
    };
  });
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('shortcut:status', shortcutStatus);
  }
  return shortcutStatus;
}

/**
 * Content protection is applied in the main process. On Windows Electron maps this to
 * SetWindowDisplayAffinity (WDA_EXCLUDEFROMCAPTURE on supported builds). It only affects
 * capture methods that honour display affinity - verify on your own call setup.
 */
function applyPrivateNotes(win: BrowserWindow, on: boolean): void {
  win.setContentProtection(on);
  eventLog.push(`protect:${on}`);
}

function visibleBounds() {
  const b = store.getBounds();
  if (!b) return undefined;
  const ok = screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y;
  });
  return ok ? b : undefined;
}

export function createOverlay(): BrowserWindow {
  const s = store.get();
  const saved = visibleBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const width = saved?.width ?? 680;
  const height = saved?.height ?? 340;

  const win = new BrowserWindow({
    title: 'Notch-Copy',
    width,
    height,
    x: saved?.x ?? Math.round(workArea.x + (workArea.width - width) / 2),
    y: saved?.y ?? workArea.y + 8,
    minWidth: 420,
    minHeight: 260,
    show: false, // never show before protection is applied
    frame: false,
    transparent: true, // rounded card corners; the card paints its own surface and shadow
    hasShadow: false,
    alwaysOnTop: true,
    minimizable: true,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Hide the taskbar entry on launch before the overlay first appears.
  win.setSkipTaskbar(true);
  applyPrivateNotes(win, s.privateNotes);
  win.setAlwaysOnTop(true, 'screen-saver');

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => {
    eventLog.push('show');
    win.show();
    win.setContentProtection(store.get().privateNotes);
    // Apply DWM preview protection (disallow Peek, exclude from Peek, iconic thumbnail/preview)
    applyWindowsTaskbarPreviewProtection(win);
  });
  win.on('minimize', () => {
    if (win.isDestroyed()) return;
    // Show taskbar entry when minimized so user can restore it
    win.setSkipTaskbar(false);
    applyWindowsTaskbarPreviewProtection(win);
    sttService.stopStream();
    win.webContents.send('window:minimized');
    eventLog.push('minimize-event');
  });
  win.on('restore', () => {
    if (win.isDestroyed()) return;
    // Hide taskbar entry on restore; restore same window and preserve settings
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    applyPrivateNotes(win, store.get().privateNotes);
    eventLog.push('restore');
  });

  let boundsTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) store.update({ bounds: win.getBounds() });
    }, 300);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.on('closed', () => {
    sttService.stopStream();
    if (overlay === win) overlay = null;
  });

  const devUrl = process.env.VITE_DEV_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  overlay = win;
  return win;
}

/** Only accept IPC from the overlay's own web contents. */
function trusted(e: IpcMainInvokeEvent): boolean {
  return !!overlay && !overlay.isDestroyed() && e.sender === overlay.webContents;
}

function registerIpc(): void {
  ipcMain.handle('settings:get', (e): Settings => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return store.get();
  });

  ipcMain.handle('settings:update', (e, patch: Partial<Settings>): Settings => {
    if (!trusted(e)) throw new Error('untrusted sender');
    // Whitelist keys; privateNotes goes through its own channel.
    const safe: Partial<Settings> = {};
    if (patch && typeof patch === 'object') {
      if ('script' in patch) safe.script = patch.script;
      if ('speed' in patch) safe.speed = patch.speed;
      if ('fontSize' in patch) safe.fontSize = patch.fontSize;
      if ('opacity' in patch) safe.opacity = patch.opacity;
      if ('theme' in patch) safe.theme = patch.theme;
    }
    const next = store.update(safe);
    return next;
  });

  ipcMain.handle('privacy:set', (e, on: boolean): Settings => {
    if (!trusted(e)) throw new Error('untrusted sender');
    const next = store.update({ privateNotes: on === true });
    if (overlay) applyPrivateNotes(overlay, next.privateNotes);
    return next;
  });

  ipcMain.handle('window:minimize', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    if (overlay && !overlay.isDestroyed()) {
      overlay.setSkipTaskbar(false);
      applyWindowsTaskbarPreviewProtection(overlay);
      overlay.minimize();
      eventLog.push('minimize');
    }
  });

  ipcMain.handle('window:reopen', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    reopenOverlay();
  });

  ipcMain.handle('shortcuts:get', (e): ShortcutBindingStatus[] => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return shortcutStatus;
  });

  ipcMain.handle('ai:get-config', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return aiStore.getPublicConfig();
  });

  ipcMain.handle('ai:update-config', (e, patch: AiConfigPatch) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    const safe: AiConfigPatch = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.provider === 'string') safe.provider = patch.provider;
      if (patch.modelMode === 'auto' || patch.modelMode === 'manual') safe.modelMode = patch.modelMode;
      if (typeof patch.model === 'string') safe.model = patch.model;
      if (typeof patch.customBaseUrl === 'string') safe.customBaseUrl = patch.customBaseUrl;
    }
    return aiStore.updateConfig(safe);
  });

  ipcMain.handle('ai:set-api-key', (e, provider: AiProviderId, apiKey: string) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    if (typeof provider !== 'string' || typeof apiKey !== 'string') {
      throw new Error('Invalid AI key payload');
    }
    return aiStore.setApiKey(provider, apiKey);
  });

  ipcMain.handle('ai:clear-api-key', (e, provider: AiProviderId) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    if (typeof provider !== 'string') throw new Error('Invalid provider');
    return aiStore.clearApiKey(provider);
  });

  ipcMain.handle('ai:list-models', async (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return aiProvider.listModels(aiStore);
  });

  ipcMain.handle('ai:test-connection', async (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return aiProvider.testConnection(aiStore);
  });

  ipcMain.handle('ai:send-message', (e, input: AiSendMessageInput) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    if (!input || typeof input.question !== 'string' || !input.question.trim()) {
      throw new Error('Question is required');
    }
    const emit = (ev: AiChatStreamEvent) => {
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send('ai:stream-event', ev);
      }
    };
    const requestId = aiProvider.startStream(aiStore, qaStore, input, {
      onSources: (meta) => emit({ requestId, type: 'sources', ...meta }),
      onDelta: (text) => emit({ requestId, type: 'delta', text }),
      onDone: (refs) => emit({ requestId, type: 'done', ...(refs ?? {}) }),
      onError: (errorKind, error) => emit({ requestId, type: 'error', errorKind, error }),
      onCancelled: () => emit({ requestId, type: 'cancelled' })
    });
    return { requestId };
  });

  ipcMain.handle('qa:get-knowledge', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return qaStore.get();
  });

  ipcMain.handle('qa:update-knowledge', (e, patch: QaKnowledgePatch) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    const safe: QaKnowledgePatch = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.slideSpeech === 'string') safe.slideSpeech = patch.slideSpeech;
      if (typeof patch.researchNotes === 'string') safe.researchNotes = patch.researchNotes;
      if (Array.isArray(patch.approvedPairs)) safe.approvedPairs = patch.approvedPairs;
      if (typeof patch.answerInstructions === 'string') safe.answerInstructions = patch.answerInstructions;
    }
    return qaStore.update(safe);
  });

  ipcMain.handle('stt:get-config', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return sttService.getConfig();
  });

  ipcMain.handle('stt:update-config', (e, patch: Partial<SttConfig>) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    const safe: Partial<SttConfig> = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.provider === 'string') safe.provider = patch.provider;
      if (typeof patch.deepgramModel === 'string') safe.deepgramModel = patch.deepgramModel;
      if (typeof patch.language === 'string') safe.language = patch.language;
      if (typeof patch.modelPath === 'string') safe.modelPath = patch.modelPath;
      if (typeof patch.binaryPath === 'string') safe.binaryPath = patch.binaryPath;
      if (typeof patch.deviceId === 'string') safe.deviceId = patch.deviceId;
      if (typeof patch.autoListen === 'boolean') safe.autoListen = patch.autoListen;
      if (typeof patch.permissionGranted === 'boolean') safe.permissionGranted = patch.permissionGranted;
      if (typeof patch.saveRawAudio === 'boolean') safe.saveRawAudio = patch.saveRawAudio;
    }
    return sttService.updateConfig(safe);
  });

  ipcMain.handle('stt:set-deepgram-key', (e, apiKey: string) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    if (typeof apiKey !== 'string') throw new Error('Invalid Deepgram API key');
    return sttService.setDeepgramApiKey(apiKey);
  });

  ipcMain.handle('stt:clear-deepgram-key', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return sttService.clearDeepgramApiKey();
  });

  ipcMain.handle('stt:get-status', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return sttService.getStatus();
  });

  ipcMain.handle('stt:transcribe', async (e, pcm16kBase64: string, isFinal: boolean) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    if (typeof pcm16kBase64 !== 'string') throw new Error('Invalid audio payload');
    return sttService.transcribePcm16k(pcm16kBase64, isFinal === true);
  });

  ipcMain.handle('stt:stream-start', (e) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return sttService.startStream((ev) => {
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send('stt:stream-event', ev);
      }
    });
  });

  ipcMain.on('stt:stream-audio', (e, sessionId: string, pcm16kBase64: string) => {
    if (!overlay || overlay.isDestroyed() || e.sender !== overlay.webContents) return;
    if (typeof sessionId !== 'string' || typeof pcm16kBase64 !== 'string') return;
    sttService.sendStreamAudio(sessionId, pcm16kBase64);
  });

  ipcMain.handle('stt:stream-stop', (e, sessionId?: string) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    sttService.stopStream(typeof sessionId === 'string' ? sessionId : undefined);
  });

  ipcMain.handle('ai:stop', (e, requestId?: string) => {
    if (!trusted(e)) throw new Error('untrusted sender');
    aiProvider.stop(typeof requestId === 'string' ? requestId : undefined);
  });

  // Fallback resize grip: native edge resizing of transparent frameless windows can be
  // unreliable on Windows, so the renderer's corner grip drives the size from here.
  ipcMain.on('window:resize', (e, width: number, height: number) => {
    if (!overlay || overlay.isDestroyed() || e.sender !== overlay.webContents) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const [minW, minH] = overlay.getMinimumSize();
    overlay.setSize(Math.min(2400, Math.max(minW, Math.round(width))), Math.min(1600, Math.max(minH, Math.round(height))));
  });

  ipcMain.on('app:quit', (e) => {
    if (overlay && e.sender === overlay.webContents) app.quit();
  });
}

export function reopenOverlay(): BrowserWindow {
  const old = overlay;
  if (old && !old.isDestroyed()) store.update({ bounds: old.getBounds() });
  store.flush();
  const fresh = createOverlay(); // new window reads saved settings, protects, then shows
  old?.destroy();
  return fresh;
}

app.whenReady().then(() => {
  if (!gotLock) return;
  const userDataDir = app.getPath('userData');
  store = new SettingsStore(path.join(userDataDir, 'settings.json'));
  aiStore = new AiSecretStore(userDataDir);
  qaStore = new QaKnowledgeStore(userDataDir);
  sttService = new WhisperSttService(userDataDir);
  registerIpc();
  const win = createOverlay();
  registerGlobalShortcuts();
  if (SELFTEST) {
    void runSelfTest({
      store,
      sttService,
      getWindow: () => overlay ?? win,
      reopen: reopenOverlay,
      registerGlobalShortcuts,
      dispatchShortcutAction,
      eventLog
    });
  }
});

app.on('second-instance', () => {
  if (!overlay || overlay.isDestroyed()) return;
  if (overlay.isMinimized()) overlay.restore();
  overlay.focus();
});

app.on('before-quit', () => {
  aiProvider.stop();
  sttService?.stopStream();
  store?.flush();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());


