import { expect, test } from '@playwright/test';
import { launchTeleprompterApp, startMockAiServer } from './helpers';

test.describe('Model Switching & Live Discovery', () => {
  test('switches across every discovered model, updates UI and request payloads, and switches mid-session', async () => {
    const mock = await startMockAiServer();
    const app = await launchTeleprompterApp();
    try {
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(mock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();

      const modelSelect = app.page.getByTestId('ai-model-select');
      await expect(modelSelect).toHaveValue('__auto__');
      await expect(modelSelect.locator('option').first()).toHaveAttribute('value', '__auto__');

      // Verify excluded non-chat model is filtered out, while chat & unknown models are selectable
      const optionValues = await modelSelect
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
      expect(optionValues).not.toContain('whisper-large-v3');
      expect(optionValues).toContain('llama-3.1-8b-instant');
      expect(optionValues).toContain('llama-3.3-70b-versatile');
      expect(optionValues).toContain('gpt-4o-mini');
      expect(optionValues).toContain('custom-internal-v1');

      // Switch across multiple models and verify Test Connection sends the selected model in payload
      for (const modelId of ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gpt-4o-mini']) {
        await modelSelect.selectOption(modelId);
        await expect(modelSelect).toHaveValue(modelId);
        await app.page.getByTestId('ai-test-connection').click();
        await expect(app.page.getByTestId('ai-test-status')).toContainText('Connected');
        expect(mock.lastChatModel()).toBe(modelId);
      }

      // Close settings, go to AI Q&A, verify active model label, then switch model mid-session
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('tab-qa').click();
      await expect(app.page.getByTestId('qa-model-label')).toContainText('gpt-4o-mini');

      // Ask question 1 with gpt-4o-mini
      await app.page.getByTestId('qa-input').fill('First question');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Answer via gpt-4o-mini');

      // Switch mid-session to Auto · Fast recommended and ask question 2
      await app.page.getByTestId('qa-open-settings').click();
      await app.page.getByTestId('ai-model-select').selectOption('__auto__');
      await app.page.getByTestId('privacy-badge').click();
      await expect(app.page.getByTestId('settings-popover')).toBeHidden();
      await expect(app.page.getByTestId('qa-model-label')).toContainText('Auto · ');

      await app.page.getByTestId('qa-input').fill('Second question');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Slide 1 explains Vulkan control.');
      const usedAutoModel = mock.lastChatModel();
      expect(['gpt-4o-mini', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'custom-internal-v1']).toContain(
        usedAutoModel
      );
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText(`Answer via ${usedAutoModel}`);

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await mock.close();
    }
  });
});
