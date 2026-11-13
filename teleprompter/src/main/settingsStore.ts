import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SCRIPT, type Settings } from '../shared/types';

export interface Bounds { x: number; y: number; width: number; height: number }
interface Persisted extends Settings { bounds?: Bounds }

const DEFAULTS: Persisted = {
  script: DEFAULT_SCRIPT,
  privateNotes: true,
  speed: 60,
  fontSize: 32,
  opacity: 0.92,
  theme: 'light'
};

const clamp = (n: unknown, min: number, max: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;

function sanitize(raw: Partial<Persisted>, base: Persisted): Persisted {
  const b = raw.bounds;
  const bounds =
    b && [b.x, b.y, b.width, b.height].every((v) => Number.isFinite(v)) && b.width >= 200 && b.height >= 120
      ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      : base.bounds;
  return {
    script: typeof raw.script === 'string' ? raw.script.slice(0, 500_000) : base.script,
    privateNotes: typeof raw.privateNotes === 'boolean' ? raw.privateNotes : base.privateNotes,
    speed: clamp(raw.speed, 10, 400, base.speed),
    fontSize: clamp(raw.fontSize, 14, 120, base.fontSize),
    opacity: clamp(raw.opacity, 0.3, 1, base.opacity),
    theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : base.theme,
    bounds
  };
}

/** Small JSON file store under userData. Fully local, no network. */
export class SettingsStore {
  private data: Persisted = { ...DEFAULTS };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    try {
      this.data = sanitize(JSON.parse(fs.readFileSync(file, 'utf-8')), DEFAULTS);
    } catch {
      /* first run or corrupt file: use defaults */
    }
  }

  get(): Settings {
    const { bounds: _b, ...s } = this.data;
    return { ...s };
  }

  getBounds(): Bounds | undefined { return this.data.bounds; }

  update(patch: Partial<Persisted>): Settings {
    this.data = sanitize({ ...this.data, ...patch }, this.data);
    this.scheduleSave();
    return this.get();
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[settings] save failed', e);
    }
  }
}
