import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  type AiConfigPatch,
  type AiProviderId,
  type AiPublicConfig
} from '../shared/types';

interface StoredConfig {
  provider: AiProviderId;
  models: Partial<Record<AiProviderId, string>>;
  modelModes: Partial<Record<AiProviderId, 'auto' | 'manual'>>;
  customBaseUrl: string;
}

type EncryptedSecretsMap = Partial<Record<AiProviderId, string>>;

const VALID_PROVIDERS = new Set<AiProviderId>(['gemini', 'groq', 'nvidia', 'custom']);

function isValidProvider(value: unknown): value is AiProviderId {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as AiProviderId);
}

/**
 * Stores non-secret AI provider configuration in `ai-config.json` and API keys in `ai-secrets.json`
 * encrypted with Electron's OS-backed `safeStorage` when available. Plaintext keys are never written
 * to disk and never returned to the renderer.
 */
export class AiSecretStore {
  private readonly configPath: string;
  private readonly secretsPath: string;
  private config: StoredConfig;
  private readonly memoryKeys: Partial<Record<AiProviderId, string>> = {};
  private encryptedSecrets: EncryptedSecretsMap = {};

  constructor(userDataDir: string) {
    this.configPath = path.join(userDataDir, 'ai-config.json');
    this.secretsPath = path.join(userDataDir, 'ai-secrets.json');
    this.config = this.loadConfig();
    this.encryptedSecrets = this.loadEncryptedSecrets();
  }

  private loadConfig(): StoredConfig {
    const fallback: StoredConfig = {
      provider: 'gemini',
      models: {},
      modelModes: {},
      customBaseUrl: ''
    };
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<StoredConfig>;
      const provider = isValidProvider(raw.provider) ? raw.provider : 'gemini';
      const models: Partial<Record<AiProviderId, string>> = {};
      const modelModes: Partial<Record<AiProviderId, 'auto' | 'manual'>> = {};
      if (raw.models && typeof raw.models === 'object') {
        for (const id of VALID_PROVIDERS) {
          const val = raw.models[id];
          if (typeof val === 'string') {
            models[id] = val.trim().slice(0, 200);
          }
        }
      }
      if (raw.modelModes && typeof raw.modelModes === 'object') {
        for (const id of VALID_PROVIDERS) {
          const mode = raw.modelModes[id];
          if (mode === 'auto' || mode === 'manual') {
            modelModes[id] = mode;
          }
        }
      }
      const customBaseUrl =
        typeof raw.customBaseUrl === 'string' ? raw.customBaseUrl.trim().slice(0, 500) : '';
      return { provider, models, modelModes, customBaseUrl };
    } catch {
      return fallback;
    }
  }

  private saveConfig(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  private loadEncryptedSecrets(): EncryptedSecretsMap {
    if (!safeStorage.isEncryptionAvailable()) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.secretsPath, 'utf8')) as Record<string, unknown>;
      const out: EncryptedSecretsMap = {};
      for (const id of VALID_PROVIDERS) {
        const val = raw[id];
        if (typeof val === 'string' && val.length > 0) out[id] = val;
      }
      return out;
    } catch {
      return {};
    }
  }

  private saveEncryptedSecrets(): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(path.dirname(this.secretsPath), { recursive: true });
    fs.writeFileSync(this.secretsPath, JSON.stringify(this.encryptedSecrets, null, 2), 'utf8');
  }

  getActiveModel(provider = this.config.provider): string {
    return this.config.models[provider] ?? '';
  }

  getModelMode(provider = this.config.provider): 'auto' | 'manual' {
    const explicit = this.config.modelModes[provider];
    if (explicit === 'auto' || explicit === 'manual') return explicit;
    return this.getActiveModel(provider).length > 0 ? 'manual' : 'auto';
  }

  getPublicConfig(): AiPublicConfig {
    return {
      provider: this.config.provider,
      modelMode: this.getModelMode(this.config.provider),
      model: this.getActiveModel(this.config.provider),
      customBaseUrl: this.config.customBaseUrl,
      hasKey: {
        gemini: this.hasApiKey('gemini'),
        groq: this.hasApiKey('groq'),
        nvidia: this.hasApiKey('nvidia'),
        custom: this.hasApiKey('custom')
      },
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

  updateConfig(patch: AiConfigPatch): AiPublicConfig {
    if (patch.provider !== undefined && isValidProvider(patch.provider)) {
      this.config.provider = patch.provider;
    }
    if (patch.modelMode === 'auto') {
      this.config.modelModes[this.config.provider] = 'auto';
      this.config.models[this.config.provider] = '';
    } else if (patch.modelMode === 'manual') {
      this.config.modelModes[this.config.provider] = 'manual';
    }
    if (typeof patch.model === 'string') {
      const trimmed = patch.model.trim().slice(0, 200);
      this.config.models[this.config.provider] = trimmed;
      if (patch.modelMode === undefined) {
        this.config.modelModes[this.config.provider] = trimmed.length > 0 ? 'manual' : 'auto';
      }
    }
    if (typeof patch.customBaseUrl === 'string') {
      this.config.customBaseUrl = patch.customBaseUrl.trim().slice(0, 500);
    }
    this.saveConfig();
    return this.getPublicConfig();
  }

  setApiKey(provider: AiProviderId, apiKey: string): AiPublicConfig {
    if (!isValidProvider(provider)) throw new Error('Invalid provider');
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return this.clearApiKey(provider);
    }
    this.memoryKeys[provider] = trimmed;
    if (safeStorage.isEncryptionAvailable()) {
      this.encryptedSecrets[provider] = safeStorage.encryptString(trimmed).toString('base64');
      this.saveEncryptedSecrets();
    }
    return this.getPublicConfig();
  }

  clearApiKey(provider: AiProviderId): AiPublicConfig {
    if (!isValidProvider(provider)) throw new Error('Invalid provider');
    delete this.memoryKeys[provider];
    if (provider in this.encryptedSecrets) {
      delete this.encryptedSecrets[provider];
      this.saveEncryptedSecrets();
    }
    return this.getPublicConfig();
  }

  hasApiKey(provider: AiProviderId): boolean {
    if (this.memoryKeys[provider]) return true;
    return Boolean(this.encryptedSecrets[provider] && safeStorage.isEncryptionAvailable());
  }

  getApiKey(provider: AiProviderId): string | null {
    const mem = this.memoryKeys[provider];
    if (mem) return mem;
    const blob = this.encryptedSecrets[provider];
    if (!blob || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(blob, 'base64')).trim();
      if (!decrypted) return null;
      this.memoryKeys[provider] = decrypted;
      return decrypted;
    } catch {
      return null;
    }
  }
}
