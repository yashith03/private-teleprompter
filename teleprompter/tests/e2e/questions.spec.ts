import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  launchTeleprompterApp,
  startMockAiServer,
  startMockDeepgramServer
} from './helpers';

test.describe('Adding, Editing, Deleting & Answering Questions', () => {
  test('manages Prepare Q&A pairs, answers via local match (0 calls) and AI stream, and edits/resubmits voice questions', async () => {
    const dgMock = await startMockDeepgramServer();
    const aiMock = await startMockAiServer();
    const app = await launchTeleprompterApp({ deepgramWsUrl: dgMock.wsUrl });

    try {
      // Configure AI custom endpoint + Deepgram Nova-3
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(aiMock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();
      await app.page.getByTestId('stt-provider').selectOption('deepgram');
      await app.page.getByTestId('stt-deepgram-model').selectOption('nova-3');
      await app.page.getByTestId('stt-deepgram-key-input').fill('dg-q-key');
      await app.page.getByTestId('stt-deepgram-key-save').click();
      await app.page.getByTestId('settings').click();

      // Open Prepare Q&A subtab
      await app.page.getByTestId('tab-qa').click();
      await app.page.getByTestId('qa-subtab-prepare').click();
      await expect(app.page.getByTestId('qa-prepare-view')).toBeVisible();

      // Copy current script into slide speech, then add custom slide speech + research notes
      await app.page.getByTestId('qa-copy-script').click();
      await expect(app.page.getByTestId('qa-speech-input')).not.toHaveValue('');
      await app.page.getByTestId('qa-speech-input').fill('Slide 1: Vulkan provides explicit GPU memory control.');
      await app.page.getByTestId('qa-notes-input').fill('Note 1: Frame pacing improved by 22% in benchmarks.');

      // Add two approved Q&A pairs, then remove the second one
      await app.page.getByTestId('qa-pair-q').fill('Why did you choose Vulkan?');
      await app.page.getByTestId('qa-pair-a').fill('Explicit GPU memory control and lower driver overhead.');
      await app.page.getByTestId('qa-pair-ref').fill('Slide 1');
      await app.page.getByTestId('qa-pair-add').click();

      await app.page.getByTestId('qa-pair-q').fill('What is the target frame rate?');
      await app.page.getByTestId('qa-pair-a').fill('120 FPS steady.');
      await app.page.getByTestId('qa-pair-ref').fill('Note 1');
      await app.page.getByTestId('qa-pair-add').click();

      await expect(app.page.getByTestId('qa-pair-item')).toHaveCount(2);
      await app.page
        .getByTestId('qa-pair-item')
        .filter({ hasText: 'What is the target frame rate?' })
        .getByRole('button', { name: 'Remove' })
        .click();
      await expect(app.page.getByTestId('qa-pair-item')).toHaveCount(1);

      // Switch to Ask subtab: approved question uses 0 AI provider calls
      await app.page.getByTestId('qa-subtab-ask').click();
      const reqBeforeApproved = aiMock.requestCount();
      await app.page.getByTestId('qa-input').fill('Why did you choose Vulkan?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText(
        'Explicit GPU memory control and lower driver overhead.'
      );
      expect(aiMock.requestCount()).toBe(reqBeforeApproved);

      // Ask an unmatched grounded question -> streams from AI provider
      await app.page.getByTestId('qa-input').fill('What did benchmarks show for frame pacing?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Answer via gpt-4o-mini');

      // Simulated voice question via Nova-3 -> edit & resubmit misheard question
      await app.page.getByTestId('mic-start').click();
      await expect(app.page.getByTestId('mic-status')).toHaveText('Listening');
      await expect.poll(() => dgMock.binaryBytesReceived()).toBeGreaterThan(0);

      dgMock.sendJsonToLatest({
        type: 'Results',
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: 'Why did you pick Vulcan?' }] }
      });

      await expect(app.page.getByTestId('qa-msg-user').last()).toContainText('Why did you pick Vulcan?');
      await app.page.getByTestId('mic-stop').click();

      // Click Edit & resubmit on the voice question and correct it
      await app.page.getByTestId('qa-edit-question').last().click();
      await expect(app.page.getByTestId('qa-input')).toHaveValue('Why did you pick Vulcan?');
      await app.page.getByTestId('qa-input').fill('Why did you choose Vulkan?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText(
        'Explicit GPU memory control and lower driver overhead.'
      );

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await aiMock.close();
      await dgMock.close();
    }
  });

  test('retrieves Slides 13-14 for ModelSense-RIFT methodology queries and handles 503 with manual retry & reasoning filter', async () => {
    const aiMock = await startMockAiServer();
    const app = await launchTeleprompterApp();

    try {
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(aiMock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();
      await app.page.getByTestId('privacy-badge').click();

      const slideSpeech = [
        'Slide 01: Introduction',
        'ModelSense-RIFT overview.',
        'Slide 04: Pilot test on prompt and output speed',
        'Initial pilot findings.',
        'Slide 05   Pilot test on response time',
        'Response time details.',
        'Slide 13   Experimental setup',
        'Controlled tests on Windows 11 with fixed quantisation and llama.cpp.',
        'Slide 14   How I will evaluate RIFT',
        'Repeated paired comparisons for RQ1, RQ2, and RQ3.'
      ].join('\n');

      // Single-newline researchNotes (0 blank lines, > 900 chars before Slide 13)
      const padding = 'Introductory delivery notes for ModelSense-RIFT presentation. '.repeat(20);
      const researchNotes = [
        'ModelSense-RIFT | Creative Presentation Speech',
        padding,
        'Slide 13 | Research Methodology and Experimental Design',
        'The research methodology is controlled quantitative experimentation on a Windows 11 laptop.',
        'Slide 14 | Comparative Evaluation: Research Questions to Metrics',
        'Each research question has a corresponding experiment and method comparison.'
      ].join('\n');

      await app.page.evaluate(
        async ({ speech, notes }) => {
          await window.teleprompter.updateQaKnowledge({
            slideSpeech: speech,
            researchNotes: notes,
            approvedPairs: []
          });
        },
        { speech: slideSpeech, notes: researchNotes }
      );

      await app.page.getByTestId('tab-qa').click();
      await expect(app.page.getByTestId('qa-input')).toBeVisible();

      for (const q of ['What is my methodology?', 'whts my methodology']) {
        await app.page.getByTestId('qa-input').fill(q);
        await app.page.getByTestId('qa-send').click();
        const lastMeta = app.page.getByTestId('qa-msg-meta').last();
        await expect(lastMeta).toContainText('Note 3');
        await expect(lastMeta).toContainText('Note 4');
        await expect(lastMeta).not.toContainText('Note 1');
        await expect(lastMeta).toContainText('Cloud · First ');
      }

      // 503 temporary unavailability -> manual Retry & Switch model without silent failover
      aiMock.setMode('unavailable_503');
      const callsBefore503 = aiMock.requestCount();
      await app.page.getByTestId('qa-input').fill('What is my methodology?');
      await app.page.getByTestId('qa-send').click();

      const errMsg = app.page.getByTestId('qa-msg-assistant').last();
      await expect(errMsg).toContainText('Temporarily unavailable');
      await expect(app.page.getByTestId('qa-retry-btn')).toBeVisible();
      await expect(app.page.getByTestId('qa-switch-model-btn')).toBeVisible();
      expect(aiMock.requestCount()).toBe(callsBefore503 + 1);

      // Manual Retry after provider recovers with <think> reasoning chunks
      aiMock.setMode('reasoning_then_answer');
      await app.page.getByTestId('qa-retry-btn').click();
      const recoveredMsg = app.page.getByTestId('qa-msg-assistant').last();
      await expect(recoveredMsg).toContainText('Controlled quantitative experiments.');
      await expect(recoveredMsg).not.toContainText('Hidden reasoning step');
      await expect(recoveredMsg.getByTestId('qa-msg-timings')).toContainText('Cloud · First ');

      // Reasoning-only chunks & empty replies must fail cleanly (not show blank success), and Test Connection must reject empty content
      aiMock.setMode('reasoning_only');
      await app.page.getByTestId('qa-input').fill('What is my methodology?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('no visible answer text');

      aiMock.setMode('empty_reply');
      await app.page.getByTestId('qa-input').fill('What is my methodology?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('no visible answer text');

      await app.page.getByTestId('qa-open-settings').click();
      await app.page.getByTestId('ai-test-connection').click();
      await expect(app.page.getByTestId('ai-test-status')).toContainText('empty visible reply');
      await app.page.getByTestId('privacy-badge').click();

      // Stop button cancels an active slow stream cleanly
      aiMock.setMode('slow_stream');
      await app.page.getByTestId('qa-input').fill('What is my methodology?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-status')).toHaveText('Streaming...');
      await app.page.getByTestId('qa-stop').click();
      await expect(app.page.getByTestId('qa-status')).toHaveText('Ready');
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('(Stopped)');

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await aiMock.close();
    }
  });

  test('Answer Instructions: defaults, custom edit, reset, restart/provider persistence, typed & transcribed prompts, and 0-call approved/no-evidence', async () => {
    const dgMock = await startMockDeepgramServer();
    const aiMock = await startMockAiServer();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-e2e-inst-'));
    let app = await launchTeleprompterApp({ existingUserDataDir: userDataDir, deepgramWsUrl: dgMock.wsUrl });

    try {
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(aiMock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();
      await app.page.getByTestId('stt-provider').selectOption('deepgram');
      await app.page.getByTestId('stt-deepgram-model').selectOption('nova-3');
      await app.page.getByTestId('stt-deepgram-key-input').fill('dg-inst-key');
      await app.page.getByTestId('stt-deepgram-key-save').click();
      await app.page.getByTestId('privacy-badge').click();

      await app.page.getByTestId('tab-qa').click();
      await app.page.getByTestId('qa-subtab-prepare').click();

      const instInput = app.page.getByTestId('qa-instructions-input');
      const resetBtn = app.page.getByTestId('qa-instructions-reset');

      // 1. Default instructions present and Reset disabled
      await expect(instInput).toHaveValue(/1-3 short sentences/);
      await expect(instInput).toHaveValue(/main point first/);
      await expect(resetBtn).toBeDisabled();

      // 2. Custom instructions + slide speech + approved pair
      const customInst = 'Use 2 bullet points max. Lead with the exact metric.';
      await instInput.fill(customInst);
      await expect(resetBtn).toBeEnabled();

      await app.page.getByTestId('qa-speech-input').fill('Slide 1: Vulkan reduces frame pacing variance by 22%.');
      await app.page.getByTestId('qa-pair-q').fill('Why did you choose Vulkan?');
      await app.page.getByTestId('qa-pair-a').fill('Explicit GPU memory control.');
      await app.page.getByTestId('qa-pair-add').click();

      // 3. Retained across provider switch
      await app.page.getByTestId('qa-open-settings').click();
      await app.page.getByTestId('ai-provider').selectOption('groq');
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('privacy-badge').click();
      await expect(instInput).toHaveValue(customInst);

      // 4. Retained across app restart
      await app.close();
      app = await launchTeleprompterApp({ existingUserDataDir: userDataDir, deepgramWsUrl: dgMock.wsUrl });

      await app.page.getByTestId('tab-qa').click();
      await app.page.getByTestId('qa-subtab-prepare').click();
      await expect(app.page.getByTestId('qa-instructions-input')).toHaveValue(customInst);

      // 5. Switch to Ask: approved match makes 0 calls; no-evidence makes 0 calls; typed & transcribed send custom instructions
      await app.page.getByTestId('qa-subtab-ask').click();
      const calls0 = aiMock.requestCount();

      await app.page.getByTestId('qa-input').fill('Why did you choose Vulkan?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Explicit GPU memory control.');
      expect(aiMock.requestCount()).toBe(calls0);

      await app.page.getByTestId('qa-input').fill('What is the weather on Mars?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-meta').last()).toContainText('No matching evidence');
      expect(aiMock.requestCount()).toBe(calls0);

      // Typed grounded question -> includes custom instructions
      await app.page.getByTestId('qa-input').fill('What does Slide 1 say about frame pacing?');
      await app.page.getByTestId('qa-send').click();
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Vulkan control.');
      expect(aiMock.requestCount()).toBe(calls0 + 1);
      expect(aiMock.lastSystemPrompt()).toContain(customInst);

      // Reset to default -> transcribed question uses default instructions
      await app.page.getByTestId('qa-subtab-prepare').click();
      await app.page.getByTestId('qa-instructions-reset').click();
      await expect(app.page.getByTestId('qa-instructions-input')).toHaveValue(/1-3 short sentences/);
      await app.page.getByTestId('qa-subtab-ask').click();

      await app.page.getByTestId('mic-start').click();
      await expect(app.page.getByTestId('mic-status')).toHaveText('Listening');
      await expect.poll(() => dgMock.binaryBytesReceived()).toBeGreaterThan(0);
      dgMock.sendJsonToLatest({
        type: 'Results',
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: 'How much does Vulkan reduce frame pacing variance?' }] }
      });
      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Vulkan control.');
      await app.page.getByTestId('mic-stop').click();
      expect(aiMock.requestCount()).toBe(calls0 + 2);
      expect(aiMock.lastSystemPrompt()).toContain('1-3 short sentences');

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await aiMock.close();
      await dgMock.close();
    }
  });

  test('fuzzy typo matching retrieves methodology slides and approved pairs for "whats my methologolgy"', async () => {
    const aiMock = await startMockAiServer();
    const app = await launchTeleprompterApp();

    try {
      await app.page.getByTestId('settings').click();
      await app.page.getByTestId('ai-provider').selectOption('custom');
      await app.page.getByTestId('ai-custom-url').fill(aiMock.baseUrl);
      await app.page.getByTestId('ai-list-models').click();
      await app.page.getByTestId('privacy-badge').click();

      await app.page.getByTestId('tab-qa').click();
      await app.page.evaluate(async () => {
        await window.teleprompter.updateQaKnowledge({
          slideSpeech: 'Slide 12   Introduction\nOverview of problem.\nSlide 13   Methodology\nStratified cross-validation across three cohorts.'
        });
      });

      const callsBefore = aiMock.requestCount();
      await app.page.getByTestId('qa-input').fill('whats my methologolgy');
      await app.page.getByTestId('qa-send').click();

      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Vulkan control.');
      await expect(app.page.getByTestId('qa-msg-meta').last()).toContainText('Sources: Slide 13');
      expect(aiMock.requestCount()).toBe(callsBefore + 1);

      // Also verify fuzzy matching against an approved Q&A pair (0 API calls)
      await app.page.getByTestId('qa-subtab-prepare').click();
      await app.page.getByTestId('qa-pair-q').fill('What is my methodology?');
      await app.page.getByTestId('qa-pair-a').fill('Three-cohort stratified cross-validation.');
      await app.page.getByTestId('qa-pair-add').click();

      await app.page.getByTestId('qa-subtab-ask').click();
      const callsBeforeApproved = aiMock.requestCount();
      await app.page.getByTestId('qa-input').fill('whats my methologolgy');
      await app.page.getByTestId('qa-send').click();

      await expect(app.page.getByTestId('qa-msg-assistant').last()).toContainText('Three-cohort stratified cross-validation.');
      await expect(app.page.getByTestId('qa-msg-meta').last()).toContainText('Approved Q&A (local · no API call)');
      expect(aiMock.requestCount()).toBe(callsBeforeApproved);

      expect(app.consoleErrors).toEqual([]);
      expect(app.pageErrors).toEqual([]);
    } finally {
      await app.close();
      await aiMock.close();
    }
  });
});
