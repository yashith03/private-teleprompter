import { expect, test } from '@playwright/test';
import { launchTeleprompterApp } from './helpers';

test.describe('Startup & Layout', () => {
  test('verifies window launch, dimensions, active IPC bridges, and zero runtime errors', async () => {
    const app = await launchTeleprompterApp();
    try {
      const info = await app.electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return {
          windowCount: BrowserWindow.getAllWindows().length,
          title: win.getTitle(),
          bounds: win.getBounds(),
          minSize: win.getMinimumSize(),
          alwaysOnTop: win.isAlwaysOnTop(),
          visible: win.isVisible()
        };
      });

      expect(info.windowCount).toBe(1);
      expect(info.title).toBe('Notch-Copy');
      expect(Math.abs(info.bounds.width - 680)).toBeLessThanOrEqual(5);
      expect(Math.abs(info.bounds.height - 340)).toBeLessThanOrEqual(5);
      expect(info.minSize).toEqual([420, 260]);
      expect(info.alwaysOnTop).toBe(true);
      expect(info.visible).toBe(true);

      // Verify active IPC bridge surface on window.teleprompter
      const bridgeMethods = await app.page.evaluate(() => {
        const api = window.teleprompter as unknown as Record<string, unknown>;
        return [
          'getSettings',
          'updateSettings',
          'setPrivateNotes',
          'getAiConfig',
          'updateAiConfig',
          'listAiModels',
          'testAiConnection',
          'sendAiMessage',
          'getQaKnowledge',
          'getSttConfig',
          'getSttStatus',
          'startSttStream'
        ].every((k) => typeof api[k] === 'function');
      });
      expect(bridgeMethods).toBe(true);

      await expect(app.page.getByTestId('tab-script')).toBeVisible();
      await expect(app.page.getByTestId('tab-qa')).toBeVisible();
      await expect(app.page.getByTestId('privacy-badge')).toHaveText('Private notes: ON');
      await expect(app.page.getByTestId('reader')).toBeVisible();

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
