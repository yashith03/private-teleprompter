import { app, BrowserWindow, clipboard, globalShortcut } from 'electron';
import type { SettingsStore } from './settingsStore';
import { computeSlideProgress, parseSlides } from '../shared/slides';
import type { ShortcutAction, ShortcutBindingStatus } from '../shared/types';

interface Ctx {
  store: SettingsStore;
  getWindow: () => BrowserWindow;
  reopen: () => BrowserWindow;
  registerGlobalShortcuts: (
    registerFn?: (accelerator: string, callback: () => void) => boolean
  ) => ShortcutBindingStatus[];
  dispatchShortcutAction: (action: ShortcutAction) => void;
  eventLog: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
let failed = false;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed = true;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

async function loaded(win: BrowserWindow): Promise<void> {
  if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
  await sleep(400);
}
const js = <T>(win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
const click = (win: BrowserWindow, id: string) =>
  js(win, `document.querySelector('[data-testid="${id}"]').click()`);
const scrollTop = (win: BrowserWindow) =>
  js<number>(win, `document.querySelector('[data-testid="reader"]').scrollTop`);

export async function runSelfTest(ctx: Ctx): Promise<void> {
  try {
    let win = ctx.getWindow();
    await loaded(win);

    const longScript = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of the self-test script.`).join('\n\n');
    await js(win, `window.teleprompter.updateSettings({ script: ${JSON.stringify(longScript)}, speed: 200, fontSize: 44, opacity: 0.8 })`);
    await js(win, `window.teleprompter.setPrivateNotes(false)`);
    await js(win, `window.teleprompter.setPrivateNotes(true)`);
    ctx.store.flush();

    // Reopen: a brand new window must restore settings and protect before show.
    ctx.eventLog.length = 0;
    win = ctx.reopen();
    await loaded(win);
    const log = ctx.eventLog.join(',');
    check('reopen: protection applied before show', log.indexOf('protect:true') !== -1 && log.indexOf('protect:true') < log.indexOf('show'), log);

    const restored = await js<{ fs: string; speed: string; badge: string; opacity: number }>(win, `({
      fs: getComputedStyle(document.querySelector('[data-testid="reader"]')).fontSize,
      speed: document.querySelector('[data-testid="speed"]').value,
      badge: document.querySelector('[data-testid="privacy-badge"]').textContent,
      opacity: parseFloat(document.querySelector('.card').style.getPropertyValue('--panel-alpha'))
    })`);
    check('settings restore: font size', restored.fs === '44px', restored.fs);
    check('settings restore: speed', restored.speed === '200', restored.speed);
    check('settings restore: private notes badge ON', /ON/.test(restored.badge), restored.badge);
    check('settings restore: panel opacity (CSS only)', Math.abs(restored.opacity - 0.8) < 0.001, String(restored.opacity));
    check('window opacity untouched (text stays legible)', Math.abs(win.getOpacity() - 1) < 0.001, String(win.getOpacity()));

    // Visual polish: white card, 20px corners, navy script text, pure blue line icons, and opaque text at low alpha.
    await click(win, 'settings');
    await sleep(100);
    await js(win, `(() => {
      const inp = document.querySelector('[data-testid="opacity"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '0.35');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(120);
    const visual = await js<{
      bg: string;
      radius: string;
      textColor: string;
      textOpacity: string;
      svgs: Array<{ fill: string; stroke: string; childFills: string[]; color: string }>;
    }>(win, `(() => {
      const card = document.querySelector('.card');
      const reader = document.querySelector('[data-testid="reader"]');
      const svgs = [...document.querySelectorAll('.bar svg, .toolbar svg')].map((svg) => ({
        fill: svg.getAttribute('fill') || '',
        stroke: getComputedStyle(svg).stroke,
        color: getComputedStyle(svg).color,
        childFills: [...svg.querySelectorAll('*')].map((el) => el.getAttribute('fill') || '').filter(Boolean)
      }));
      return {
        bg: getComputedStyle(card).backgroundColor,
        radius: getComputedStyle(card).borderRadius,
        textColor: getComputedStyle(reader).color,
        textOpacity: getComputedStyle(reader).opacity,
        svgs
      };
    })()`);
    await js(win, `(() => {
      const inp = document.querySelector('[data-testid="opacity"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '0.8');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await click(win, 'settings');
    await sleep(260);
    const allBlueLineIcons =
      visual.svgs.length >= 6 &&
      visual.svgs.every((s) => s.fill === 'none' && s.childFills.length === 0 && s.stroke === 'rgb(37, 99, 235)');
    check('visual polish: white surface, 20px corners, navy opaque text at 0.35 alpha',
      /^rgba\(255,\s*255,\s*255,\s*0\.35/.test(visual.bg) &&
      visual.radius === '20px' &&
      visual.textColor === 'rgb(20, 33, 61)' &&
      visual.textOpacity === '1' &&
      Math.abs(win.getOpacity() - 1) < 0.001,
      JSON.stringify({ bg: visual.bg, radius: visual.radius, textColor: visual.textColor, textOpacity: visual.textOpacity }));
    check('visual polish: all header and toolbar icons are blue line icons', allBlueLineIcons, JSON.stringify(visual.svgs));

    const text = await js<string>(win, `document.querySelector('[data-testid="reader"]').textContent`);
    check('settings restore: script', text.includes('Line 200 of the self-test script.'));

    // Scroll, pause, resume.
    await click(win, 'toggle');
    await sleep(1200);
    const t1 = await scrollTop(win);
    check('scroll advances while running', t1 > 50, `scrollTop=${t1}`);

    await click(win, 'toggle');
    await sleep(150);
    const p1 = await scrollTop(win);
    await sleep(600);
    const p2 = await scrollTop(win);
    check('pause holds position', Math.abs(p2 - p1) < 2, `${p1} -> ${p2}`);

    await click(win, 'toggle');
    await sleep(800);
    const r1 = await scrollTop(win);
    check('resume continues from paused position', r1 > p2 + 50, `${p2} -> ${r1}`);
    await click(win, 'toggle');

    // Global shortcut registration & Alt-removal checks.
    const bindings = await js<ShortcutBindingStatus[]>(win, `window.teleprompter.getShortcuts()`);
    check('shortcuts: only 3 supported bindings exposed',
      bindings.length === 3 &&
      bindings.map((b) => b.accelerator).join(',') === 'Ctrl+Space,Ctrl+Up,Ctrl+Down' &&
      bindings.every((b) => b.registered),
      JSON.stringify(bindings.map((b) => `${b.accelerator}:${b.registered}`)));
    check('shortcuts: old Ctrl+Alt+Up/Down not registered',
      !globalShortcut.isRegistered('Control+Alt+Up') && !globalShortcut.isRegistered('Control+Alt+Down'));

    // Ctrl+Space starts, pauses without reset, and resumes from paused position without stealing focus.
    await click(win, 'restart');
    await sleep(100);
    const otherApp = new BrowserWindow({ width: 160, height: 120, show: true });
    await sleep(250);
    const unfocusedBefore = !win.isFocused();
    ctx.dispatchShortcutAction('toggle-scroll'); // start
    await sleep(700);
    const gs1 = await scrollTop(win);
    const stillUnfocusedAfter = !win.isFocused();
    otherApp.destroy();
    check('Ctrl+Space starts auto-scroll without stealing focus',
      unfocusedBefore && gs1 > 30 && stillUnfocusedAfter,
      `unfocusedBefore=${unfocusedBefore} scrollTop=${gs1} stillUnfocusedAfter=${stillUnfocusedAfter}`);

    ctx.dispatchShortcutAction('toggle-scroll'); // pause
    await sleep(150);
    const gp1 = await scrollTop(win);
    await sleep(450);
    const gp2 = await scrollTop(win);
    check('Ctrl+Space pauses without scroll reset', gp1 > 30 && Math.abs(gp2 - gp1) < 2, `${gp1} -> ${gp2}`);

    ctx.dispatchShortcutAction('toggle-scroll'); // resume
    await sleep(550);
    const gr1 = await scrollTop(win);
    check('Ctrl+Space resumes from same paused position', gr1 > gp2 + 30, `${gp2} -> ${gr1}`);
    ctx.dispatchShortcutAction('toggle-scroll'); // back to paused
    await sleep(100);

    // Ctrl+Up / Ctrl+Down step consistently while paused and preserve paused state + clamp bounds.
    const pausedBase = await scrollTop(win);
    ctx.dispatchShortcutAction('step-down');
    await sleep(100);
    const afterDown = await scrollTop(win);
    const toggleLabel1 = await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent`);
    ctx.dispatchShortcutAction('step-up');
    await sleep(100);
    const afterUp = await scrollTop(win);
    const toggleLabel2 = await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent`);
    check('Ctrl+Down/Up move consistently while paused and keep paused state',
      Math.abs((afterDown - pausedBase) - 80) < 2 &&
      Math.abs(afterUp - pausedBase) < 2 &&
      /Start/.test(toggleLabel1) && /Start/.test(toggleLabel2),
      `${pausedBase} -> ${afterDown} -> ${afterUp} (${toggleLabel1}/${toggleLabel2})`);

    // Clamping at start (0) and end (maxScroll) while preserving playback state.
    await click(win, 'restart');
    await sleep(100);
    ctx.dispatchShortcutAction('step-up');
    await sleep(80);
    const clampedTop = await scrollTop(win);
    const maxScroll = await js<number>(win, `(() => { const r = document.querySelector('[data-testid="reader"]'); return r.scrollHeight - r.clientHeight; })()`);
    await js(win, `document.querySelector('[data-testid="reader"]').scrollTop = ${Math.max(0, maxScroll - 20)}`);
    ctx.dispatchShortcutAction('step-down');
    await sleep(80);
    const clampedBottom = await scrollTop(win);
    check('Ctrl+Up/Down stop at start and end of script',
      clampedTop === 0 && Math.abs(clampedBottom - maxScroll) < 2, `top=${clampedTop} bottom=${clampedBottom}/${maxScroll}`);

    // Ctrl+Down/Up preserve playing state when playing.
    await js(win, `document.querySelector('[data-testid="reader"]').scrollTop = 200`);
    ctx.dispatchShortcutAction('toggle-scroll'); // playing
    await sleep(120);
    ctx.dispatchShortcutAction('step-down');
    await sleep(80);
    const playingStepped = await scrollTop(win);
    const togglePlaying = await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent`);
    ctx.dispatchShortcutAction('toggle-scroll'); // pause
    await sleep(80);
    check('Ctrl+Down preserves playing state',
      playingStepped > 260 && /Pause/.test(togglePlaying), `scrollTop=${playingStepped} label=${togglePlaying}`);

    // Local Ctrl+Space keydown does not double-trigger; editor Space does not toggle playback.
    const beforeCtrlKey = await scrollTop(win);
    await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', ctrlKey: true, bubbles: true }))`);
    await sleep(120);
    const afterCtrlKey = await scrollTop(win);
    const labelAfterLocalCtrlSpace = await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent`);
    await click(win, 'edit');
    await sleep(100);
    await js(win, `document.querySelector('[data-testid="editor"]').dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`);
    await sleep(100);
    const stillEditing = await js<boolean>(win, `!!document.querySelector('[data-testid="editor"]')`);
    const labelAfterEditorSpace = await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent`);
    await click(win, 'edit');
    await sleep(100);
    check('local Ctrl+Space and editor Space do not hijack',
      /Start/.test(labelAfterLocalCtrlSpace) && Math.abs(afterCtrlKey - beforeCtrlKey) < 2 &&
      stillEditing && /Start/.test(labelAfterEditorSpace),
      `ctrl=${beforeCtrlKey}->${afterCtrlKey} editing=${stillEditing} label=${labelAfterEditorSpace}`);

    // Registration failure handling: marks Unavailable, does not fall back, toolbar Start button still works.
    ctx.registerGlobalShortcuts((acc) => acc !== 'Control+Space');
    await sleep(150);
    const failedUi = await js<{ row: string; title: string; list: string }>(win, `({
      row: document.querySelector('[data-testid="shortcut-toggle-scroll"]').textContent,
      title: document.querySelector('[data-testid="toggle"]').title,
      list: document.querySelector('[data-testid="shortcuts-list"]').textContent
    })`);
    await click(win, 'toggle');
    await sleep(250);
    const uiBtnStillWorks = /Pause/.test(await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent`));
    await click(win, 'toggle');
    ctx.registerGlobalShortcuts();
    check('shortcut registration failure displays Unavailable and preserves Start/Pause button',
      /Unavailable/i.test(failedUi.row) && /unavailable/i.test(failedUi.title) &&
      !/Alt/i.test(failedUi.list) && uiBtnStillWorks,
      JSON.stringify(failedUi));

    // Smallest supported window: nothing clipped or wrapped awkwardly.
    const [minW, minH] = win.getMinimumSize();
    win.setSize(minW, minH);
    await sleep(400);
    const layout = () => js<{ out: string[]; bar: number; tb: number; pill: number; sw: number; cw: number; pop: boolean }>(win, `(() => {
      const card = document.querySelector('.card').getBoundingClientRect();
      const inside = (r) => r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top >= card.top - 0.5 && r.bottom <= card.bottom + 0.5;
      const els = [...document.querySelectorAll('.bar button, .toolbar button')];
      const out = els.filter((e) => !inside(e.getBoundingClientRect())).map((e) => e.dataset.testid);
      const pop = document.querySelector('[data-testid="settings-popover"]');
      return {
        out,
        bar: document.querySelector('.bar').getBoundingClientRect().height,
        tb: document.querySelector('.toolbar').getBoundingClientRect().height,
        pill: document.querySelector('[data-testid="privacy-badge-container"]').getBoundingClientRect().height,
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        pop: pop.hidden ? true : inside(pop.getBoundingClientRect())
      };
    })()`);
    let lay = await layout();
    check(`min size ${minW}x${minH}: controls inside card, no wrap`,
      lay.out.length === 0 && lay.bar <= 52 && lay.tb <= 58 && lay.pill <= 30 && lay.sw <= lay.cw, JSON.stringify(lay));
    await click(win, 'settings');
    await sleep(150);
    lay = await layout();
    check('min size: settings popover fits inside card', lay.pop, JSON.stringify(lay));

    // Badge is read-only text: clicking does nothing, Tab skips it, cursor is default
    const badgeTag = await js<string>(win, `document.querySelector('[data-testid="privacy-badge-container"]').tagName.toLowerCase()`);
    const badgeCursor = await js<string>(win, `getComputedStyle(document.querySelector('[data-testid="privacy-badge-container"]')).cursor`);
    const badgeBeforeClick = await js<string>(win, `document.querySelector('[data-testid="privacy-badge"]').textContent`);
    await click(win, 'privacy-badge-container');
    await sleep(100);
    const badgeAfterClick = await js<string>(win, `document.querySelector('[data-testid="privacy-badge"]').textContent`);
    const badgeTabSkipped = await js<boolean>(win, `(() => {
      const el = document.querySelector('[data-testid="privacy-badge-container"]');
      return el.tabIndex === -1 && !el.matches('button, a, input, select, textarea');
    })()`);
    check('privacy badge: read-only text, normal arrow cursor, click does nothing, tab skips it',
      badgeTag === 'div' && badgeCursor === 'default' && badgeBeforeClick === badgeAfterClick && badgeTabSkipped,
      JSON.stringify({ badgeTag, badgeCursor, badgeBeforeClick, badgeAfterClick, badgeTabSkipped }));

    // Toggle privacy via Settings switch: OFF -> ON -> OFF
    // Currently privacy is ON; toggle to OFF
    await click(win, 'privacy-toggle');
    await sleep(150);
    const badgeOff = await js<string>(win, `document.querySelector('[data-testid="privacy-badge"]').textContent`);
    const switchOff = await js<string>(win, `document.querySelector('[data-testid="privacy-toggle"]').textContent.trim()`);
    // Toggle to ON
    await click(win, 'privacy-toggle');
    await sleep(150);
    const badgeOn = await js<string>(win, `document.querySelector('[data-testid="privacy-badge"]').textContent`);
    const switchOn = await js<string>(win, `document.querySelector('[data-testid="privacy-toggle"]').textContent.trim()`);
    // Toggle back to OFF
    await click(win, 'privacy-toggle');
    await sleep(150);
    const badgeFinalOff = await js<string>(win, `document.querySelector('[data-testid="privacy-badge"]').textContent`);
    const switchFinalOff = await js<string>(win, `document.querySelector('[data-testid="privacy-toggle"]').textContent.trim()`);
    check('privacy switch in settings: cycles OFF -> ON -> OFF and updates badge synchronously',
      /OFF/.test(badgeOff) && switchOff === 'OFF' &&
      /ON/.test(badgeOn) && switchOn === 'ON' &&
      /OFF/.test(badgeFinalOff) && switchFinalOff === 'OFF',
      JSON.stringify({ badgeOff, switchOff, badgeOn, switchOn, badgeFinalOff, switchFinalOff }));

    await click(win, 'settings');
    await sleep(150);

    // Reopen, confirm privacy OFF persisted and is applied.
    ctx.store.flush();
    ctx.eventLog.length = 0;
    win = ctx.reopen();
    await loaded(win);
    const badge2 = await js<string>(win, `document.querySelector('[data-testid="privacy-badge"]').textContent`);
    check('privacy Off persists across reopen', /OFF/.test(badge2) && ctx.eventLog.includes('protect:false'), `${badge2} | ${ctx.eventLog.join(',')}`);

    // No duplicate shortcut listeners after reopen: one step-down moves by exactly 80px.
    await click(win, 'restart');
    await sleep(100);
    ctx.dispatchShortcutAction('step-down');
    await sleep(120);
    const afterReopenStep = await scrollTop(win);
    check('reopen: single shortcut press triggers once (no duplicate listeners)',
      Math.abs(afterReopenStep - 80) < 2, `scrollTop=${afterReopenStep}`);

    // --- Slide parser unit tests (heading formats, inline mentions, duplicate/skipped numbers, no-heading fallback) ---
    const parsedFormats = parseSlides([
      'Slide 1',
      'Opening line.',
      'As mentioned on Slide 2, numbers inside a paragraph stay ignored.',
      'Slide 2 shows why paragraph starts without punctuation also stay ignored.',
      'Slide 01: Introduction',
      '## Slide 2 \u2013 Research Gap',
      '### Slide 3 - Methodology'
    ].join('\n'));
    check('slides parser: heading formats & inline mentions ignored',
      parsedFormats.sections.length === 4 &&
      parsedFormats.sections.map((s) => s.label).join(',') === '1,1,2,3' &&
      parsedFormats.sections[1].title === 'Introduction' &&
      parsedFormats.sections[2].title === 'Research Gap' &&
      parsedFormats.sections[3].title === 'Methodology',
      JSON.stringify(parsedFormats.sections.map((s) => `${s.label}:${s.title}`)));

    const parsedWarn = parseSlides('Slide 1\nA\nSlide 2\nB\nSlide 2\nC\nSlide 5\nD');
    check('slides parser: duplicate & skipped warnings preserve original sections',
      parsedWarn.sections.map((s) => s.label).join(',') === '1,2,2,5' &&
      parsedWarn.duplicateNumbers.join(',') === '2' &&
      parsedWarn.skippedNumbers.join(',') === '3,4' &&
      parsedWarn.warnings.length === 2,
      JSON.stringify({ labels: parsedWarn.sections.map((s) => s.label), warn: parsedWarn.warnings }));

    const parsedEmpty = parseSlides('Just a normal speech without headings.\nKeep scrolling continuously.');
    check('slides parser: no-heading fallback', parsedEmpty.sections.length === 0 && parsedEmpty.warnings.length === 0);

    const setEditorScript = async (targetWin: BrowserWindow, scriptText: string) => {
      await click(targetWin, 'edit');
      await sleep(100);
      await js(targetWin, `(() => {
        const ta = document.querySelector('[data-testid="editor"]');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(ta, ${JSON.stringify(scriptText)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(120);
    };

    // No-heading fallback UI in editor & reader.
    await setEditorScript(win, 'Plain paragraph line 1.\n\nPlain paragraph line 2 with Slide 3 mentioned inside prose.');
    const emptyEditorHint = await js<string>(win, `document.querySelector('[data-testid="editor-slides-empty"]').textContent`);
    await click(win, 'edit');
    await sleep(120);
    const emptyReaderHint = await js<string>(win, `document.querySelector('[data-testid="slide-empty-hint"]').textContent`);
    check('slides UI: no-heading fallback shows example in editor and reader',
      /Slide 1/.test(emptyEditorHint) && /Slide 1/.test(emptyReaderHint),
      JSON.stringify({ emptyEditorHint, emptyReaderHint }));

    // Editor preview warns on duplicate/skipped numbers without renumbering or dropping sections.
    await setEditorScript(win, 'Slide 1: Alpha\nText\nSlide 2: Beta\nText\nSlide 2: Beta Again\nText\nSlide 4: Delta\nText');
    const warnPreview = await js<{ summary: string; warning: string }>(win, `({
      summary: document.querySelector('[data-testid="editor-slides-summary"]').textContent,
      warning: document.querySelector('[data-testid="editor-slides-warning"]').textContent
    })`);
    await click(win, 'edit');
    await sleep(120);
    const warnSegLabels = await js<string[]>(win, `[...document.querySelectorAll('[data-testid^="slide-seg-label-"]')].map((e) => e.textContent)`);
    check('slides UI: duplicate & skipped warnings keep original 1,2,2,4 labels',
      /4 slides/.test(warnPreview.summary) &&
      /Duplicate/i.test(warnPreview.warning) &&
      /Skipped/i.test(warnPreview.warning) &&
      warnSegLabels.join(',') === '1,2,2,4',
      JSON.stringify({ warnPreview, warnSegLabels }));

    // Three-slide script: pause, click segment 3, verify jump + paused state, resume with Ctrl+Space, verify 100% at end.
    const threeSlideScript = [
      'Slide 01: Introduction',
      Array.from({ length: 14 }, (_, i) => `Intro sentence ${i + 1} establishing context.`).join('\n'),
      '## Slide 2 \u2013 Research Gap',
      Array.from({ length: 14 }, (_, i) => `Gap sentence ${i + 1} explaining why prior tools miss this.`).join('\n'),
      'Slide 3: Short Finale',
      'Final one-line takeaway.'
    ].join('\n\n');
    await setEditorScript(win, threeSlideScript);
    await click(win, 'edit');
    await js(win, `(() => {
      const inp = document.querySelector('[data-testid="speed"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '240');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(250);

    // Ensure paused, then click segment 3.
    await click(win, 'slide-seg-2');
    await sleep(150);
    const afterJump3 = await js<{
      top: number;
      btn: string;
      fills: string[];
      active: string;
    }>(win, `({
      top: document.querySelector('[data-testid="reader"]').scrollTop,
      btn: document.querySelector('[data-testid="toggle"]').textContent.trim(),
      fills: [0, 1, 2].map((i) => document.querySelector('[data-testid="slide-seg-' + i + '"]').dataset.fill),
      active: document.querySelector('[data-testid="slide-seg-2"]').dataset.active
    })`);
    const jump3Ok =
      afterJump3.top > 200 &&
      /Start/.test(afterJump3.btn) &&
      afterJump3.fills[0] === '100' &&
      afterJump3.fills[1] === '100' &&
      Number(afterJump3.fills[2]) < 50 &&
      afterJump3.active === 'true';
    check('slides UI: click segment 3 while paused jumps to Slide 3 and keeps paused state',
      jump3Ok, JSON.stringify(afterJump3));

    // Ctrl+Space resumes from Slide 3 and auto-scroll reaches 100% on short final Slide 3.
    ctx.dispatchShortcutAction('toggle-scroll');
    await sleep(1600);
    const atEnd = await js<{ top: number; max: number; btn: string; fills: string[] }>(win, `(() => {
      const r = document.querySelector('[data-testid="reader"]');
      return {
        top: r.scrollTop,
        max: r.scrollHeight - r.clientHeight,
        btn: document.querySelector('[data-testid="toggle"]').textContent.trim(),
        fills: [0, 1, 2].map((i) => document.querySelector('[data-testid="slide-seg-' + i + '"]').dataset.fill)
      };
    })()`);
    ctx.dispatchShortcutAction('toggle-scroll'); // pause again
    await sleep(100);
    ctx.dispatchShortcutAction('step-up'); // Ctrl+Up updates slide bar while paused
    await sleep(120);
    const afterStepUp = await js<string[]>(win, `[0, 1, 2].map((i) => document.querySelector('[data-testid="slide-seg-' + i + '"]').dataset.fill)`);
    check('slides UI: Ctrl+Space resumes from Slide 3 and reaches 100% at end; Ctrl+Up updates bar',
      atEnd.top > afterJump3.top &&
      Math.abs(atEnd.top - atEnd.max) < 2 &&
      /Pause/.test(atEnd.btn) &&
      atEnd.fills.join(',') === '100,100,100' &&
      Number(afterStepUp[2]) < 100,
      JSON.stringify({ atEnd, afterStepUp }));

    // 18-slide script at smallest supported overlay size (420x260): equal widths, readable labels, no overlap, horizontal bar scroll isolated.
    win.setSize(minW, minH);
    await sleep(300);
    const eighteenSlides = Array.from({ length: 18 }, (_, i) => `Slide ${i + 1}: Topic ${i + 1}\n\nSentence for slide ${i + 1}.`).join('\n\n');
    await setEditorScript(win, eighteenSlides);
    await click(win, 'edit');
    await sleep(250);
    const narrow18 = await js<{
      count: number;
      widths: number[];
      clippedLabels: string[];
      overlaps: number;
      barScrollWidth: number;
      barClientWidth: number;
      barScrollLeftAfterWheel: number;
      readerTopBefore: number;
      readerTopAfter: number;
    }>(win, `(() => {
      const bar = document.querySelector('[data-testid="slide-bar"]');
      const reader = document.querySelector('[data-testid="reader"]');
      const segs = [...document.querySelectorAll('[data-testid^="slide-seg-"]:not([data-testid*="fill"]):not([data-testid*="label"])')];
      const labels = [...document.querySelectorAll('[data-testid^="slide-seg-label-"]')];
      const widths = segs.map((s) => Math.round(s.getBoundingClientRect().width));
      const clippedLabels = labels.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent);
      let overlaps = 0;
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].getBoundingClientRect().left < segs[i - 1].getBoundingClientRect().right - 0.5) overlaps++;
      }
      const readerTopBefore = reader.scrollTop;
      bar.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
      const readerTopAfter = reader.scrollTop;
      return {
        count: segs.length,
        widths,
        clippedLabels,
        overlaps,
        barScrollWidth: bar.scrollWidth,
        barClientWidth: bar.clientWidth,
        barScrollLeftAfterWheel: bar.scrollLeft,
        readerTopBefore,
        readerTopAfter
      };
    })()`);
    const equalWidths = narrow18.widths.length === 18 && narrow18.widths.every((w) => Math.abs(w - narrow18.widths[0]) <= 1);
    check('slides UI (18 slides at 420x260): equal widths, unclipped labels, no overlap, horizontal bar scroll isolated',
      narrow18.count === 18 &&
      equalWidths &&
      narrow18.clippedLabels.length === 0 &&
      narrow18.overlaps === 0 &&
      narrow18.barScrollWidth > narrow18.barClientWidth &&
      narrow18.barScrollLeftAfterWheel > 0 &&
      narrow18.readerTopAfter === narrow18.readerTopBefore,
      JSON.stringify({
        count: narrow18.count,
        w0: narrow18.widths[0],
        clipped: narrow18.clippedLabels,
        overlaps: narrow18.overlaps,
        barSW: narrow18.barScrollWidth,
        barCW: narrow18.barClientWidth,
        barLeft: narrow18.barScrollLeftAfterWheel,
        readerDelta: narrow18.readerTopAfter - narrow18.readerTopBefore
      }));

    // Pure progress calculator sanity check.
    const progCheck = computeSlideProgress([0, 100, 200], 150, 300);
    check('slides progress helper: proportional fill',
      progCheck.activeIndex === 1 && progCheck.fills[0] === 1 && Math.abs(progCheck.fills[1] - 0.5) < 0.001 && progCheck.fills[2] === 0);

    // --- Cursor styles: arrow (default) over buttons, icons, and progress bar; text (I-beam) in editor ---
    const cursors = await js<{ items: Array<{ id: string; cursor: string; appRegion: string }>; editorCursor: string }>(win, `(() => {
      const selectors = [
        ['restart', '[data-testid="restart"]'],
        ['edit', '[data-testid="edit"]'],
        ['settings', '[data-testid="settings"]'],
        ['minimize', '[data-testid="minimize"]'],
        ['restart-svg', '[data-testid="restart"] svg'],
        ['slide-bar', '[data-testid="slide-bar"]'],
        ['slide-seg-0', '[data-testid="slide-seg-0"]'],
        ['slide-playhead', '[data-testid="slide-playhead"]']
      ];
      const items = selectors.map(([id, sel]) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return { id, cursor: cs.cursor, appRegion: cs.getPropertyValue('-webkit-app-region') };
      });
      document.querySelector('[data-testid="edit"]').click();
      return { items, editorCursor: '' };
    })()`);
    await sleep(100);
    const edCursor = await js<string>(win, `getComputedStyle(document.querySelector('[data-testid="editor"]')).cursor`);
    await click(win, 'edit');
    await sleep(100);
    check('cursors: arrow default on toolbar/minimize/progress bar and text I-beam in editor',
      cursors.items.every((i) => i.cursor === 'default') && edCursor === 'text',
      JSON.stringify({ items: cursors.items, edCursor }));

    // --- YouTube-style scrubbing (track click, continuous drag paused & playing, slide-number jump) ---
    win.setSize(680, 340);
    await sleep(250);
    await setEditorScript(win, threeSlideScript);
    await click(win, 'edit');
    await sleep(200);
    await click(win, 'restart');
    await sleep(120);

    // 1. Drag across slide boundaries while paused: Slide 1 track -> Slide 2 middle -> Slide 3 track.
    const dragPausedPos = await js<{ startTop: number; midTop: number; endTop: number }>(win, `(() => {
      const track = document.querySelector('[data-testid="slide-track"]');
      const seg0 = document.querySelector('[data-testid="slide-seg-0"]').getBoundingClientRect();
      const seg1 = document.querySelector('[data-testid="slide-seg-1"]').getBoundingClientRect();
      const seg2 = document.querySelector('[data-testid="slide-seg-2"]').getBoundingClientRect();
      const reader = document.querySelector('[data-testid="reader"]');
      track.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1, button: 0, clientX: seg0.left + seg0.width * 0.85, clientY: seg0.top + 4, bubbles: true, cancelable: true
      }));
      const startTop = reader.scrollTop;
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: seg1.left + seg1.width * 0.85, clientY: seg1.top + 4, bubbles: true }));
      const midTop = reader.scrollTop;
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: seg2.left + seg2.width * 0.85, clientY: seg2.top + 4, bubbles: true }));
      const endTop = reader.scrollTop;
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: seg2.left + seg2.width * 0.85, clientY: seg2.top + 4, bubbles: true }));
      return { startTop, midTop, endTop };
    })()`);
    await sleep(100);
    const dragPausedUi = await js<{ pct: number; btn: string }>(win, `({
      pct: Number(document.querySelector('[data-testid="slide-playhead"]').dataset.pct),
      btn: document.querySelector('[data-testid="toggle"]').textContent.trim()
    })`);
    const dragPaused = { ...dragPausedPos, ...dragPausedUi };
    check('scrubbing (paused): continuous drag moves within and across slides and stays paused',
      dragPaused.startTop > 0 &&
      dragPaused.midTop > dragPaused.startTop + 500 &&
      dragPaused.endTop > dragPaused.midTop + 200 &&
      dragPaused.pct > 80 &&
      /Start/.test(dragPaused.btn),
      JSON.stringify(dragPaused));

    // 2. Clicking slide number 2 label without dragging jumps to Slide 2's start.
    await js(win, `(() => {
      const lbl = document.querySelector('[data-testid="slide-seg-label-1"]');
      const r = lbl.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      lbl.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientX: x, clientY: y, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, button: 0, clientX: x, clientY: y, bubbles: true }));
    })()`);
    await sleep(100);
    const labelJump2 = await js<{ top: number; active: string; fill1: string }>(win, `({
      top: document.querySelector('[data-testid="reader"]').scrollTop,
      active: document.querySelector('[data-testid="slide-seg-1"]').dataset.active,
      fill1: document.querySelector('[data-testid="slide-seg-1"]').dataset.fill
    })`);
    check('scrubbing: clicking slide number 2 jumps to Slide 2 start',
      labelJump2.top > 0 && labelJump2.top < dragPaused.endTop && labelJump2.active === 'true' && Number(labelJump2.fill1) <= 2,
      JSON.stringify(labelJump2));

    // 3. Drag while playing: suspends auto-scroll while dragging, then resumes from new position on release.
    await click(win, 'toggle'); // start playing
    await sleep(150);
    const dragHoldTop = await js<number>(win, `(() => {
      const track = document.querySelector('[data-testid="slide-track"]');
      const seg0 = document.querySelector('[data-testid="slide-seg-0"]').getBoundingClientRect();
      track.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, button: 0, clientX: seg0.left + seg0.width * 0.2, clientY: seg0.top + 4, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, button: 0, clientX: seg0.left + seg0.width * 0.25, clientY: seg0.top + 4, bubbles: true }));
      return document.querySelector('[data-testid="reader"]').scrollTop;
    })()`);
    await sleep(350);
    const whileStillDraggingTop = await scrollTop(win);
    await js(win, `window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, button: 0, clientX: 60, clientY: 50, bubbles: true }))`);
    await sleep(450);
    const afterReleaseTop = await scrollTop(win);
    const btnAfterRelease = await js<string>(win, `document.querySelector('[data-testid="toggle"]').textContent.trim()`);
    await click(win, 'toggle'); // pause again
    await sleep(100);
    check('scrubbing (playing): suspends auto-scroll during drag and resumes from dragged position on release',
      Math.abs(whileStillDraggingTop - dragHoldTop) < 2 &&
      afterReleaseTop > whileStillDraggingTop + 40 &&
      /Pause/.test(btnAfterRelease),
      JSON.stringify({ dragHoldTop, whileStillDraggingTop, afterReleaseTop, btnAfterRelease }));

    // --- Light & Dark themes: switch mid-script, check popover at min size, persist across reopen ---
    const initialTheme = await js<string>(win, `document.querySelector('.card').dataset.theme`);
    const midScriptTopBeforeTheme = await scrollTop(win);
    await click(win, 'settings');
    await sleep(100);
    await click(win, 'theme-toggle');
    await sleep(120);
    const darkState = await js<{ theme: string; cardBg: string; textCol: string; popBg: string; top: number; btn: string }>(win, `({
      theme: document.querySelector('.card').dataset.theme,
      cardBg: getComputedStyle(document.querySelector('.card')).backgroundColor,
      textCol: getComputedStyle(document.querySelector('[data-testid="reader"]')).color,
      popBg: getComputedStyle(document.querySelector('[data-testid="settings-popover"]')).backgroundColor,
      top: document.querySelector('[data-testid="reader"]').scrollTop,
      btn: document.querySelector('[data-testid="toggle"]').textContent.trim()
    })`);
    win.setSize(minW, minH);
    await sleep(200);
    const popFitsWithThemeRow = await layout();
    await click(win, 'settings');
    await sleep(260);
    ctx.store.flush();
    win = ctx.reopen();
    await loaded(win);
    const persistedTheme = await js<string>(win, `document.querySelector('.card').dataset.theme`);
    check('themes: default light, switch to dark preserves position/state, popover fits at min size, persists across reopen',
      initialTheme === 'light' &&
      darkState.theme === 'dark' &&
      darkState.cardBg.includes('15, 23, 42') &&
      darkState.textCol === 'rgb(241, 245, 249)' &&
      darkState.popBg === 'rgb(30, 41, 59)' &&
      Math.abs(darkState.top - midScriptTopBeforeTheme) < 2 &&
      /Start/.test(darkState.btn) &&
      popFitsWithThemeRow.pop &&
      persistedTheme === 'dark',
      JSON.stringify({ initialTheme, darkState, popFits: popFitsWithThemeRow.pop, persistedTheme }));

    // --- Minimize & restore: taskbar reachable only when minimized, preserves scroll line, paused state, theme, and Private notes ---
    await click(win, 'settings');
    await sleep(150);
    await click(win, 'privacy-toggle'); // turn Private notes ON (since previous privacy-off check set it false)
    await sleep(150);
    await click(win, 'settings');
    await sleep(150);
    await js(win, `document.querySelector('[data-testid="reader"]').scrollTop = 420`);
    await sleep(120);
    const topBeforeMin = await scrollTop(win);
    ctx.eventLog.length = 0;

    // Check taskbar entry status before minimize (should be hidden on launch/unminimized)
    // Note: Electron does not have a getSkipTaskbar() getter, so we verify events, state, and repeat 3 times
    let cyclesOk = true;
    for (let c = 0; c < 3; c++) {
      ctx.eventLog.length = 0;
      await click(win, 'minimize');
      await sleep(300);
      const isMin = win.isMinimized() && !win.isDestroyed();
      win.restore();
      await sleep(300);
      const isRestored = !win.isMinimized();
      if (!isMin || !isRestored || !ctx.eventLog.includes('minimize') || !ctx.eventLog.includes('restore')) {
        cyclesOk = false;
      }
    }

    const afterRestore = await js<{ top: number; btn: string; theme: string; badge: string }>(win, `({
      top: document.querySelector('[data-testid="reader"]').scrollTop,
      btn: document.querySelector('[data-testid="toggle"]').textContent.trim(),
      theme: document.querySelector('.card').dataset.theme,
      badge: document.querySelector('[data-testid="privacy-badge"]').textContent
    })`);
    check('minimize & restore: taskbar reachable, keeps scroll line, paused state, dark theme, and Private notes across 3 cycles',
      cyclesOk &&
      Math.abs(afterRestore.top - topBeforeMin) < 2 &&
      /Start/.test(afterRestore.btn) &&
      afterRestore.theme === 'dark' &&
      /ON/.test(afterRestore.badge) &&
      ctx.eventLog.includes('restore') &&
      ctx.eventLog.includes('protect:true'),
      JSON.stringify({ cyclesOk, topBeforeMin, afterRestore, log: ctx.eventLog }));

    // --- Toolbar overlap fix, frosted surface, and large-font bottom reachability at min size in Dark & Light ---
    const longLargeScript = [
      'Slide 1: Opening',
      Array.from({ length: 18 }, (_, i) => `Opening sentence ${i + 1} with enough words to wrap cleanly.`).join('\n'),
      'Slide 2: Finale',
      Array.from({ length: 12 }, (_, i) => `Closing sentence ${i + 1} approaching the end.`).join('\n'),
      'End.'
    ].join('\n\n');
    await setEditorScript(win, longLargeScript);
    await click(win, 'edit');
    await js(win, `window.teleprompter.updateSettings({ fontSize: 64 })`);
    await js(win, `(() => {
      const inp = document.querySelector('[data-testid="font"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '64');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    win.setSize(minW, minH);
    await sleep(300);

    const checkLayoutForTheme = async (targetTheme: 'dark' | 'light') => {
      const currentTheme = await js<string>(win, `document.querySelector('.card').dataset.theme`);
      if (currentTheme !== targetTheme) {
        await click(win, 'settings');
        await sleep(80);
        await click(win, 'theme-toggle');
        await sleep(100);
        await click(win, 'settings');
        await sleep(150);
      }
      return js<{
        theme: string;
        separated: boolean;
        bodyOverflow: string;
        readerOverflowY: string;
        toolbarBg: string;
        toolbarBorder: string;
        toolbarBlur: string;
        toolbarOpacity: string;
        readerOpacity: string;
        lastLineVisible: boolean;
        hitsOk: boolean;
        details: unknown;
      }>(win, `(() => {
        const bodyEl = document.querySelector('.body');
        const reader = document.querySelector('[data-testid="reader"]');
        const toolbar = document.querySelector('.toolbar');
        const maxScroll = Math.max(0, reader.scrollHeight - reader.clientHeight);
        reader.scrollTop = maxScroll;
        const rRect = reader.getBoundingClientRect();
        const tRect = toolbar.getBoundingClientRect();
        const bStyle = getComputedStyle(bodyEl);
        const rStyle = getComputedStyle(reader);
        const tStyle = getComputedStyle(toolbar);

        // Locate final line 'End.' text range
        const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT);
        let targetNode = null;
        let offset = -1;
        while (walker.nextNode()) {
          const idx = walker.currentNode.textContent.lastIndexOf('End.');
          if (idx !== -1) {
            targetNode = walker.currentNode;
            offset = idx;
          }
        }
        let lastRect = { top: -1, bottom: -1 };
        if (targetNode) {
          const range = document.createRange();
          range.setStart(targetNode, offset);
          range.setEnd(targetNode, offset + 'End.'.length);
          const rects = range.getClientRects();
          const rect = rects[rects.length - 1] || range.getBoundingClientRect();
          lastRect = { top: rect.top, bottom: rect.bottom };
        }
        const lastLineVisible =
          lastRect.top >= rRect.top - 1 &&
          lastRect.bottom <= rRect.bottom + 1 &&
          lastRect.bottom <= tRect.top + 0.5;

        const btnIds = ['toggle', 'restart', 'edit', 'settings'];
        const hits = btnIds.map((id) => {
          const btn = document.querySelector('[data-testid="' + id + '"]');
          const br = btn.getBoundingClientRect();
          const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
          return { id, inBtn: !!hit && btn.contains(hit), inReader: !!hit && reader.contains(hit) };
        });

        const blurVal = tStyle.backdropFilter || tStyle.webkitBackdropFilter || '';
        return {
          theme: document.querySelector('.card').dataset.theme,
          separated: rRect.bottom <= tRect.top + 0.5,
          bodyOverflow: bStyle.overflow,
          readerOverflowY: rStyle.overflowY,
          toolbarBg: tStyle.backgroundColor,
          toolbarBorder: tStyle.borderTopWidth,
          toolbarBlur: blurVal,
          toolbarOpacity: tStyle.opacity,
          readerOpacity: rStyle.opacity,
          lastLineVisible,
          hitsOk: hits.every((h) => h.inBtn && !h.inReader),
          details: { rBottom: rRect.bottom, tTop: tRect.top, lastRect, hits, maxScroll }
        };
      })()`);
    };

    const darkMinLayout = await checkLayoutForTheme('dark');
    const lightMinLayout = await checkLayoutForTheme('light');
    check('layout & reachability (420x260, 64px font, Dark & Light): frosted toolbar clips speech and keeps final line reachable',
      [darkMinLayout, lightMinLayout].every((res) =>
        res.separated &&
        res.bodyOverflow === 'hidden' &&
        res.readerOverflowY === 'auto' &&
        Number.parseFloat(res.toolbarBorder) >= 0.5 &&
        res.toolbarBlur.includes('blur') &&
        res.toolbarOpacity === '1' &&
        res.readerOpacity === '1' &&
        res.lastLineVisible &&
        res.hitsOk
      ) &&
      /rgba?\(15,\s*23,\s*42/.test(darkMinLayout.toolbarBg) &&
      /rgba?\(242,\s*247,\s*255/.test(lightMinLayout.toolbarBg),
      JSON.stringify({ darkMinLayout, lightMinLayout }));

    // --- Reading mode cursor: default, user-select: none, drag without selection/window move, editor selection + copy/paste ---
    const readingSelectCheck = await js<{
      stylesOk: boolean;
      badStyles: Array<{ sel: string; cursor: string; userSelect: string }>;
      selectionDuringDrag: string;
      scrubMovedScroll: boolean;
    }>(win, `(() => {
      const selectors = [
        '[data-testid="reader"]',
        '.slide-section',
        '[data-testid="slide-bar"]',
        '[data-testid="slide-seg-0"]',
        '[data-testid="slide-seg-label-0"]',
        '[data-testid="slide-playhead"]',
        '.toolbar',
        '[data-testid="toggle"]',
        '[data-testid="toggle"] span',
        '[data-testid="toggle"] svg',
        '[data-testid="restart"]',
        '[data-testid="restart"] svg',
        '[data-testid="edit"]',
        '[data-testid="edit"] svg',
        '[data-testid="settings"]',
        '[data-testid="settings"] svg'
      ];
      const badStyles = selectors.map((sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        const us = cs.userSelect || cs.webkitUserSelect || '';
        return { sel, cursor: cs.cursor, userSelect: us };
      }).filter((item) => item.cursor !== 'default' || item.userSelect !== 'none');

      const reader = document.querySelector('[data-testid="reader"]');
      const rr = reader.getBoundingClientRect();
      window.getSelection()?.removeAllRanges();
      reader.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: rr.left + 20, clientY: rr.top + 20, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { button: 0, clientX: rr.left + 120, clientY: rr.top + 60, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: rr.left + 120, clientY: rr.top + 60, bubbles: true }));
      const selAfterReaderDrag = window.getSelection()?.toString() || '';

      const beforeScrub = reader.scrollTop;
      const track = document.querySelector('[data-testid="slide-track"]');
      const seg0 = document.querySelector('[data-testid="slide-seg-0"]').getBoundingClientRect();
      track.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, button: 0, clientX: seg0.left + 4, clientY: seg0.top + 4, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, button: 0, clientX: seg0.left + 4, clientY: seg0.top + 4, bubbles: true }));
      const afterScrub = reader.scrollTop;
      const selAfterScrub = window.getSelection()?.toString() || '';

      return {
        stylesOk: badStyles.length === 0,
        badStyles,
        selectionDuringDrag: selAfterReaderDrag + selAfterScrub,
        scrubMovedScroll: afterScrub < beforeScrub
      };
    })()`);
    const boundsBefore = win.getBounds();
    await sleep(80);
    const boundsAfter = win.getBounds();
    const windowDidNotMove = boundsBefore.x === boundsAfter.x && boundsBefore.y === boundsAfter.y;

    // Editor mode: I-beam cursor, text user-select, selection, copy & paste
    const prevClipboard = clipboard.readText();
    await click(win, 'edit');
    await sleep(120);
    win.focus();
    const editorCheck = await js<{
      cursor: string;
      userSelect: string;
      selectedText: string;
    }>(win, `(() => {
      const ta = document.querySelector('[data-testid="editor"]');
      const cs = getComputedStyle(ta);
      ta.focus();
      ta.setSelectionRange(0, 7);
      const selectedText = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      return {
        cursor: cs.cursor,
        userSelect: cs.userSelect || cs.webkitUserSelect || '',
        selectedText
      };
    })()`);
    win.webContents.copy();
    await sleep(100);
    const copiedClipText = clipboard.readText();
    await js(win, `(() => {
      const ta = document.querySelector('[data-testid="editor"]');
      ta.focus();
      ta.setSelectionRange(0, 0);
    })()`);
    win.webContents.paste();
    await sleep(120);
    const afterPastePrefix = await js<string>(win, `document.querySelector('[data-testid="editor"]').value.slice(0, 14)`);
    clipboard.writeText(prevClipboard);
    await click(win, 'edit');
    await sleep(100);

    check('reading mode blocks selection & I-beam cursor while preserving scrub and editor copy/paste',
      readingSelectCheck.stylesOk &&
      readingSelectCheck.selectionDuringDrag === '' &&
      readingSelectCheck.scrubMovedScroll &&
      windowDidNotMove &&
      editorCheck.cursor === 'text' &&
      editorCheck.userSelect === 'text' &&
      editorCheck.selectedText === 'Slide 1' &&
      copiedClipText === 'Slide 1' &&
      afterPastePrefix === 'Slide 1Slide 1',
      JSON.stringify({ readingSelectCheck, windowDidNotMove, editorCheck, copiedClipText, afterPastePrefix }));

    check('window flags', win.isAlwaysOnTop());
  } catch (e) {
    failed = true;
    results.push('FAIL  exception: ' + String(e));
  }
  console.log('\n=== SELFTEST RESULTS ===\n' + results.join('\n'));
  console.log('NOTE: capture exclusion (actual hiding in screen share) is NOT verifiable here.');
  app.exit(failed ? 1 : 0);
}
