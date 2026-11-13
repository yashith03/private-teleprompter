import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AiChatStreamEvent,
  AiConfigPatch,
  AiProviderId,
  AiSendMessageInput,
  QaKnowledgePatch,
  ShortcutAction,
  ShortcutBindingStatus,
  SttConfig,
  SttStreamEvent,
  TeleprompterApi
} from '../shared/types';

const VALID_ACTIONS = new Set<ShortcutAction>(['toggle-scroll', 'step-up', 'step-down']);
const VALID_PROVIDERS = new Set<AiProviderId>(['gemini', 'groq', 'nvidia', 'custom']);

// Only the operations the renderer needs are exposed.
const api: TeleprompterApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setPrivateNotes: (on) => ipcRenderer.invoke('privacy:set', on === true),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  reopenOverlay: () => ipcRenderer.invoke('window:reopen'),
  resizeTo: (width, height) => ipcRenderer.send('window:resize', width, height),
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  onShortcutAction: (cb) => {
    ipcRenderer.removeAllListeners('shortcut:action');
    const handler = (_e: IpcRendererEvent, action: unknown) => {
      if (typeof action === 'string' && VALID_ACTIONS.has(action as ShortcutAction)) {
        cb(action as ShortcutAction);
      }
    };
    ipcRenderer.on('shortcut:action', handler);
    return () => ipcRenderer.removeListener('shortcut:action', handler);
  },
  onShortcutStatus: (cb) => {
    ipcRenderer.removeAllListeners('shortcut:status');
    const handler = (_e: IpcRendererEvent, status: unknown) => {
      if (Array.isArray(status)) {
        cb(status as ShortcutBindingStatus[]);
      }
    };
    ipcRenderer.on('shortcut:status', handler);
    return () => ipcRenderer.removeListener('shortcut:status', handler);
  },
  getAiConfig: () => ipcRenderer.invoke('ai:get-config'),
  updateAiConfig: (patch: AiConfigPatch) => ipcRenderer.invoke('ai:update-config', patch),
  setAiApiKey: (provider: AiProviderId, apiKey: string) => {
    if (!VALID_PROVIDERS.has(provider)) return Promise.reject(new Error('Invalid provider'));
    return ipcRenderer.invoke('ai:set-api-key', provider, typeof apiKey === 'string' ? apiKey : '');
  },
  clearAiApiKey: (provider: AiProviderId) => {
    if (!VALID_PROVIDERS.has(provider)) return Promise.reject(new Error('Invalid provider'));
    return ipcRenderer.invoke('ai:clear-api-key', provider);
  },
  listAiModels: () => ipcRenderer.invoke('ai:list-models'),
  testAiConnection: () => ipcRenderer.invoke('ai:test-connection'),
  sendAiMessage: (input: AiSendMessageInput) => ipcRenderer.invoke('ai:send-message', input),
  stopAiStream: (requestId?: string) => ipcRenderer.invoke('ai:stop', requestId),
  onAiStreamEvent: (cb) => {
    const handler = (_e: IpcRendererEvent, ev: unknown) => {
      if (ev && typeof ev === 'object' && 'requestId' in ev && 'type' in ev) {
        cb(ev as AiChatStreamEvent);
      }
    };
    ipcRenderer.on('ai:stream-event', handler);
    return () => ipcRenderer.removeListener('ai:stream-event', handler);
  },
  getQaKnowledge: () => ipcRenderer.invoke('qa:get-knowledge'),
  updateQaKnowledge: (patch: QaKnowledgePatch) => ipcRenderer.invoke('qa:update-knowledge', patch),
  getSttConfig: () => ipcRenderer.invoke('stt:get-config'),
  updateSttConfig: (patch: Partial<SttConfig>) => ipcRenderer.invoke('stt:update-config', patch),
  setDeepgramApiKey: (apiKey: string) =>
    ipcRenderer.invoke('stt:set-deepgram-key', typeof apiKey === 'string' ? apiKey : ''),
  clearDeepgramApiKey: () => ipcRenderer.invoke('stt:clear-deepgram-key'),
  getSttStatus: () => ipcRenderer.invoke('stt:get-status'),
  transcribeAudio: (pcm16kBase64: string, isFinal: boolean) =>
    ipcRenderer.invoke('stt:transcribe', typeof pcm16kBase64 === 'string' ? pcm16kBase64 : '', isFinal === true),
  startSttStream: () => ipcRenderer.invoke('stt:stream-start'),
  sendSttAudio: (sessionId: string, pcm16kBase64: string) => {
    if (typeof sessionId === 'string' && typeof pcm16kBase64 === 'string') {
      ipcRenderer.send('stt:stream-audio', sessionId, pcm16kBase64);
    }
  },
  stopSttStream: (sessionId?: string) => ipcRenderer.invoke('stt:stream-stop', sessionId),
  onSttEvent: (cb) => {
    const handler = (_e: IpcRendererEvent, ev: unknown) => {
      if (ev && typeof ev === 'object' && 'sessionId' in ev && 'type' in ev) {
        cb(ev as SttStreamEvent);
      }
    };
    ipcRenderer.on('stt:stream-event', handler);
    return () => ipcRenderer.removeListener('stt:stream-event', handler);
  },
  onWindowMinimized: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('window:minimized', handler);
    return () => ipcRenderer.removeListener('window:minimized', handler);
  },
  quit: () => ipcRenderer.send('app:quit')
};

contextBridge.exposeInMainWorld('teleprompter', api);
