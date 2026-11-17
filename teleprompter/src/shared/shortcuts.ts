import type { ScriptShortcuts } from './types';

export const DEFAULT_SCRIPT_SHORTCUTS: ScriptShortcuts = {
  toggleScroll: 'Enter',
  stepUp: 'Ctrl+Up',
  stepDown: 'Ctrl+Down'
};

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'] as const;

const ELECTRON_KEY_MAP: Record<string, string> = {
  Enter: 'Return',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
  PgUp: 'PageUp',
  PgDn: 'PageDown'
};

function normalizeModifier(part: string): (typeof MODIFIER_ORDER)[number] | null {
  const low = part.trim().toLowerCase();
  if (low === 'ctrl' || low === 'control' || low === 'commandorcontrol' || low === 'cmdorctrl') return 'Ctrl';
  if (low === 'alt' || low === 'option') return 'Alt';
  if (low === 'shift') return 'Shift';
  if (low === 'super' || low === 'meta' || low === 'cmd' || low === 'command' || low === 'win') return 'Super';
  return null;
}

function normalizeMainKey(part: string): string | null {
  const trimmed = part.trim();
  if (!trimmed) return null;
  const low = trimmed.toLowerCase();
  if (low === 'space' || low === 'spacebar' || trimmed === ' ') return null;
  if (low === 'esc' || low === 'escape') return null;
  if (low === 'return' || low === 'enter' || low === 'numpadenter') return 'Enter';
  if (low === 'arrowup' || low === 'up') return 'Up';
  if (low === 'arrowdown' || low === 'down') return 'Down';
  if (low === 'arrowleft' || low === 'left') return 'Left';
  if (low === 'arrowright' || low === 'right') return 'Right';
  if (low === 'pageup' || low === 'pgup') return 'PageUp';
  if (low === 'pagedown' || low === 'pgdn') return 'PageDown';
  if (low === 'home') return 'Home';
  if (low === 'end') return 'End';
  if (low === 'insert') return 'Insert';
  if (low === 'delete' || low === 'del') return 'Delete';
  if (low === 'backspace') return 'Backspace';
  if (low === 'tab') return 'Tab';
  if (/^f([1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[a-z0-9]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[,.;'[\]\\/`=-]$/.test(trimmed)) return trimmed;
  return null;
}

export function containsSpaceKey(raw: string): boolean {
  return raw
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .some((p) => p === 'space' || p === 'spacebar' || p === '');
}

export function normalizeDisplayBinding(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return null;

  const parts = trimmed.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const mods = new Set<(typeof MODIFIER_ORDER)[number]>();
  let mainKey: string | null = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const mod = normalizeModifier(part);
    if (mod && i < parts.length - 1) {
      mods.add(mod);
      continue;
    }
    if (i < parts.length - 1) return null;
    mainKey = normalizeMainKey(part);
  }

  if (!mainKey) return null;
  const orderedMods = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...orderedMods, mainKey].join('+');
}

export function toElectronAccelerator(displayBinding: string): string {
  const parts = displayBinding.split('+').map((p) => p.trim()).filter(Boolean);
  return parts
    .map((p) => {
      if (p === 'Ctrl') return 'Control';
      return ELECTRON_KEY_MAP[p] ?? p;
    })
    .join('+');
}

export function keyEventToDisplayBinding(e: {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): { binding?: string; error?: string; cancel?: boolean; ignore?: boolean } {
  if (e.key === 'Escape' || e.code === 'Escape') {
    return { cancel: true };
  }
  if (e.code === 'Space' || e.key === ' ') {
    return { error: 'Space cannot be used for script controls.' };
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    return { ignore: true };
  }

  let rawKey = e.key;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') rawKey = 'Enter';
  else if (e.code.startsWith('Key') && e.code.length === 4) rawKey = e.code.slice(3);
  else if (e.code.startsWith('Digit') && e.code.length === 6) rawKey = e.code.slice(5);

  const normalizedKey = normalizeMainKey(rawKey);
  if (!normalizedKey) {
    return { error: 'Unsupported key for shortcut.' };
  }

  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  return { binding: [...mods, normalizedKey].join('+') };
}
