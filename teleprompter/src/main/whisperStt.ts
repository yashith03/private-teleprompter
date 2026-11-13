import { app, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  DeepgramModelId,
  SttConfig,
  SttProviderId,
  SttStatus,
  SttStreamEvent,
  SttTranscribeResult
} from '../shared/types';
import { DeepgramStreamingSession } from './sttProvider';

const execFileAsync = promisify(execFile);

const VALID_STT_PROVIDERS = new Set<SttProviderId>(['whisper', 'deepgram']);
const VALID_DEEPGRAM_MODELS = new Set<DeepgramModelId>(['flux-general-en', 'nova-3']);

const DEFAULT_STT_CONFIG: SttConfig = {
  provider: 'whisper',
  deepgramModel: 'flux-general-en',
  language: 'en',
  modelPath: '',
  binaryPath: '',
  deviceId: '',
  autoListen: false,
  permissionGranted: false,
  saveRawAudio: false
};

export function encodeWav16kMono(pcm16Data: Buffer): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm16Data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm16Data.length, 40);

  return Buffer.concat([header, pcm16Data]);
}

function findExistingFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export class WhisperSttService {
  private readonly configPath: string;
  private readonly secretsPath: string;
  private readonly userDataDir: string;
  private config: SttConfig;
  private memoryDeepgramKey = '';
  private encryptedDeepgramKey = '';
  private mockTranscriber: ((pcm16: Buffer, isFinal: boolean) => Promise<SttTranscribeResult>) | null = null;
  private deepgramTestBaseUrl: string | null = null;
  private activeCloudSession: DeepgramStreamingSession | null = null;
  private sessionSeq = 0;

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
    this.configPath = path.join(userDataDir, 'stt-config.json');
    this.secretsPath = path.join(userDataDir, 'stt-secrets.json');
    this.config = this.loadConfig();
    this.encryptedDeepgramKey = this.loadEncryptedDeepgramKey();
    if (process.env.TELEPROMPTER_E2E_DEEPGRAM_URL) {
      this.deepgramTestBaseUrl = process.env.TELEPROMPTER_E2E_DEEPGRAM_URL;
    }
  }

  setMockTranscriber(fn: ((pcm16: Buffer, isFinal: boolean) => Promise<SttTranscribeResult>) | null): void {
    this.mockTranscriber = fn;
  }

  setDeepgramTestBaseUrl(url: string | null): void {
    this.deepgramTestBaseUrl = url;
  }

  private loadEncryptedDeepgramKey(): string {
    if (!safeStorage.isEncryptionAvailable()) return '';
    try {
      const raw = JSON.parse(fs.readFileSync(this.secretsPath, 'utf8')) as { deepgram?: unknown };
      return typeof raw.deepgram === 'string' ? raw.deepgram : '';
    } catch {
      return '';
    }
  }

  private saveEncryptedDeepgramKey(): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(path.dirname(this.secretsPath), { recursive: true });
    const payload = this.encryptedDeepgramKey ? { deepgram: this.encryptedDeepgramKey } : {};
    fs.writeFileSync(this.secretsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  hasDeepgramKey(): boolean {
    if (this.memoryDeepgramKey.length > 0) return true;
    return this.encryptedDeepgramKey.length > 0 && safeStorage.isEncryptionAvailable();
  }

  getDeepgramApiKey(): string {
    if (this.memoryDeepgramKey.length > 0) return this.memoryDeepgramKey;
    if (!this.encryptedDeepgramKey || !safeStorage.isEncryptionAvailable()) return '';
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(this.encryptedDeepgramKey, 'base64')).trim();
      if (decrypted) this.memoryDeepgramKey = decrypted;
      return decrypted;
    } catch {
      return '';
    }
  }

  setDeepgramApiKey(apiKey: string): SttConfig {
    const trimmed = apiKey.trim();
    if (!trimmed) return this.clearDeepgramApiKey();
    this.memoryDeepgramKey = trimmed;
    if (safeStorage.isEncryptionAvailable()) {
      this.encryptedDeepgramKey = safeStorage.encryptString(trimmed).toString('base64');
      this.saveEncryptedDeepgramKey();
    }
    return this.getConfig();
  }

  clearDeepgramApiKey(): SttConfig {
    this.memoryDeepgramKey = '';
    this.encryptedDeepgramKey = '';
    this.saveEncryptedDeepgramKey();
    if (this.config.provider === 'deepgram') {
      this.stopStream();
    }
    return this.getConfig();
  }

  private loadConfig(): SttConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<SttConfig>;
      const provider: SttProviderId =
        typeof raw.provider === 'string' && VALID_STT_PROVIDERS.has(raw.provider as SttProviderId)
          ? (raw.provider as SttProviderId)
          : 'whisper';
      const deepgramModel: DeepgramModelId =
        typeof raw.deepgramModel === 'string' && VALID_DEEPGRAM_MODELS.has(raw.deepgramModel as DeepgramModelId)
          ? (raw.deepgramModel as DeepgramModelId)
          : 'flux-general-en';
      return {
        provider,
        deepgramModel,
        language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim().slice(0, 16) : 'en',
        modelPath: typeof raw.modelPath === 'string' ? raw.modelPath.trim().slice(0, 500) : '',
        binaryPath: typeof raw.binaryPath === 'string' ? raw.binaryPath.trim().slice(0, 500) : '',
        deviceId: typeof raw.deviceId === 'string' ? raw.deviceId.trim().slice(0, 200) : '',
        autoListen: raw.autoListen === true,
        permissionGranted: raw.permissionGranted === true,
        saveRawAudio: raw.saveRawAudio === true
      };
    } catch {
      return { ...DEFAULT_STT_CONFIG };
    }
  }

  private saveConfig(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const { hasDeepgramKey: _h, encryptionAvailable: _e, ...persisted } = this.config;
    fs.writeFileSync(this.configPath, JSON.stringify(persisted, null, 2), 'utf8');
  }

  getConfig(): SttConfig {
    return {
      ...this.config,
      hasDeepgramKey: this.hasDeepgramKey(),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

  updateConfig(patch: Partial<SttConfig>): SttConfig {
    let stopCloud = false;
    if (typeof patch.provider === 'string' && VALID_STT_PROVIDERS.has(patch.provider as SttProviderId)) {
      if (patch.provider !== this.config.provider) stopCloud = true;
      this.config.provider = patch.provider as SttProviderId;
    }
    if (
      typeof patch.deepgramModel === 'string' &&
      VALID_DEEPGRAM_MODELS.has(patch.deepgramModel as DeepgramModelId)
    ) {
      if (patch.deepgramModel !== this.config.deepgramModel) stopCloud = true;
      this.config.deepgramModel = patch.deepgramModel as DeepgramModelId;
    }
    if (typeof patch.language === 'string' && patch.language.trim()) {
      this.config.language = patch.language.trim().slice(0, 16);
    }
    if (typeof patch.modelPath === 'string') {
      this.config.modelPath = patch.modelPath.trim().slice(0, 500);
    }
    if (typeof patch.binaryPath === 'string') {
      this.config.binaryPath = patch.binaryPath.trim().slice(0, 500);
    }
    if (typeof patch.deviceId === 'string') {
      this.config.deviceId = patch.deviceId.trim().slice(0, 200);
    }
    if (typeof patch.autoListen === 'boolean') {
      this.config.autoListen = patch.autoListen;
    }
    if (typeof patch.permissionGranted === 'boolean') {
      this.config.permissionGranted = patch.permissionGranted;
    }
    if (typeof patch.saveRawAudio === 'boolean') {
      this.config.saveRawAudio = patch.saveRawAudio;
    }
    if (stopCloud) {
      this.stopStream();
    }
    this.saveConfig();
    return this.getConfig();
  }

  getStatus(): SttStatus {
    if (this.config.provider === 'deepgram') {
      if (!this.hasDeepgramKey()) {
        return {
          available: false,
          binaryPath: null,
          modelPath: null,
          reason: 'Missing Deepgram API key. Typed Q&A still works or switch to Local Whisper.'
        };
      }
      return { available: true, binaryPath: null, modelPath: null };
    }

    if (this.mockTranscriber) {
      return { available: true, binaryPath: 'mock-whisper', modelPath: this.config.modelPath || 'ggml-base.en.bin' };
    }

    const resBase = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
    const binaryCandidates = [
      this.config.binaryPath,
      path.join(this.userDataDir, 'whisper', 'whisper-cli.exe'),
      path.join(this.userDataDir, 'whisper', 'main.exe'),
      path.join(resBase, 'whisper', 'whisper-cli.exe')
    ];
    const modelCandidates = [
      this.config.modelPath,
      path.join(this.userDataDir, 'models', 'ggml-base.en.bin'),
      path.join(this.userDataDir, 'models', 'ggml-tiny.en.bin'),
      path.join(resBase, 'models', 'ggml-base.en.bin')
    ];

    const binaryPath = findExistingFile(binaryCandidates);
    const modelPath = findExistingFile(modelCandidates);

    if (!binaryPath || !modelPath) {
      const missing: string[] = [];
      if (!binaryPath) missing.push('Whisper executable (.exe)');
      if (!modelPath) missing.push('Whisper model (.bin)');
      return {
        available: false,
        binaryPath,
        modelPath,
        reason: `Missing ${missing.join(' and ')}. Typed Q&A still works.`
      };
    }

    return { available: true, binaryPath, modelPath };
  }

  async transcribePcm16k(pcm16kBase64: string, isFinal: boolean): Promise<SttTranscribeResult> {
    let pcmBuf: Buffer;
    try {
      pcmBuf = Buffer.from(pcm16kBase64, 'base64');
    } catch {
      return { ok: false, text: '', error: 'Invalid audio buffer.' };
    }

    if (pcmBuf.length < 640) {
      return { ok: true, text: '' };
    }

    if (this.mockTranscriber) {
      return this.mockTranscriber(pcmBuf, isFinal);
    }

    const status = this.getStatus();
    if (!status.available || !status.binaryPath || !status.modelPath) {
      return { ok: false, text: '', error: status.reason || 'Whisper transcription model unavailable.' };
    }

    const wavBuf = encodeWav16kMono(pcmBuf);
    const tmpWav = path.join(os.tmpdir(), `notch-stt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);

    try {
      fs.writeFileSync(tmpWav, wavBuf);
      const args = [
        '-m', status.modelPath,
        '-l', this.config.language || 'en',
        '-f', tmpWav,
        '--no-timestamps',
        '-nt'
      ];
      const { stdout } = await execFileAsync(status.binaryPath, args, {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      });
      const text = stdout
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { ok: true, text };
    } catch (err) {
      return {
        ok: false,
        text: '',
        error: err instanceof Error ? err.message : 'Whisper transcription failed.'
      };
    } finally {
      if (!this.config.saveRawAudio) {
        try {
          if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  startStream(emit: (ev: SttStreamEvent) => void): { ok: boolean; sessionId?: string; error?: string } {
    this.stopStream();
    if (this.config.provider !== 'deepgram') {
      return { ok: false, error: 'Cloud streaming is only available when Deepgram is selected.' };
    }
    const apiKey = this.getDeepgramApiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: 'Missing Deepgram API key. Typed Q&A still works or switch to Local Whisper.'
      };
    }

    this.sessionSeq += 1;
    const sessionId = `stt-${Date.now()}-${this.sessionSeq}`;
    const session = new DeepgramStreamingSession(
      sessionId,
      this.config.deepgramModel,
      this.config.language,
      apiKey,
      this.deepgramTestBaseUrl,
      (ev) => {
        if (!this.activeCloudSession || this.activeCloudSession.sessionId !== ev.sessionId) {
          return;
        }
        if (ev.type === 'error' || ev.type === 'closed') {
          this.activeCloudSession = null;
        }
        emit(ev);
      }
    );
    this.activeCloudSession = session;
    session.start();
    return { ok: true, sessionId };
  }

  sendStreamAudio(sessionId: string, pcm16kBase64: string): void {
    if (!this.activeCloudSession || this.activeCloudSession.sessionId !== sessionId) return;
    if (this.config.provider !== 'deepgram') {
      this.stopStream();
      return;
    }
    try {
      const pcmBuf = Buffer.from(pcm16kBase64, 'base64');
      this.activeCloudSession.sendAudio(pcmBuf);
    } catch {
      /* ignore malformed audio chunk */
    }
  }

  stopStream(sessionId?: string): void {
    const cur = this.activeCloudSession;
    if (!cur) return;
    if (sessionId && cur.sessionId !== sessionId) return;
    this.activeCloudSession = null;
    cur.stop();
  }
}
