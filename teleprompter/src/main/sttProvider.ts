import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { DeepgramModelId, SttConfig, SttProviderId, SttStatus, SttStreamEvent } from '../shared/types';

export interface TranscriptionProvider {
  readonly id: SttProviderId;
  getStatus(config: SttConfig, hasDeepgramKey: boolean): SttStatus;
}

/**
 * Minimal RFC 6455 WebSocket client built on Node's core `http`/`https` + `crypto`.
 * Supports `wss://` and `ws://` (for local tests), custom `Authorization` headers,
 * binary audio frames, text JSON frames, ping/pong, and clean CloseStream shutdown.
 */
class NodeWebSocketClient {
  private socket: net.Socket | null = null;
  private req: http.ClientRequest | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private opened = false;
  private closed = false;
  private fragOpcode = 0;
  private fragChunks: Buffer[] = [];

  constructor(
    private readonly urlStr: string,
    private readonly headers: Record<string, string>,
    private readonly handlers: {
      onOpen: () => void;
      onText: (text: string) => void;
      onError: (message: string) => void;
      onClose: () => void;
    }
  ) {}

  connect(): void {
    let parsed: URL;
    try {
      parsed = new URL(this.urlStr);
    } catch {
      this.handlers.onError('Invalid Deepgram WebSocket URL.');
      return;
    }

    const isTls = parsed.protocol === 'wss:';
    const isPlain = parsed.protocol === 'ws:';
    if (!isTls && !isPlain) {
      this.handlers.onError('Unsupported WebSocket protocol.');
      return;
    }

    const key = crypto.randomBytes(16).toString('base64');
    const reqModule = isTls ? https : http;
    const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
    const reqPath = `${parsed.pathname}${parsed.search}`;

    const req = reqModule.request({
      hostname: parsed.hostname,
      port,
      path: reqPath,
      method: 'GET',
      headers: {
        ...this.headers,
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    this.req = req;

    req.on('upgrade', (_res, socket, head) => {
      if (this.closed) {
        socket.destroy();
        return;
      }
      this.socket = socket;
      this.opened = true;
      if (head && head.length > 0) {
        this.buffer = Buffer.concat([this.buffer, head]);
      }

      socket.on('data', (chunk: Buffer) => {
        if (this.closed) return;
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.drainFrames();
      });
      socket.on('error', (err) => {
        if (this.closed) return;
        this.closed = true;
        this.handlers.onError(err.message || 'Deepgram connection error.');
      });
      socket.on('close', () => {
        if (this.closed) return;
        this.closed = true;
        this.handlers.onClose();
      });

      this.handlers.onOpen();
      if (this.buffer.length > 0) this.drainFrames();
    });

    req.on('response', (res) => {
      if (this.closed) return;
      this.closed = true;
      const status = res.statusCode ?? 0;
      res.resume();
      if (status === 401 || status === 403) {
        this.handlers.onError(`Deepgram authentication failed (${status}). Check your Deepgram API key.`);
      } else {
        this.handlers.onError(`Deepgram connection rejected (HTTP ${status}).`);
      }
    });

    req.on('error', (err) => {
      if (this.closed) return;
      this.closed = true;
      this.handlers.onError(err.message || 'Unable to reach Deepgram.');
    });

    req.end();
  }

  sendBinary(data: Buffer): void {
    if (this.closed || !this.opened || !this.socket || this.socket.destroyed) return;
    this.sendFrame(0x02, data);
  }

  sendText(text: string): void {
    if (this.closed || !this.opened || !this.socket || this.socket.destroyed) return;
    this.sendFrame(0x01, Buffer.from(text, 'utf8'));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const sock = this.socket;
    const req = this.req;
    this.socket = null;
    this.req = null;
    try {
      if (this.opened && sock && !sock.destroyed) {
        this.sendFrameOn(sock, 0x08, Buffer.alloc(0));
        sock.end();
        setTimeout(() => {
          if (!sock.destroyed) sock.destroy();
        }, 50);
      } else if (req) {
        req.destroy();
      }
    } catch {
      /* ignore close errors */
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (!this.socket || this.socket.destroyed) return;
    this.sendFrameOn(this.socket, opcode, payload);
  }

  private sendFrameOn(sock: net.Socket, opcode: number, payload: Buffer): void {
    if (sock.destroyed) return;
    const len = payload.length;
    let headerLen = 2;
    if (len >= 126 && len <= 65535) headerLen = 4;
    else if (len > 65535) headerLen = 10;

    const maskKey = crypto.randomBytes(4);
    const frame = Buffer.allocUnsafe(headerLen + 4 + len);
    frame[0] = 0x80 | (opcode & 0x0f);

    if (headerLen === 2) {
      frame[1] = 0x80 | len;
    } else if (headerLen === 4) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
    }

    maskKey.copy(frame, headerLen);
    for (let i = 0; i < len; i++) {
      frame[headerLen + 4 + i] = payload[i] ^ maskKey[i & 3];
    }

    try {
      sock.write(frame);
    } catch {
      /* socket write errors handled by socket 'error' event */
    }
  }

  private drainFrames(): void {
    while (this.buffer.length >= 2 && !this.closed) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        const bigLen = this.buffer.readBigUInt64BE(2);
        if (bigLen > BigInt(16 * 1024 * 1024)) {
          this.close();
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLen + payloadLen) return;

      let payload = this.buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i & 3];
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }

      this.buffer = this.buffer.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x08) {
        this.closed = true;
        this.handlers.onClose();
        return;
      }
      if (opcode === 0x09) {
        this.sendFrame(0x0a, payload);
        continue;
      }
      if (opcode === 0x0a) continue;

      if (opcode !== 0x00) {
        this.fragOpcode = opcode;
        this.fragChunks = [payload];
      } else {
        this.fragChunks.push(payload);
      }

      if (fin) {
        const full = Buffer.concat(this.fragChunks);
        const op = this.fragOpcode;
        this.fragChunks = [];
        this.fragOpcode = 0;
        if (op === 0x01) {
          this.handlers.onText(full.toString('utf8'));
        }
      }
    }
  }
}

export function buildDeepgramUrl(
  model: DeepgramModelId,
  language: string,
  baseUrlOverride?: string | null
): string {
  const base = (baseUrlOverride && baseUrlOverride.trim()) || 'wss://api.deepgram.com';
  const cleanBase = base.replace(/\/+$/, '');
  const lang = (language || 'en').trim() || 'en';
  if (model === 'flux-general-en') {
    return `${cleanBase}/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000`;
  }
  const params = new URLSearchParams({
    model: 'nova-3',
    language: lang,
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '300',
    utterance_end_ms: '1000'
  });
  return `${cleanBase}/v1/listen?${params.toString()}`;
}

/**
 * Manages one Deepgram streaming session (Flux v2 or Nova-3 v1).
 * Discards all late events once `stop()` has been called.
 */
export class DeepgramStreamingSession {
  private ws: NodeWebSocketClient;
  private closed = false;
  private novaFinalSegments: string[] = [];
  private novaBoundaryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCommittedKey = '';
  private lastCommittedNorm = '';
  private lastCommittedAt = 0;

  constructor(
    public readonly sessionId: string,
    private readonly model: DeepgramModelId,
    language: string,
    apiKey: string,
    baseUrlOverride: string | null,
    private readonly emit: (ev: SttStreamEvent) => void
  ) {
    const url = buildDeepgramUrl(model, language, baseUrlOverride);
    this.ws = new NodeWebSocketClient(
      url,
      { Authorization: `Token ${apiKey}` },
      {
        onOpen: () => {
          if (this.closed) return;
          this.emit({ sessionId: this.sessionId, type: 'ready' });
        },
        onText: (raw) => {
          if (this.closed) return;
          this.handleMessage(raw);
        },
        onError: (error) => {
          if (this.closed) return;
          this.closed = true;
          this.clearTimers();
          this.emit({ sessionId: this.sessionId, type: 'error', error });
        },
        onClose: () => {
          if (this.closed) return;
          this.closed = true;
          this.clearTimers();
          this.emit({ sessionId: this.sessionId, type: 'closed' });
        }
      }
    );
  }

  start(): void {
    if (this.closed) return;
    this.ws.connect();
  }

  sendAudio(pcm16k: Buffer): void {
    if (this.closed || pcm16k.length === 0) return;
    this.ws.sendBinary(pcm16k);
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.novaFinalSegments = [];
    try {
      this.ws.sendText(JSON.stringify({ type: 'CloseStream' }));
    } catch {
      /* ignore */
    }
    this.ws.close();
  }

  private clearTimers(): void {
    if (this.novaBoundaryTimer) {
      clearTimeout(this.novaBoundaryTimer);
      this.novaBoundaryTimer = null;
    }
  }

  private commitFinal(text: string, dedupeKey?: string): void {
    if (this.closed) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const norm = trimmed.toLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();
    if (dedupeKey && dedupeKey === this.lastCommittedKey) return;
    if (norm === this.lastCommittedNorm && now - this.lastCommittedAt < 3000) return;

    if (dedupeKey) this.lastCommittedKey = dedupeKey;
    this.lastCommittedNorm = norm;
    this.lastCommittedAt = now;
    this.emit({ sessionId: this.sessionId, type: 'final', text: trimmed, dedupeKey });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.type === 'Error' || typeof msg.err_msg === 'string') {
      const errText =
        (typeof msg.description === 'string' && msg.description) ||
        (typeof msg.message === 'string' && msg.message) ||
        (typeof msg.err_msg === 'string' && msg.err_msg) ||
        'Deepgram streaming error.';
      this.closed = true;
      this.clearTimers();
      this.ws.close();
      this.emit({ sessionId: this.sessionId, type: 'error', error: errText });
      return;
    }

    if (this.model === 'flux-general-en') {
      this.handleFluxMessage(msg);
    } else {
      this.handleNova3Message(msg);
    }
  }

  /**
   * Flux (`/v2/listen`): show interim text on StartOfTurn/Update/EagerEndOfTurn/TurnResumed,
   * and commit ONLY on EndOfTurn.
   */
  private handleFluxMessage(msg: Record<string, unknown>): void {
    if (msg.type !== 'TurnInfo') return;
    const evName = typeof msg.event === 'string' ? msg.event : '';
    const transcript = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
    const turnIdx = typeof msg.turn_index === 'number' ? msg.turn_index : undefined;

    if (evName === 'EndOfTurn') {
      if (transcript) {
        const key = turnIdx !== undefined ? `flux-turn-${turnIdx}` : undefined;
        this.commitFinal(transcript, key);
      } else {
        this.emit({ sessionId: this.sessionId, type: 'interim', text: '' });
      }
      return;
    }

    if (
      evName === 'StartOfTurn' ||
      evName === 'Update' ||
      evName === 'EagerEndOfTurn' ||
      evName === 'TurnResumed'
    ) {
      if (transcript) {
        this.emit({ sessionId: this.sessionId, type: 'interim', text: transcript });
      }
    }
  }

  /**
   * Nova-3 (`/v1/listen`): accumulate finalized segments (`is_final: true`) across short pauses
   * and submit ONLY on the utterance boundary (`speech_final: true`, `UtteranceEnd`, or fallback boundary timer).
   */
  private handleNova3Message(msg: Record<string, unknown>): void {
    if (msg.type === 'UtteranceEnd') {
      this.clearTimers();
      if (this.novaFinalSegments.length > 0) {
        const full = this.novaFinalSegments.join(' ').trim();
        this.novaFinalSegments = [];
        this.commitFinal(full);
      }
      return;
    }

    if (msg.type !== 'Results') return;
    const channel = msg.channel as { alternatives?: Array<{ transcript?: string }> } | undefined;
    const transcript = channel?.alternatives?.[0]?.transcript?.trim() ?? '';
    const isFinal = msg.is_final === true;
    const speechFinal = msg.speech_final === true;

    if (!isFinal) {
      const combined = [...this.novaFinalSegments, transcript].filter(Boolean).join(' ').trim();
      if (combined) {
        this.emit({ sessionId: this.sessionId, type: 'interim', text: combined });
      }
      return;
    }

    if (transcript) {
      this.novaFinalSegments.push(transcript);
    }

    const accumulated = this.novaFinalSegments.join(' ').trim();
    if (!accumulated) return;

    if (speechFinal) {
      this.clearTimers();
      this.novaFinalSegments = [];
      this.commitFinal(accumulated);
      return;
    }

    // Short pause (`is_final: true`, `speech_final: false`): show accumulated text locally
    // and wait for either more speech, `UtteranceEnd`, or a 1100ms utterance boundary.
    this.emit({ sessionId: this.sessionId, type: 'interim', text: accumulated });
    this.clearTimers();
    this.novaBoundaryTimer = setTimeout(() => {
      this.novaBoundaryTimer = null;
      if (this.closed || this.novaFinalSegments.length === 0) return;
      const full = this.novaFinalSegments.join(' ').trim();
      this.novaFinalSegments = [];
      this.commitFinal(full);
    }, 1100);
  }
}
