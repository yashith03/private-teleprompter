export type ThemeMode = 'light' | 'dark';

export interface Settings {
  script: string;
  /** "Private notes": when true the overlay is excluded from supported screen capture. */
  privateNotes: boolean;
  /** Scroll speed in CSS pixels per second. */
  speed: number;
  fontSize: number;
  /** Window opacity 0.3 - 1. */
  opacity: number;
  theme: ThemeMode;
}

export type ShortcutAction = 'toggle-scroll' | 'step-up' | 'step-down';

export interface ShortcutBindingStatus {
  action: ShortcutAction;
  accelerator: 'Ctrl+Space' | 'Ctrl+Up' | 'Ctrl+Down';
  description: string;
  registered: boolean;
}

export interface TeleprompterApi {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Omit<Settings, 'privateNotes'>>): Promise<Settings>;
  setPrivateNotes(on: boolean): Promise<Settings>;
  minimize(): Promise<void>;
  reopenOverlay(): Promise<void>;
  resizeTo(width: number, height: number): void;
  getShortcuts(): Promise<ShortcutBindingStatus[]>;
  onShortcutAction(cb: (action: ShortcutAction) => void): () => void;
  onShortcutStatus(cb: (status: ShortcutBindingStatus[]) => void): () => void;
  quit(): void;
}

export const DEFAULT_SCRIPT =
  'Sample script\n\nPaste or type your script here. Press Edit to change this text, then Start to begin scrolling. ' +
  'Keep the window near your webcam so your eyes stay close to the lens.\n\n' +
  'Space starts and pauses scrolling.';
