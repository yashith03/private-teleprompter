import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SttConfig, SttStatus, SttTranscribeResult } from '../shared/types';

const execFileAsync = promisify(execFile);

const DEFAULT_STT_CONFIG: SttConfig = {
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
  private readonly userDataDir: string;
  private config: SttConfig;
  private mockTranscriber: ((pcm16: Buffer, isFinal: boolean) => Promise<SttTranscribeResult>) | null = null;

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
    this.configPath = path.join(userDataDir, 'stt-config.json');
    this.config = this.loadConfig();
  }

  setMockTranscriber(fn: ((pcm16: Buffer, isFinal: boolean) => Promise<SttTranscribeResult>) | null): void {
    this.mockTranscriber = fn;
  }

  private loadConfig(): SttConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<SttConfig>;
      return {
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
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  getConfig(): SttConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<SttConfig>): SttConfig {
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
    this.saveConfig();
    return this.getConfig();
  }

  getStatus(): SttStatus {
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
      if (!binaryPath) missing.push('whisper.cpp binary (whisper-cli.exe)');
      if (!modelPath) missing.push('ggml model (.bin)');
      return {
        available: false,
        binaryPath,
        modelPath,
        reason: `Missing ${missing.join(' and ')}. Typed Q&A remains available.`
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
}
