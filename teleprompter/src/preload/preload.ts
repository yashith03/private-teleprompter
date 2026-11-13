import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ShortcutAction, ShortcutBindingStatus, TeleprompterApi } from '../shared/types';

const VALID_ACTIONS = new Set<ShortcutAction>(['toggle-scroll', 'step-up', 'step-down']);

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
  quit: () => ipcRenderer.send('app:quit')
};

contextBridge.exposeInMainWorld('teleprompter', api);
