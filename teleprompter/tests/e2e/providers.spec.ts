import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchTeleprompterApp, startMockAiServer } from './helpers';

test.describe('Providers & API Configuration', () => {
  test('switches between all AI and STT providers, saves mock keys, persists across relaunch, and handles invalid keys', async () => {
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-e2e-prov-'));
    const mock = await startMockAiServer();

    const app1 = await launchTeleprompterApp({ existingUserDataDir: sharedDir });
    try {
      await app1.page.getByTestId('settings').click();
      await expect(app1.page.getByTestId('settings-popover')).toBeVisible();

      // Switch through every AI provider: gemini, groq, nvidia, custom
      const aiProvider = app1.page.getByTestId('ai-provider');
      for (const id of ['gemini', 'groq', 'nvidia', 'custom'] as const) {
        await aiProvider.selectOption(id);
        await expect(aiProvider).toHaveValue(id);
      }

      // Custom endpoint URL + mock API key save & persistence check
      await app1.page.getByTestId('ai-custom-url').fill(mock.baseUrl);
      await app1.page.getByTestId('ai-key-input').fill('sk-mock-custom-key');
      await app1.page.getByTestId('ai-key-save').click();
      await expect(app1.page.getByTestId('ai-test-status')).toContainText('API key');

      // Verify key is never leaked via getAiConfig()
      const publicCfg = await app1.page.evaluate(() => window.teleprompter.getAiConfig());
      expect(publicCfg.provider).toBe('custom');
      expect(publicCfg.hasKey.custom).toBe(true);
      expect(JSON.stringify(publicCfg)).not.toContain('sk-mock-custom-key');

      // Invalid key (401) handling on Test Connection
      mock.setMode('invalid_key');
      await app1.page.getByTestId('ai-test-connection').click();
      await expect(app1.page.getByTestId('ai-test-status')).toContainText('401');
      mock.setMode('ok');

      // Switch STT provider: whisper -> deepgram (verify disclosure + Deepgram key save) -> whisper
      const sttProvider = app1.page.getByTestId('stt-provider');
      await expect(sttProvider).toHaveValue('whisper');
      await sttProvider.selectOption('deepgram');
      await expect(app1.page.getByTestId('stt-deepgram-notice')).toContainText('Audio is sent to Deepgram');
      await app1.page.getByTestId('stt-deepgram-key-input').fill('dg-mock-key-123');
      await app1.page.getByTestId('stt-deepgram-key-save').click();

      const sttCfg = await app1.page.evaluate(() => window.teleprompter.getSttConfig());
      expect(sttCfg.provider).toBe('deepgram');
      expect(sttCfg.hasDeepgramKey).toBe(true);
      expect(JSON.stringify(sttCfg)).not.toContain('dg-mock-key-123');

      await app1.page.waitForTimeout(300);
    } finally {
      await app1.close();
    }

    // Relaunch with same userData and verify provider + endpoint + key status persisted
    const app2 = await launchTeleprompterApp({ existingUserDataDir: sharedDir });
    try {
      await app2.page.getByTestId('settings').click();
      await expect(app2.page.getByTestId('ai-provider')).toHaveValue('custom');
      await expect(app2.page.getByTestId('ai-custom-url')).toHaveValue(mock.baseUrl);
      await expect(app2.page.getByTestId('stt-provider')).toHaveValue('deepgram');

      const cfg2 = await app2.page.evaluate(() => window.teleprompter.getAiConfig());
      expect(cfg2.hasKey.custom).toBe(true);

      expect(app2.consoleErrors).toEqual([]);
      expect(app2.pageErrors).toEqual([]);
    } finally {
      await app2.close();
      await mock.close();
      try { fs.rmSync(sharedDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
