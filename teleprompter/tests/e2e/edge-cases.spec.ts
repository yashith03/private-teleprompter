import { expect, test } from '@playwright/test';
import { launchTeleprompterApp, startMockAiServer } from './helpers';

test.describe('Edge Cases & Resiliency', () => {
  test('handles empty inputs, rapid provider/model switching, retired models, network errors, and window resize/minimize', async () => {
    const mock = await startMockAiServer();
    const app = await launchTeleprompterApp();

    try {
      // 1. Empty Q&A input keeps Send disabled
      await app.page.getByTestId('tab-qa').click();
      await expect(app.page.getByTestId('qa-send')).toBeDisabled();
      await app.page.getByTestId('qa-input').fill('   ');
      await expect(app.page.getByTestId('qa-send')).toBeDisabled();

      // 2. Rapid provider switching does not leak stale state
      await app.page.getByTestId('qa-open-settings').click();
      const providerSel = app.page.getByTestId('ai-provider');
      await providerSel.selectOption('groq');
      await providerSel.selectOption('nvidia');
      await providerSel.selectOption('gemini');
      await providerSel.selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(mock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();
      await expect(app.page.getByTestId('ai-model-select')).toHaveValue('__auto__');

      // 3. Retired saved model is flagged and replaceable
      await app.page.getByTestId('ai-model-select').selectOption('__manual__');
      await app.page.getByTestId('ai-model-input').fill('retired-model-xyz');
      await app.page.getByTestId('ai-list-models').click();
      await expect(app.page.getByTestId('ai-model-retired')).toBeVisible();
      await app.page.getByTestId('ai-model-replace-btn').click();
      await expect(app.page.getByTestId('ai-model-retired')).toHaveCount(0);

      // 4. Rate limit (429), 404 non-discovery endpoint, and offline endpoint handling
      mock.setMode('rate_limit');
      await app.page.getByTestId('ai-test-connection').click();
      await expect(app.page.getByTestId('ai-test-status')).toContainText('429');

      mock.setMode('no_models_404');
      await app.page.getByTestId('ai-list-models').click();
      await expect(app.page.getByTestId('ai-discovery-note')).toContainText('does not support /models discovery');

      const offlineRes = await app.page.evaluate(async () => {
        await window.teleprompter.updateAiConfig({
          provider: 'custom',
          customBaseUrl: 'http://127.0.0.1:1/v1',
          modelMode: 'manual',
          model: 'llama-3.1-8b-instant'
        });
        return window.teleprompter.testAiConnection();
      });
      expect(offlineRes.ok).toBe(false);
      expect(offlineRes.errorKind).toBe('offline');

      // 5. settings:update cannot spoof privateNotes
      const spoofed = await app.page.evaluate(() =>
        window.teleprompter.updateSettings({ privateNotes: false } as Partial<Record<string, unknown>>)
      );
      expect(spoofed.privateNotes).toBe(true);

      // 6. Window resize to minimum 420x260 and minimize/restore
      await app.page.getByTestId('privacy-badge').click();
      await expect(app.page.getByTestId('settings-popover')).toBeHidden();
      await app.page.evaluate(() => window.teleprompter.resizeTo(420, 260));
      await expect
        .poll(() =>
          app.electronApp.evaluate(({ BrowserWindow }) => {
            const b = BrowserWindow.getAllWindows()[0].getBounds();
            return { w: b.width, h: b.height };
          })
        )
        .toEqual({ w: 420, h: 260 });

      await app.page.getByTestId('minimize').click();
      await expect
        .poll(() =>
          app.electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isMinimized()
          )
        )
        .toBe(true);
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].restore();
      });

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await mock.close();
    }
  });
});
