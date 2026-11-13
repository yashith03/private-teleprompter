import { expect, test } from '@playwright/test';
import {
  launchTeleprompterApp,
  startMockAiServer,
  startMockDeepgramServer
} from './helpers';

test.describe('Microphone, Fake WAV Audio Capture & Listening Pipeline', () => {
  test('captures fake .wav audio stream, updates Listening UI, transcribes, auto-submits, and tears down cleanly', async () => {
    const dgMock = await startMockDeepgramServer();
    const aiMock = await startMockAiServer();
    const app = await launchTeleprompterApp({ deepgramWsUrl: dgMock.wsUrl });

    try {
      // Configure AI custom endpoint + Deepgram STT through Settings UI
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(aiMock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();
      await expect(app.page.getByTestId('ai-model-select')).toHaveValue('__auto__');

      await app.page.getByTestId('stt-provider').selectOption('deepgram');
      await expect(app.page.getByTestId('stt-deepgram-notice')).toContainText('Audio is sent to Deepgram');
      await app.page.getByTestId('stt-deepgram-key-input').fill('dg-e2e-audio-key');
      await app.page.getByTestId('stt-deepgram-key-save').click();
      await app.page.getByTestId('settings').click();

      // Switch to AI Q&A tab
      await app.page.getByTestId('tab-qa').click();
      await expect(app.page.getByTestId('qa-deepgram-notice')).toContainText('flux-general-en');
      await expect(app.page.getByTestId('mic-status')).toHaveText('Mic Off');
      await expect(app.page.getByTestId('mic-device')).toBeVisible();

      // Start listening -> fake WAV audio streams through getUserMedia -> AudioContext -> IPC -> Deepgram WS
      await app.page.getByTestId('mic-start').click();
      await expect(app.page.getByTestId('mic-status')).toHaveText('Listening');
      await expect(app.page.getByTestId('mic-stop')).toBeVisible();

      // Verify real PCM audio bytes from sample-speech.wav reached the WebSocket server
      await expect.poll(() => dgMock.binaryBytesReceived()).toBeGreaterThan(0);

      // Simulate Deepgram interim transcript ("Update") followed by final ("EndOfTurn")
      dgMock.sendJsonToLatest({
        type: 'TurnInfo',
        event: 'Update',
        transcript: 'Why did you choose'
      });
      await expect(app.page.getByTestId('qa-live-transcript')).toContainText('Why did you choose');

      dgMock.sendJsonToLatest({
        type: 'TurnInfo',
        event: 'EndOfTurn',
        transcript: 'Why did you choose Vulkan?'
      });

      // Transcribed question is auto-submitted and AI answer renders
      await expect(app.page.getByTestId('qa-msg-user').last()).toContainText('Why did you choose Vulkan?');
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Vulkan control.');
      await expect(app.page.getByTestId('qa-live-transcript')).toHaveCount(0);

      // Stop mic -> clean teardown to Mic Off
      await app.page.getByTestId('mic-stop').click();
      await expect(app.page.getByTestId('mic-status')).toHaveText('Mic Off');
      await expect(app.page.getByTestId('mic-start')).toBeVisible();

      // Start again and verify switching to Script tab automatically stops listening
      await app.page.getByTestId('mic-start').click();
      await expect(app.page.getByTestId('mic-status')).toHaveText('Listening');
      await app.page.getByTestId('tab-script').click();
      await app.page.getByTestId('tab-qa').click();
      await expect(app.page.getByTestId('mic-status')).toHaveText('Mic Off');

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await aiMock.close();
      await dgMock.close();
    }
  });
});
