import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import os from 'node:os';
import path from 'node:path';

export const WAV_FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sample-speech.wav');

export interface LaunchedApp {
  electronApp: ElectronApplication;
  page: Page;
  userDataDir: string;
  consoleErrors: string[];
  pageErrors: string[];
  close: () => Promise<void>;
}

export interface LaunchOptions {
  existingUserDataDir?: string;
  deepgramWsUrl?: string;
}

/**
 * Launches the compiled Electron app with Chromium fake audio capture flags,
 * auto-granted microphone/media permissions, and an isolated `userData` directory.
 */
export async function launchTeleprompterApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir =
    opts.existingUserDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tp-e2e-'));
  const ownsDir = !opts.existingUserDataDir;
  const appRoot = path.resolve(__dirname, '../..');

  const env: Record<string, string | undefined> = {
    ...process.env,
    TELEPROMPTER_E2E_USER_DATA: userDataDir
  };
  if (opts.deepgramWsUrl) {
    env.TELEPROMPTER_E2E_DEEPGRAM_URL = opts.deepgramWsUrl;
  }

  const electronApp = await electron.launch({
    args: [
      appRoot,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV_FIXTURE_PATH}`
    ],
    env
  });

  // Grant microphone/media permissions in Electron's default session.
  await electronApp.evaluate(({ session }) => {
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'media' || permission === 'audioCapture';
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'audioCapture');
    });
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('tab-script').waitFor({ state: 'visible' });

  try {
    await page.context().grantPermissions(['microphone']);
  } catch {
    /* Electron context may rely on session permission handlers above */
  }

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  const close = async () => {
    await electronApp.close();
    if (ownsDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup race on Windows */
      }
    }
  };

  return { electronApp, page, userDataDir, consoleErrors, pageErrors, close };
}

export type MockAiMode =
  | 'ok'
  | 'invalid_key'
  | 'rate_limit'
  | 'unavailable_503'
  | 'unavailable_model'
  | 'no_models_404'
  | 'slow_stream'
  | 'reasoning_then_answer'
  | 'reasoning_only'
  | 'empty_reply';

export interface MockAiServer {
  baseUrl: string;
  requestCount: () => number;
  lastChatModel: () => string | null;
  lastSystemPrompt: () => string | null;
  chatModelsSeen: () => string[];
  setMode: (mode: MockAiMode) => void;
  setModels: (models: Array<Record<string, unknown>>) => void;
  close: () => Promise<void>;
}

/**
 * Loopback OpenAI-compatible mock HTTP server that tracks `/models` and `/chat/completions`
 * payloads (including the exact `model` requested).
 */
export async function startMockAiServer(): Promise<MockAiServer> {
  let mode: MockAiMode = 'ok';
  let models: Array<Record<string, unknown>> = [
    { id: 'llama-3.1-8b-instant', capabilities: { chat: true } },
    { id: 'llama-3.3-70b-versatile', capabilities: { chat: true } },
    { id: 'gpt-4o-mini', capabilities: { chat: true } },
    { id: 'whisper-large-v3' },
    { id: 'custom-internal-v1' }
  ];
  let count = 0;
  const modelsSeen: string[] = [];
  let lastSysPrompt: string | null = null;

  const server = http.createServer((req, res) => {
    count += 1;
    if (req.url === '/v1/models') {
      if (mode === 'no_models_404') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Not found' } }));
        return;
      }
      if (mode === 'invalid_key') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: models }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      let rawBody = '';
      req.on('data', (chunk) => { rawBody += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(rawBody || '{}') as {
          model?: string;
          stream?: boolean;
          messages?: Array<{ role: string; content: string }>;
        };
        if (parsed.model) modelsSeen.push(parsed.model);
        const sysMsg = parsed.messages?.find((m) => m.role === 'system');
        if (sysMsg) lastSysPrompt = sysMsg.content;

        if (mode === 'invalid_key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Unauthorized key' } }));
          return;
        }
        if (mode === 'rate_limit') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
          return;
        }
        if (mode === 'unavailable_503') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Service temporarily unavailable' } }));
          return;
        }
        if (mode === 'unavailable_model') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Model not found' } }));
          return;
        }

        if (!parsed.stream) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (mode === 'empty_reply' || mode === 'reasoning_only') {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: { role: 'assistant', content: null, reasoning_content: 'We need respond OK' },
                    finish_reason: 'length'
                  }
                ]
              })
            );
          } else {
            res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
          }
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache'
        });
        if (mode === 'empty_reply') {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' } }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (mode === 'reasoning_only') {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Internal reasoning step 1. ' } }] })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: '<think>More thinking</think>' } }] })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        const chunks =
          mode === 'reasoning_then_answer'
            ? [
                '<think>Hidden reasoning step ',
                'that must not appear.</think>',
                `Answer via ${parsed.model ?? 'unknown'}: `,
                'Controlled quantitative experiments.'
              ]
            : [`Answer via ${parsed.model ?? 'unknown'}: `, 'Slide 1 explains ', 'Vulkan control.'];
        const intervalMs = mode === 'slow_stream' || mode === 'reasoning_then_answer' ? 60 : 12;
        let idx = 0;
        const timer = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(timer);
            return;
          }
          if (idx < chunks.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[idx] } }] })}\n\n`);
            idx += 1;
          } else {
            res.write('data: [DONE]\n\n');
            res.end();
            clearInterval(timer);
          }
        }, intervalMs);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requestCount: () => count,
    lastChatModel: () => modelsSeen[modelsSeen.length - 1] ?? null,
    lastSystemPrompt: () => lastSysPrompt,
    chatModelsSeen: () => [...modelsSeen],
    setMode: (next) => { mode = next; },
    setModels: (next) => { models = next; },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}

export interface MockDeepgramServer {
  wsUrl: string;
  binaryBytesReceived: () => number;
  connectionUrls: () => string[];
  setReject401: (reject: boolean) => void;
  sendJsonToLatest: (obj: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

/**
 * Lightweight RFC6455 WebSocket mock server for Deepgram Flux & Nova-3 streaming tests.
 * Counts real binary PCM frames received from Chromium's fake `.wav` audio stream.
 */
export async function startMockDeepgramServer(): Promise<MockDeepgramServer> {
  const sockets: Duplex[] = [];
  const urls: string[] = [];
  let reject401 = false;
  let binaryBytes = 0;

  const sendWsText = (sock: Duplex, text: string) => {
    if (sock.destroyed) return;
    const payload = Buffer.from(text, 'utf8');
    const hdr =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    sock.write(Buffer.concat([hdr, payload]));
  };

  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, sock) => {
    urls.push(req.url ?? '');
    if (reject401) {
      sock.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      sock.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    sock.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.push(sock);

    let buf = Buffer.alloc(0);
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const maskOff = off;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) {
          const mask = buf.subarray(maskOff, maskOff + 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        buf = buf.subarray(off + len);
        if (opcode === 0x02) {
          binaryBytes += payload.length;
        } else if (opcode === 0x08) {
          sock.end();
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    binaryBytesReceived: () => binaryBytes,
    connectionUrls: () => [...urls],
    setReject401: (r) => { reject401 = r; },
    sendJsonToLatest: (obj) => {
      const latest = sockets[sockets.length - 1];
      if (latest) sendWsText(latest, JSON.stringify(obj));
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) {
          try { s.destroy(); } catch { /* ignore */ }
        }
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}
