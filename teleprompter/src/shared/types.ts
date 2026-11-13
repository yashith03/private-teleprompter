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

export type AiProviderId = 'gemini' | 'groq' | 'nvidia' | 'custom';

export type AiErrorKind =
  | 'invalid_key'
  | 'unavailable_model'
  | 'rate_limit'
  | 'timeout'
  | 'offline'
  | 'invalid_endpoint'
  | 'redirect_blocked'
  | 'cancelled'
  | 'provider_error';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  supportsModelList: boolean;
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    supportsModelList: true
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    supportsModelList: true
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    suggestedModels: [
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.3-70b-instruct',
      'mistralai/mixtral-8x22b-instruct-v0.1'
    ],
    supportsModelList: true
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    defaultBaseUrl: '',
    defaultModel: '',
    suggestedModels: [],
    supportsModelList: true
  }
};

export interface AiPublicConfig {
  provider: AiProviderId;
  model: string;
  customBaseUrl: string;
  hasKey: Record<AiProviderId, boolean>;
  encryptionAvailable: boolean;
}

export interface AiConfigPatch {
  provider?: AiProviderId;
  model?: string;
  customBaseUrl?: string;
}

export interface AiModelListResult {
  ok: boolean;
  models: string[];
  errorKind?: AiErrorKind;
  error?: string;
}

export interface AiTestConnectionResult {
  ok: boolean;
  latencyMs?: number;
  replyPreview?: string;
  errorKind?: AiErrorKind;
  error?: string;
}

export interface AiSendMessageInput {
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface QaPair {
  id: string;
  question: string;
  answer: string;
  reference?: string;
}

export interface QaKnowledgeBase {
  slideSpeech: string;
  researchNotes: string;
  approvedPairs: QaPair[];
}

export type QaKnowledgePatch = Partial<QaKnowledgeBase>;

export interface QaSourceRef {
  id: string;
  label: string;
  excerpt: string;
}

export interface SttConfig {
  language: string;
  modelPath: string;
  binaryPath: string;
  deviceId: string;
  autoListen: boolean;
  permissionGranted: boolean;
  saveRawAudio: boolean;
}

export interface SttStatus {
  available: boolean;
  binaryPath: string | null;
  modelPath: string | null;
  reason?: string;
}

export interface SttTranscribeResult {
  ok: boolean;
  text: string;
  error?: string;
}

export type AiChatStreamEvent =
  | {
      requestId: string;
      type: 'sources';
      mode: 'approved_match' | 'retrieved' | 'no_evidence';
      providerLabel?: string;
      sources: QaSourceRef[];
      matchedPairId?: string;
    }
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; verifiedRefs?: string[]; unverifiedRefs?: string[] }
  | { requestId: string; type: 'error'; errorKind: AiErrorKind; error: string }
  | { requestId: string; type: 'cancelled' };

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
  getAiConfig(): Promise<AiPublicConfig>;
  updateAiConfig(patch: AiConfigPatch): Promise<AiPublicConfig>;
  setAiApiKey(provider: AiProviderId, apiKey: string): Promise<AiPublicConfig>;
  clearAiApiKey(provider: AiProviderId): Promise<AiPublicConfig>;
  listAiModels(): Promise<AiModelListResult>;
  testAiConnection(): Promise<AiTestConnectionResult>;
  sendAiMessage(input: AiSendMessageInput): Promise<{ requestId: string }>;
  stopAiStream(requestId?: string): Promise<void>;
  onAiStreamEvent(cb: (ev: AiChatStreamEvent) => void): () => void;
  getQaKnowledge(): Promise<QaKnowledgeBase>;
  updateQaKnowledge(patch: QaKnowledgePatch): Promise<QaKnowledgeBase>;
  getSttConfig(): Promise<SttConfig>;
  updateSttConfig(patch: Partial<SttConfig>): Promise<SttConfig>;
  getSttStatus(): Promise<SttStatus>;
  transcribeAudio(pcm16kBase64: string, isFinal: boolean): Promise<SttTranscribeResult>;
  onWindowMinimized(cb: () => void): () => void;
  quit(): void;
}

export const DEFAULT_SCRIPT =
  'Sample script\n\nPaste or type your script here. Press Edit to change this text, then Start to begin scrolling. ' +
  'Keep the window near your webcam so your eyes stay close to the lens.\n\n' +
  'Space starts and pauses scrolling.';
