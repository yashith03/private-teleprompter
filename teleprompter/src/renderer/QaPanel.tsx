import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AI_PROVIDER_PRESETS,
  type AiChatStreamEvent,
  type AiErrorKind,
  type AiPublicConfig,
  type QaKnowledgeBase,
  type QaKnowledgePatch,
  type QaPair,
  type QaSourceRef,
  type SttConfig,
  type SttStatus
} from '../shared/types';

export interface QaMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  stopped?: boolean;
  errorKind?: AiErrorKind;
  sourceMode?: 'approved_match' | 'retrieved' | 'no_evidence';
  providerLabel?: string;
  sources?: QaSourceRef[];
  verifiedRefs?: string[];
  unverifiedRefs?: string[];
}

interface QaPanelProps {
  aiConfig: AiPublicConfig | null;
  currentScript: string;
  isQaTabActive: boolean;
  sttConfig: SttConfig | null;
  sttStatus: SttStatus | null;
  onSttConfigChange: (patch: Partial<SttConfig>) => Promise<void>;
  onOpenSettings: () => void;
}

function errorLabel(kind: AiErrorKind): string {
  switch (kind) {
    case 'invalid_key': return 'Invalid API key';
    case 'unavailable_model': return 'Unavailable model';
    case 'rate_limit': return 'Rate limit';
    case 'timeout': return 'Timeout';
    case 'offline': return 'Offline';
    case 'invalid_endpoint': return 'Invalid endpoint';
    case 'redirect_blocked': return 'Redirect blocked';
    case 'cancelled': return 'Stopped';
    default: return 'Provider error';
  }
}

function downsampleTo16kInt16(input: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputSampleRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = Math.min(input.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, input[idx]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ChunksToBase64(chunks: Int16Array[]): string {
  let total = 0;
  for (const c of chunks) total += c.length;
  const bytes = new Uint8Array(total * 2);
  let offset = 0;
  for (const c of chunks) {
    const view = new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
    bytes.set(view, offset);
    offset += view.byteLength;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * AI Q&A panel with `Ask` (typed + optional local whisper.cpp mic input) and `Prepare`
 * (local slide speech, research notes, and approved Q&A pairs).
 */
export function QaPanel({
  aiConfig,
  currentScript,
  isQaTabActive,
  sttConfig,
  sttStatus,
  onSttConfigChange,
  onOpenSettings
}: QaPanelProps) {
  const [view, setView] = useState<'ask' | 'prepare'>('ask');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [kb, setKb] = useState<QaKnowledgeBase>({
    slideSpeech: '',
    researchNotes: '',
    approvedPairs: []
  });
  const [pairQ, setPairQ] = useState('');
  const [pairA, setPairA] = useState('');
  const [pairRef, setPairRef] = useState('');

  // Mic / whisper.cpp state (raw audio recording is off by default)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState('');

  const activeReqRef = useRef<{ requestId: string; assistantId: string; questionEndAt?: number } | null>(null);
  const pendingEventsRef = useRef<Map<string, AiChatStreamEvent[]>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const kbTimerRef = useRef<number | undefined>(undefined);
  const kbPendingRef = useRef<QaKnowledgePatch>({});
  const streamingRef = useRef(false);
  const messagesRef = useRef<QaMessage[]>([]);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const pcmBufferRef = useRef<Int16Array[]>([]);
  const hasSpeechRef = useRef(false);
  const silenceMsRef = useRef(0);
  const lastPartialAtRef = useRef(0);
  const transcribingRef = useRef(false);
  const listeningRef = useRef(false);

  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);

  useEffect(() => {
    void window.teleprompter.getQaKnowledge().then(setKb);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* ignore device enumeration failure */
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const updateKb = (patch: QaKnowledgePatch, immediate = false) => {
    setKb((cur) => ({ ...cur, ...patch }));
    kbPendingRef.current = { ...kbPendingRef.current, ...patch };
    window.clearTimeout(kbTimerRef.current);
    const flush = () => {
      const out = kbPendingRef.current;
      kbPendingRef.current = {};
      void window.teleprompter.updateQaKnowledge(out);
    };
    if (immediate) flush();
    else kbTimerRef.current = window.setTimeout(flush, 180);
  };

  const applyStreamEvent = useCallback((ev: AiChatStreamEvent, assistantId: string) => {
    if (ev.type === 'sources') {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, sourceMode: ev.mode, providerLabel: ev.providerLabel, sources: ev.sources }
            : m
        )
      );
    } else if (ev.type === 'delta') {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + ev.text } : m))
      );
    } else if (ev.type === 'done') {
      activeReqRef.current = null;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, verifiedRefs: ev.verifiedRefs, unverifiedRefs: ev.unverifiedRefs }
            : m
        )
      );
    } else if (ev.type === 'cancelled') {
      activeReqRef.current = null;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false, stopped: true } : m))
      );
    } else if (ev.type === 'error') {
      activeReqRef.current = null;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                streaming: false,
                errorKind: ev.errorKind,
                text: m.text || `${errorLabel(ev.errorKind)}: ${ev.error}`
              }
            : m
        )
      );
    }
  }, []);

  useEffect(() => {
    return window.teleprompter.onAiStreamEvent((ev) => {
      const cur = activeReqRef.current;
      if (!cur || ev.requestId !== cur.requestId) {
        const buf = pendingEventsRef.current.get(ev.requestId) ?? [];
        buf.push(ev);
        pendingEventsRef.current.set(ev.requestId, buf);
        return;
      }
      applyStreamEvent(ev, cur.assistantId);
    });
  }, [applyStreamEvent]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveTranscript]);

  const submitQuestionText = useCallback(async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || streamingRef.current) return;

    const idBase = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMsg: QaMessage = { id: `${idBase}-u`, role: 'user', text: trimmed };
    const assistantId = `${idBase}-a`;
    const history = messagesRef.current
      .filter((m) => !m.errorKind && m.text.trim().length > 0)
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text }));

    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', text: '', streaming: true }
    ]);

    try {
      const { requestId } = await window.teleprompter.sendAiMessage({
        question: trimmed,
        history
      });
      activeReqRef.current = { requestId, assistantId };
      const buffered = pendingEventsRef.current.get(requestId);
      if (buffered) {
        pendingEventsRef.current.delete(requestId);
        for (const ev of buffered) applyStreamEvent(ev, assistantId);
      }
    } catch (err) {
      activeReqRef.current = null;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                streaming: false,
                errorKind: 'provider_error',
                text: err instanceof Error ? err.message : 'Failed to start request.'
              }
            : m
        )
      );
    }
  }, [applyStreamEvent]);

  const stopMic = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    setLiveTranscript('');
    pcmBufferRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;

    if (procRef.current) {
      procRef.current.disconnect();
      procRef.current.onaudioprocess = null;
      procRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) t.stop();
      micStreamRef.current = null;
    }
  }, []);

  const flushUtterance = useCallback(async (isFinal: boolean) => {
    if (transcribingRef.current || pcmBufferRef.current.length === 0) return;
    const chunks = isFinal ? pcmBufferRef.current.splice(0) : [...pcmBufferRef.current];
    if (isFinal) {
      hasSpeechRef.current = false;
      silenceMsRef.current = 0;
    }

    transcribingRef.current = true;
    try {
      const b64 = int16ChunksToBase64(chunks);
      const res = await window.teleprompter.transcribeAudio(b64, isFinal);
      if (!res.ok) {
        if (res.error) setMicError(res.error);
        if (isFinal) setLiveTranscript('');
        return;
      }
      if (res.text) {
        setLiveTranscript(res.text);
        if (isFinal) {
          const finalText = res.text.trim();
          setLiveTranscript('');
          if (finalText) {
            await submitQuestionText(finalText);
          }
        }
      } else if (isFinal) {
        setLiveTranscript('');
      }
    } finally {
      transcribingRef.current = false;
    }
  }, [submitQuestionText]);

  const startMic = useCallback(async () => {
    if (listeningRef.current) return;
    setMicError(null);
    if (!sttStatus?.available) {
      setMicError(sttStatus?.reason || 'Whisper transcription model unavailable. Typed input remains usable.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone API unavailable. Typed input remains usable.');
      return;
    }

    try {
      const audioConstraint: MediaTrackConstraints = sttConfig?.deviceId
        ? { deviceId: { exact: sttConfig.deviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
      micStreamRef.current = stream;
      if (!sttConfig?.permissionGranted) {
        await onSttConfigChange({ permissionGranted: true });
      }
      await refreshDevices();

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      procRef.current = processor;
      pcmBufferRef.current = [];
      hasSpeechRef.current = false;
      silenceMsRef.current = 0;
      lastPartialAtRef.current = Date.now();

      processor.onaudioprocess = (ev) => {
        if (!listeningRef.current) return;
        const f32 = ev.inputBuffer.getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < f32.length; i++) sumSq += f32[i] * f32[i];
        const rms = Math.sqrt(sumSq / f32.length);
        const frameMs = (f32.length / ctx.sampleRate) * 1000;

        if (rms > 0.015) {
          hasSpeechRef.current = true;
          silenceMsRef.current = 0;
        } else if (hasSpeechRef.current) {
          silenceMsRef.current += frameMs;
        }

        if (hasSpeechRef.current) {
          pcmBufferRef.current.push(downsampleTo16kInt16(f32, ctx.sampleRate));
          const now = Date.now();
          if (silenceMsRef.current >= 900) {
            void flushUtterance(true);
          } else if (now - lastPartialAtRef.current >= 900) {
            lastPartialAtRef.current = now;
            void flushUtterance(false);
          }
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);
      listeningRef.current = true;
      setListening(true);
    } catch (err) {
      stopMic();
      const msg = err instanceof Error ? err.message : 'Microphone permission denied.';
      setMicError(`Mic unavailable (${msg}). Typed input remains usable.`);
    }
  }, [sttStatus, sttConfig, onSttConfigChange, refreshDevices, flushUtterance, stopMic]);

  // Stop mic capture on tab exit, Prepare view switch, minimize, or app close.
  useEffect(() => {
    if (!isQaTabActive || view !== 'ask') {
      stopMic();
    } else if (sttConfig?.autoListen && sttConfig?.permissionGranted && sttStatus?.available && !listeningRef.current) {
      void startMic();
    }
  }, [isQaTabActive, view, sttConfig?.autoListen, sttConfig?.permissionGranted, sttStatus?.available, startMic, stopMic]);

  useEffect(() => {
    const unsubMin = window.teleprompter.onWindowMinimized(() => stopMic());
    const onUnload = () => stopMic();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsubMin();
      window.removeEventListener('beforeunload', onUnload);
      stopMic();
    };
  }, [stopMic]);

  // Sample audio rehearsal hook for automated self-testing (feeds 16kHz PCM chunks without a hardware mic).
  useEffect(() => {
    const onSampleAudio = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pcm16kBase64: string; isFinal: boolean }>).detail;
      if (!detail || typeof detail.pcm16kBase64 !== 'string') return;
      const raw = atob(detail.pcm16kBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      pcmBufferRef.current.push(new Int16Array(bytes.buffer));
      void flushUtterance(detail.isFinal);
    };
    window.addEventListener('qa-sample-audio', onSampleAudio);
    return () => window.removeEventListener('qa-sample-audio', onSampleAudio);
  }, [flushUtterance]);

  const stopStream = () => {
    const cur = activeReqRef.current;
    if (!cur) return;
    void window.teleprompter.stopAiStream(cur.requestId);
  };

  const sendTypedQuestion = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput('');
    await submitQuestionText(trimmed);
  };

  const addApprovedPair = () => {
    const q = pairQ.trim();
    const a = pairA.trim();
    if (!q || !a) return;
    const ref = pairRef.trim();
    const nextPair: QaPair = {
      id: `pair-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      question: q,
      answer: a,
      ...(ref ? { reference: ref } : {})
    };
    setPairQ('');
    setPairA('');
    setPairRef('');
    updateKb({ approvedPairs: [nextPair, ...kb.approvedPairs] }, true);
  };

  const removeApprovedPair = (id: string) => {
    updateKb({ approvedPairs: kb.approvedPairs.filter((p) => p.id !== id) }, true);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendTypedQuestion();
    }
  };

  const providerLabel = aiConfig ? AI_PROVIDER_PRESETS[aiConfig.provider].label : 'AI';
  const modelLabel = aiConfig?.model?.trim() || 'No model';
  const hasKey = aiConfig ? aiConfig.hasKey[aiConfig.provider] : false;

  return (
    <section className="qa-panel" data-testid="qa-panel" aria-label="AI Q&A">
      <div className="qa-header">
        <span className="qa-model" data-testid="qa-model-label">
          {providerLabel} · {modelLabel}
        </span>
        <div className="qa-header-right">
          <div className="qa-subtabs" role="tablist" aria-label="Q&A Mode">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'ask'}
              data-testid="qa-subtab-ask"
              className={`qa-subtab ${view === 'ask' ? 'active' : ''}`}
              onClick={() => setView('ask')}
            >
              Ask
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'prepare'}
              data-testid="qa-subtab-prepare"
              className={`qa-subtab ${view === 'prepare' ? 'active' : ''}`}
              onClick={() => setView('prepare')}
            >
              Prepare
            </button>
          </div>
          <span className={`qa-status ${streaming ? 'streaming' : ''}`} data-testid="qa-status">
            {streaming ? 'Streaming...' : 'Ready'}
          </span>
          <button
            type="button"
            className="qa-setup-btn"
            data-testid="qa-open-settings"
            onClick={onOpenSettings}
          >
            {hasKey ? 'Provider' : 'Set key'}
          </button>
        </div>
      </div>

      {view === 'prepare' ? (
        <div className="qa-prepare-body" data-testid="qa-prepare-view">
          <div className="qa-disclosure" data-testid="qa-provider-disclosure">
            Stored locally across providers. Unmatched questions send only retrieved excerpts to{' '}
            <strong>{providerLabel} ({modelLabel})</strong>. Notes are treated as source material, not instructions.
          </div>

          <div className="qa-prep-section">
            <div className="qa-prep-row">
              <span>Slide-numbered speech</span>
              <button
                type="button"
                className="ai-mini-btn"
                data-testid="qa-copy-script"
                onClick={() => updateKb({ slideSpeech: currentScript }, true)}
              >
                Use Script
              </button>
            </div>
            <textarea
              className="qa-prep-textarea"
              data-testid="qa-speech-input"
              rows={3}
              placeholder="Paste slide-numbered speech (e.g. Slide 1: Intro)..."
              value={kb.slideSpeech}
              onChange={(e) => updateKb({ slideSpeech: e.target.value })}
            />
          </div>

          <div className="qa-prep-section">
            <span>Research notes</span>
            <textarea
              className="qa-prep-textarea"
              data-testid="qa-notes-input"
              rows={3}
              placeholder="Paste supporting research notes, specs, or architecture decisions..."
              value={kb.researchNotes}
              onChange={(e) => updateKb({ researchNotes: e.target.value })}
            />
          </div>

          <div className="qa-prep-section">
            <span>Approved Q&amp;A pairs (answered locally without API call)</span>
            <input
              type="text"
              className="ai-text-input"
              data-testid="qa-pair-q"
              placeholder="Expected question (e.g. Why did you choose Vulkan?)"
              value={pairQ}
              onChange={(e) => setPairQ(e.target.value)}
            />
            <textarea
              className="qa-prep-textarea"
              data-testid="qa-pair-a"
              rows={2}
              placeholder="Approved answer..."
              value={pairA}
              onChange={(e) => setPairA(e.target.value)}
            />
            <div className="qa-pair-actions">
              <input
                type="text"
                className="ai-text-input"
                data-testid="qa-pair-ref"
                placeholder="Ref (optional, e.g. Slide 3)"
                value={pairRef}
                onChange={(e) => setPairRef(e.target.value)}
              />
              <button
                type="button"
                className="ai-mini-btn"
                data-testid="qa-pair-add"
                disabled={!pairQ.trim() || !pairA.trim()}
                onClick={addApprovedPair}
              >
                Add Q&amp;A
              </button>
            </div>
            {kb.approvedPairs.length > 0 && (
              <div className="qa-pair-list" data-testid="qa-pair-list">
                {kb.approvedPairs.map((p) => (
                  <div key={p.id} className="qa-pair-item" data-testid="qa-pair-item">
                    <div className="qa-pair-item-text">
                      <strong>{p.question}</strong>
                      <span>{p.answer}</span>
                      {p.reference && <em>Ref: {p.reference}</em>}
                    </div>
                    <button
                      type="button"
                      className="ai-mini-btn"
                      onClick={() => removeApprovedPair(p.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="qa-mic-bar" data-testid="qa-mic-bar">
            <select
              className="ai-select qa-mic-device"
              data-testid="mic-device"
              aria-label="Microphone device"
              value={sttConfig?.deviceId ?? ''}
              onChange={(e) => void onSttConfigChange({ deviceId: e.target.value })}
            >
              <option value="">Default mic</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            <span className={`qa-mic-status ${listening ? 'listening' : ''}`} data-testid="mic-status">
              {listening ? 'Listening' : 'Mic Off'}
            </span>
            {listening ? (
              <button
                type="button"
                className="ai-mini-btn qa-mic-stop"
                data-testid="mic-stop"
                onClick={stopMic}
              >
                Stop mic
              </button>
            ) : (
              <button
                type="button"
                className="ai-mini-btn"
                data-testid="mic-start"
                onClick={() => void startMic()}
              >
                Start mic
              </button>
            )}
          </div>

          {micError && (
            <div className="qa-mic-error" data-testid="mic-error" role="status">
              {micError}
            </div>
          )}

          {liveTranscript && (
            <div className="qa-live-transcript" data-testid="qa-live-transcript">
              Hearing: {liveTranscript}
            </div>
          )}

          <div
            ref={listRef}
            className="qa-messages"
            data-testid="qa-messages"
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="qa-empty" data-testid="qa-empty">
                {kb.approvedPairs.length > 0 || kb.slideSpeech.trim() || kb.researchNotes.trim()
                  ? `Local notes ready. Approved Q&A answers locally; unmatched questions send relevant excerpts to ${providerLabel} (${modelLabel}).`
                  : hasKey || aiConfig?.provider === 'custom'
                    ? 'Ask a question or open Prepare to add slides, notes, and approved Q&A.'
                    : 'Open Prepare to add local Q&A, or set an API key in Provider settings.'}
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`qa-msg ${m.role} ${m.errorKind ? 'error' : ''}`}
                  data-testid={`qa-msg-${m.role}`}
                >
                  <div className="qa-msg-role-row">
                    <span className="qa-msg-role">
                      {m.role === 'user' ? 'You' : 'AI'}
                      {m.stopped ? ' (Stopped)' : ''}
                      {m.errorKind ? ` · ${errorLabel(m.errorKind)}` : ''}
                    </span>
                    {m.role === 'user' && (
                      <button
                        type="button"
                        className="qa-edit-btn"
                        data-testid="qa-edit-question"
                        onClick={() => {
                          setInput(m.text);
                          inputRef.current?.focus();
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="qa-msg-text">{m.text || (m.streaming ? '...' : '')}</div>
                  {m.role === 'assistant' && m.sourceMode && (
                    <div className="qa-msg-meta" data-testid="qa-msg-meta">
                      {m.sourceMode === 'approved_match' && 'Approved Q&A (local · no API call)'}
                      {m.sourceMode === 'no_evidence' && 'No matching evidence in local slides/notes (no API call)'}
                      {m.sourceMode === 'retrieved' && (
                        <>
                          Sent excerpts to {m.providerLabel || `${providerLabel} (${modelLabel})`}
                          {m.sources && m.sources.length > 0 && ` · Sources: ${m.sources.map((s) => s.id).join(', ')}`}
                        </>
                      )}
                      {m.verifiedRefs && m.verifiedRefs.length > 0 && ` · Verified refs: ${m.verifiedRefs.join(', ')}`}
                      {m.unverifiedRefs && m.unverifiedRefs.length > 0 && ` · Unverified refs: ${m.unverifiedRefs.join(', ')}`}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <form
            className="qa-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void sendTypedQuestion();
            }}
          >
            <textarea
              ref={inputRef}
              className="qa-input"
              data-testid="qa-input"
              aria-label="Question"
              placeholder="Ask a question..."
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="submit"
              className="btn-primary qa-send"
              data-testid="qa-send"
              disabled={streaming || input.trim().length === 0}
            >
              Send
            </button>
            <button
              type="button"
              className="btn-secondary qa-stop"
              data-testid="qa-stop"
              disabled={!streaming}
              onClick={stopStream}
            >
              Stop
            </button>
          </form>
        </>
      )}
    </section>
  );
}
