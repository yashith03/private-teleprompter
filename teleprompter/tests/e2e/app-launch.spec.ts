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

  test('manual practice stopwatch works independently and fits at min width in both themes', async () => {
    const app = await launchTeleprompterApp();
    try {
      const toggleBtn = app.page.getByTestId('timer-toggle');
      const display = app.page.getByTestId('timer-display');
      const resetBtn = app.page.getByTestId('timer-reset');
      const minBtn = app.page.getByTestId('minimize');
      const closeBtn = app.page.getByTestId('close');

      // Initial state: 00:00:00, Start Timer, Reset disabled, exact horizontal order
      await expect(display).toHaveText('00:00:00');
      await expect(toggleBtn).toHaveAttribute('aria-label', 'Start Timer');
      await expect(resetBtn).toBeDisabled();

      const boxes = await Promise.all([
        toggleBtn.boundingBox(),
        display.boundingBox(),
        resetBtn.boundingBox(),
        minBtn.boundingBox(),
        closeBtn.boundingBox()
      ]);
      for (const b of boxes) expect(b).not.toBeNull();
      const [bToggle, bDisplay, bReset, bMin, bClose] = boxes as NonNullable<(typeof boxes)[number]>[];
      expect(bToggle.x + bToggle.width).toBeLessThanOrEqual(bDisplay.x + 1);
      expect(bDisplay.x + bDisplay.width).toBeLessThanOrEqual(bReset.x + 1);
      expect(bReset.x + bReset.width).toBeLessThanOrEqual(bMin.x + 1);
      expect(bMin.x + bMin.width).toBeLessThanOrEqual(bClose.x + 1);

      // Script actions (including Ctrl+Space, Enter, plain Space) before starting timer must NOT start the stopwatch
      await app.page.getByTestId('toggle').click();
      await app.page.waitForTimeout(300);
      await app.page.keyboard.press('Control+Space');
      await app.page.keyboard.press('Enter');
      await app.page.keyboard.press('Space');
      await expect(display).toHaveText('00:00:00');

      // Start Timer -> Pause Timer -> Resume Timer
      await toggleBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-label', 'Pause Timer');
      await expect(resetBtn).toBeEnabled();
      await expect(display).not.toHaveText('00:00:00', { timeout: 3000 });

      // Script scroll, Ctrl+Space shortcut, slide jump, and tab switch must not stop or reset timer
      await app.page.getByTestId('toggle').click();
      await app.page.keyboard.press('Control+Space');
      const slideSeg1 = app.page.getByTestId('slide-seg-1');
      if (await slideSeg1.isVisible()) {
        await slideSeg1.click();
      }
      await app.page.getByTestId('tab-qa').click();
      await expect(app.page.getByTestId('qa-panel-wrap')).toBeVisible();
      await expect(toggleBtn).toHaveAttribute('aria-label', 'Pause Timer');
      await app.page.getByTestId('tab-script').click();

      // Pause freezes time and switches label to Resume Timer
      await toggleBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-label', 'Resume Timer');
      const pausedText = await display.textContent();
      await app.page.waitForTimeout(1200);
      await expect(display).toHaveText(pausedText ?? '');

      // Resume continues from paused value
      await toggleBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-label', 'Pause Timer');
      await expect(display).not.toHaveText(pausedText ?? '', { timeout: 3000 });

      // Reset stops timer and returns to 00:00:00
      await resetBtn.click();
      await expect(display).toHaveText('00:00:00');
      await expect(toggleBtn).toHaveAttribute('aria-label', 'Start Timer');
      await expect(resetBtn).toBeDisabled();

      // Check layout at minimum supported width (420x260) in both Dark and Light themes
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(420, 260);
      });
      await app.page.setViewportSize({ width: 420, height: 260 });

      const assertMinWidthFit = async (expectedTheme: 'light' | 'dark') => {
        await expect(app.page.locator('.card')).toHaveAttribute('data-theme', expectedTheme);
        const layout = await app.page.evaluate(() => {
          const bar = document.querySelector('.bar');
          const ids = ['privacy-badge-container', 'tab-qa', 'timer-toggle', 'timer-display', 'timer-reset', 'minimize', 'close'];
          const rects = ids.map((id) => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            const r = el?.getBoundingClientRect();
            return { id, left: r?.left ?? -1, right: r?.right ?? -1, top: r?.top ?? -1, bottom: r?.bottom ?? -1 };
          });
          return {
            clientWidth: document.documentElement.clientWidth,
            barScrollWidth: bar?.scrollWidth ?? 0,
            barClientWidth: bar?.clientWidth ?? 0,
            rects
          };
        });
        expect(layout.barScrollWidth).toBeLessThanOrEqual(layout.barClientWidth + 1);
        for (const r of layout.rects) {
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.right).toBeLessThanOrEqual(420 + 1);
          expect(r.bottom).toBeLessThanOrEqual(60);
        }
      };

      // Default theme is light; verify Light then toggle to Dark
      await assertMinWidthFit('light');
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('theme-toggle').click();
      await app.page.getByTestId('settings').click();
      await assertMinWidthFit('dark');

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
