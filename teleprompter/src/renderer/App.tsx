import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent
} from 'react';
import {
  computeSlideProgress,
  parseSlides,
  type SlideProgressState
} from '../shared/slides';
import type { Settings, ShortcutAction, ShortcutBindingStatus } from '../shared/types';
import {
  CheckIcon, CloseIcon, EditIcon, MinimizeIcon, PauseIcon, PlayIcon, RestartIcon, SettingsIcon, ShieldIcon
} from './icons';

export const STEP_PX = 80;
type Patch = Partial<Omit<Settings, 'privateNotes'>>;

export function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutBindingStatus[]>([]);
  const readerRef = useRef<HTMLDivElement>(null);
  const slideBarRef = useRef<HTMLDivElement>(null);
  const slideTrackRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const anchorsRef = useRef<number[]>([]);
  const maxScrollRef = useRef(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const posRef = useRef(0);
  const speedRef = useRef(60);
  const runningRef = useRef(false);
  const editingRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<Patch>({});
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRef = useRef<{
    pointerId: number;
    downX: number;
    dragged: boolean;
    startedOnLabelIndex: number | null;
  } | null>(null);
  const handledPointerUpRef = useRef(false);
  const [progress, setProgress] = useState<SlideProgressState>({ activeIndex: -1, fills: [] });
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacyPending, setPrivacyPending] = useState(false);

  const parsedSlides = useMemo(() => parseSlides(s?.script ?? ''), [s?.script]);

  useEffect(() => {
    void window.teleprompter.getSettings().then(setS);
    void window.teleprompter.getShortcuts().then(setShortcuts);
    return window.teleprompter.onShortcutStatus(setShortcuts);
  }, []);
  useEffect(() => { if (s) speedRef.current = s.speed; }, [s?.speed]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  // Debounced local save of everything except privateNotes (which has its own channel).
  // Pending patches are merged so rapid changes of different fields are not lost.
  const change = useCallback((p: Patch) => {
    pending.current = { ...pending.current, ...p };
    setS((cur) => (cur ? { ...cur, ...p } : cur));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const out = pending.current;
      pending.current = {};
      void window.teleprompter.updateSettings(out);
    }, 200);
  }, []);

  const commitProgress = useCallback((next: SlideProgressState) => {
    setProgress((prev) => {
      if (
        prev.activeIndex === next.activeIndex &&
        prev.fills.length === next.fills.length &&
        prev.fills.every((v, i) => Math.abs(v - next.fills[i]) < 0.001)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const syncProgressOnly = useCallback(
    (scrollPos?: number) => {
      const el = readerRef.current;
      if (!el || anchorsRef.current.length === 0) return;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      maxScrollRef.current = maxScroll;
      const pos = scrollPos ?? el.scrollTop;
      commitProgress(computeSlideProgress(anchorsRef.current, pos, maxScroll));
    },
    [commitProgress]
  );

  const measureAndSyncProgress = useCallback(() => {
    const el = readerRef.current;
    const count = parsedSlides.sections.length;
    if (!el) {
      anchorsRef.current = [];
      maxScrollRef.current = 0;
      commitProgress({ activeIndex: -1, fills: [] });
      return;
    }

    const cs = getComputedStyle(el);
    const padTop = Number.parseFloat(cs.paddingTop) || 0;
    const lineHeight = Number.parseFloat(cs.lineHeight) || (Number.parseFloat(cs.fontSize) || 32) * 1.35;
    const maxSafePadBottom = Math.max(16, Math.floor(el.clientHeight - lineHeight - 2));

    if (count === 0) {
      el.style.paddingBottom = `${Math.min(24, maxSafePadBottom)}px`;
      anchorsRef.current = [];
      maxScrollRef.current = Math.max(0, el.scrollHeight - el.clientHeight);
      commitProgress({ activeIndex: -1, fills: [] });
      return;
    }

    const lastSec = sectionRefs.current[count - 1];
    const lastHeight = lastSec ? lastSec.offsetHeight : lineHeight;
    const desiredForSlides = Math.max(
      16,
      Math.ceil(el.clientHeight - padTop - lastHeight + Math.min(84, Math.floor(el.clientHeight * 0.6)))
    );
    const neededBottom = Math.max(16, Math.min(desiredForSlides, maxSafePadBottom));
    el.style.paddingBottom = `${neededBottom}px`;

    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    maxScrollRef.current = maxScroll;

    const anchors: number[] = [];
    for (let i = 0; i < count; i++) {
      const secEl = sectionRefs.current[i];
      const prev = i > 0 ? anchors[i - 1] : 0;
      const raw = secEl ? Math.max(0, secEl.offsetTop - padTop) : prev;
      anchors.push(Math.min(maxScroll, Math.max(prev, raw)));
    }
    anchorsRef.current = anchors;
    commitProgress(computeSlideProgress(anchors, el.scrollTop, maxScroll));
  }, [parsedSlides.sections.length, commitProgress]);

  useLayoutEffect(() => {
    if (!s || editing) return;
    measureAndSyncProgress();
  }, [s?.script, s?.fontSize, editing, parsedSlides.sections.length, measureAndSyncProgress]);

  useEffect(() => {
    if (!s || editing) return;
    const el = readerRef.current;
    if (!el) return;
    const onResize = () => measureAndSyncProgress();
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [s !== null, editing, measureAndSyncProgress]);

  // Keep the active slide segment visible inside the horizontal slide bar without moving the speech.
  useEffect(() => {
    const bar = slideBarRef.current;
    if (!bar || progress.activeIndex < 0) return;
    const seg = bar.querySelector<HTMLElement>(`[data-testid="slide-seg-${progress.activeIndex}"]`);
    if (!seg) return;
    const pad = 6;
    const left = seg.offsetLeft;
    const right = left + seg.offsetWidth;
    if (left < bar.scrollLeft + pad) {
      bar.scrollLeft = Math.max(0, left - pad);
    } else if (right > bar.scrollLeft + bar.clientWidth - pad) {
      bar.scrollLeft = right - bar.clientWidth + pad;
    }
  }, [progress.activeIndex]);

  // Scrolling loop: time-based so speed is frame-rate independent; suspended while scrubbing.
  useEffect(() => {
    if (!running || editing || scrubbing) return;
    const el = readerRef.current;
    if (!el) return;
    posRef.current = el.scrollTop;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      posRef.current = Math.min(max, Math.max(0, posRef.current + speedRef.current * ((now - last) / 1000)));
      last = now;
      el.scrollTop = posRef.current;
      syncProgressOnly(posRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, editing, scrubbing, syncProgressOnly]);

  const toggleRun = useCallback(() => {
    setEditing(false);
    setRunning((r) => !r);
  }, []);

  const stepScroll = useCallback((deltaPx: number) => {
    const el = readerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const base = runningRef.current ? posRef.current : el.scrollTop;
    const next = Math.min(max, Math.max(0, base + deltaPx));
    posRef.current = next;
    el.scrollTop = next;
    syncProgressOnly(next);
  }, [syncProgressOnly]);

  const jumpToSlide = useCallback((index: number) => {
    const el = readerRef.current;
    if (!el) return;
    measureAndSyncProgress();
    const target = anchorsRef.current[index];
    if (target === undefined) return;
    posRef.current = target;
    el.scrollTop = target;
    syncProgressOnly(target);
  }, [measureAndSyncProgress, syncProgressOnly]);

  const seekToClientX = useCallback((clientX: number) => {
    const el = readerRef.current;
    const track = slideTrackRef.current;
    if (!el || !track) return;
    if (anchorsRef.current.length === 0) measureAndSyncProgress();
    const anchors = anchorsRef.current;
    const maxScroll = maxScrollRef.current;
    if (anchors.length === 0) return;

    const segs = track.querySelectorAll<HTMLElement>('[data-slide-seg-index]');
    if (segs.length === 0) return;

    let segIndex = segs.length - 1;
    let frac = 1;
    const firstRect = segs[0].getBoundingClientRect();
    if (clientX <= firstRect.left) {
      segIndex = 0;
      frac = 0;
    } else {
      for (let i = 0; i < segs.length; i++) {
        const rect = segs[i].getBoundingClientRect();
        const nextRect = i + 1 < segs.length ? segs[i + 1].getBoundingClientRect() : null;
        if (clientX <= rect.right || (nextRect && clientX < nextRect.left)) {
          segIndex = i;
          frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
          break;
        }
      }
    }

    const start = anchors[segIndex] ?? 0;
    const end = segIndex + 1 < anchors.length ? anchors[segIndex + 1] : maxScroll;
    const target = Math.min(maxScroll, Math.max(0, start + frac * Math.max(0, end - start)));
    posRef.current = target;
    el.scrollTop = target;
    syncProgressOnly(target);
  }, [measureAndSyncProgress, syncProgressOnly]);

  const onTrackPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const targetEl = e.target as HTMLElement | null;
    const labelEl = targetEl?.closest<HTMLElement>('[data-slide-label-index]');
    const startedOnLabelIndex = labelEl ? Number(labelEl.dataset.slideLabelIndex) : null;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic test pointer events may not have active capture */
    }
    scrubRef.current = {
      pointerId: e.pointerId,
      downX: e.clientX,
      dragged: false,
      startedOnLabelIndex: Number.isFinite(startedOnLabelIndex) ? startedOnLabelIndex : null
    };
    setScrubbing(true);
    if (startedOnLabelIndex === null) {
      seekToClientX(e.clientX);
    }
  }, [seekToClientX]);

  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const st = scrubRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      if (Math.abs(e.clientX - st.downX) >= 3) st.dragged = true;
      if (st.dragged || st.startedOnLabelIndex === null) {
        seekToClientX(e.clientX);
      }
    };
    const finish = (e: globalThis.PointerEvent) => {
      const st = scrubRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      scrubRef.current = null;
      try {
        slideTrackRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore if not captured */
      }
      handledPointerUpRef.current = true;
      queueMicrotask(() => { handledPointerUpRef.current = false; });
      if (!st.dragged && st.startedOnLabelIndex !== null) {
        jumpToSlide(st.startedOnLabelIndex);
      }
      setScrubbing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [seekToClientX, jumpToSlide]);

  const onReaderScroll = useCallback(() => {
    const el = readerRef.current;
    if (!el) return;
    if (!runningRef.current) posRef.current = el.scrollTop;
    syncProgressOnly(el.scrollTop);
  }, [syncProgressOnly]);

  const onSlideBarWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const bar = slideBarRef.current;
    if (!bar) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    }
  }, []);

  useEffect(() => {
    return window.teleprompter.onShortcutAction((action: ShortcutAction) => {
      if (action === 'toggle-scroll') toggleRun();
      else if (action === 'step-up') stepScroll(-STEP_PX);
      else if (action === 'step-down') stepScroll(STEP_PX);
    });
  }, [toggleRun, stepScroll]);

  // Space toggles scrolling, except while a control, modifier key, or editor is active
  // (so Ctrl+Space never double-triggers and focused buttons/editor behave normally).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen((open) => {
          if (open) gearRef.current?.focus();
          return false;
        });
        return;
      }
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || editingRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      toggleRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRun]);

  // Click outside closes the popover.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || gearRef.current?.contains(t)) return;
      setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  // Corner grip: drives window size through the main process.
  const gripStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const onGripDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    gripStart.current = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
  };
  const onGripMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gripStart.current;
    if (g) window.teleprompter.resizeTo(g.w + (e.screenX - g.x), g.h + (e.screenY - g.y));
  };
  const onGripUp = () => { gripStart.current = null; };

  const onTogglePrivacy = useCallback(async () => {
    if (!s || privacyPending) return;
    setPrivacyPending(true);
    setPrivacyError(null);
    const targetState = !s.privateNotes;
    try {
      const next = await window.teleprompter.setPrivateNotes(targetState);
      if (next && typeof next.privateNotes === 'boolean') {
        setS((cur) => (cur ? { ...cur, privateNotes: next.privateNotes } : next));
      } else {
        setPrivacyError('Could not update Private notes.');
      }
    } catch {
      setPrivacyError('Could not update Private notes.');
    } finally {
      setPrivacyPending(false);
    }
  }, [s, privacyPending]);

  if (!s) return <div className="loading">Loading...</div>;

  const restart = () => {
    setRunning(false);
    posRef.current = 0;
    if (readerRef.current) readerRef.current.scrollTop = 0;
    syncProgressOnly(0);
  };

  const toggleShortcut = shortcuts.find((item) => item.action === 'toggle-scroll');
  const toggleHint = toggleShortcut?.registered === false
    ? 'Ctrl+Space unavailable'
    : 'Ctrl+Space / Space';

  const privacyLabel = s.privateNotes
    ? 'Private notes on: hidden from supported full-display capture.'
    : 'Private notes off: visible in screen sharing and recordings.';

  const theme = s.theme === 'dark' ? 'dark' : 'light';
  const slideCount = parsedSlides.sections.length;
  const activeIdx = progress.activeIndex >= 0 ? progress.activeIndex : 0;
  const activeFill = slideCount > 0 ? (progress.fills[activeIdx] ?? 0) : 0;
  const playheadPct = slideCount > 0 ? Math.min(100, Math.max(0, ((activeIdx + activeFill) / slideCount) * 100)) : 0;

  return (
    <div className="shell">
      <div
        className={`card theme-${theme}`}
        data-theme={theme}
        style={{ '--panel-alpha': s.opacity } as CSSProperties}
      >
        <header className="bar">
          <div
            title={privacyLabel}
            data-testid="privacy-badge-container"
            className={`privacy ${s.privateNotes ? 'on' : 'off'}`}
            aria-live="polite"
          >
            <ShieldIcon on={s.privateNotes} />
            <span data-testid="privacy-badge">Private notes: {s.privateNotes ? 'ON' : 'OFF'}</span>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="icon-btn"
            data-testid="minimize"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => void window.teleprompter.minimize()}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-testid="close"
            aria-label="Quit teleprompter"
            title="Quit"
            onClick={() => window.teleprompter.quit()}
          >
            <CloseIcon />
          </button>
        </header>

        {!editing && (
          <div className="slide-bar-wrap" data-testid="slide-bar-wrap">
            {parsedSlides.sections.length > 0 ? (
              <div
                ref={slideBarRef}
                className="slide-bar"
                data-testid="slide-bar"
                role="region"
                aria-label="Slide progress"
                onWheel={onSlideBarWheel}
              >
                <div
                  ref={slideTrackRef}
                  className={`slide-track ${scrubbing ? 'scrubbing' : ''}`}
                  data-testid="slide-track"
                  style={{ '--slide-count': parsedSlides.sections.length } as CSSProperties}
                  onPointerDown={onTrackPointerDown}
                >
                  {parsedSlides.sections.map((sec) => {
                    const fill = progress.fills[sec.index] ?? 0;
                    const pct = Math.round(fill * 100);
                    const isActive = progress.activeIndex === sec.index;
                    const stateClass = isActive ? 'active' : fill >= 0.999 ? 'done' : 'upcoming';
                    const segLabel = `Slide ${sec.label}${sec.title ? `: ${sec.title}` : ''} (${pct}%)`;
                    return (
                      <button
                        key={sec.index}
                        type="button"
                        data-testid={`slide-seg-${sec.index}`}
                        data-slide-seg-index={sec.index}
                        data-slide-number={sec.slideNumber}
                        data-fill={pct}
                        data-active={isActive ? 'true' : 'false'}
                        aria-current={isActive ? 'step' : undefined}
                        aria-label={segLabel}
                        title={segLabel}
                        className={`slide-seg ${stateClass}`}
                        onClick={() => {
                          if (handledPointerUpRef.current) return;
                          jumpToSlide(sec.index);
                        }}
                      >
                        <span
                          className="slide-seg-fill"
                          data-testid={`slide-seg-fill-${sec.index}`}
                          style={{ width: `${(fill * 100).toFixed(1)}%` }}
                        />
                        <span
                          className="slide-seg-label"
                          data-testid={`slide-seg-label-${sec.index}`}
                          data-slide-label-index={sec.index}
                        >
                          {sec.label}
                        </span>
                      </button>
                    );
                  })}
                  <div
                    className="slide-playhead"
                    data-testid="slide-playhead"
                    data-pct={Math.round(playheadPct)}
                    style={{ left: `${playheadPct.toFixed(2)}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ) : (
              <div className="slide-empty-hint" data-testid="slide-empty-hint">
                Continuous scroll - add standalone lines like &quot;Slide 1: Intro&quot; for slide segments
              </div>
            )}
          </div>
        )}

        <main className="body">
          {editing ? (
            <>
              <textarea
                data-testid="editor"
                className="editor"
                aria-label="Script editor"
                style={{ fontSize: Math.min(s.fontSize, 28) }}
                value={s.script}
                placeholder="Paste your script here..."
                onChange={(e) => change({ script: e.target.value })}
                autoFocus
              />
              <div className="editor-slides-preview" data-testid="editor-slides-preview">
                {parsedSlides.sections.length > 0 ? (
                  <>
                    <div className="editor-slides-summary" data-testid="editor-slides-summary">
                      Detected {parsedSlides.sections.length} slide{parsedSlides.sections.length === 1 ? '' : 's'}:{' '}
                      {parsedSlides.sections.map((sec) => `Slide ${sec.label}${sec.title ? ` (${sec.title})` : ''}`).join(', ')}
                    </div>
                    {parsedSlides.warnings.length > 0 && (
                      <div className="editor-slides-warning" data-testid="editor-slides-warning" role="alert">
                        {parsedSlides.warnings.join(' | ')}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="editor-slides-empty" data-testid="editor-slides-empty">
                    No slide headings found (continuous scroll). Example: <code>Slide 1: Introduction</code> or{' '}
                    <code>## Slide 2 - Research Gap</code>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              ref={readerRef}
              data-testid="reader"
              className="reader"
              style={{ fontSize: s.fontSize }}
              onScroll={onReaderScroll}
            >
              {parsedSlides.sections.length > 0 ? (
                <>
                  {parsedSlides.preamble}
                  {parsedSlides.sections.map((sec) => (
                    <span
                      key={sec.index}
                      ref={(el) => {
                        sectionRefs.current[sec.index] = el;
                      }}
                      data-testid={`slide-section-${sec.index}`}
                      data-slide-index={sec.index}
                      className="slide-section"
                    >
                      {sec.text}
                    </span>
                  ))}
                </>
              ) : (
                s.script || 'No script yet. Press Edit to paste one.'
              )}
            </div>
          )}
        </main>

        <footer className="toolbar">
          <button
            type="button"
            data-testid="toggle"
            className="btn-primary"
            aria-label={running ? 'Pause scrolling' : 'Start scrolling'}
            title={running ? `Pause (${toggleHint})` : `Start (${toggleHint})`}
            onClick={toggleRun}
          >
            {running ? <PauseIcon /> : <PlayIcon />}
            <span>{running ? 'Pause' : 'Start'}</span>
          </button>
          <button
            type="button"
            data-testid="restart"
            className="icon-btn"
            aria-label="Restart from the top"
            title="Restart"
            onClick={restart}
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            data-testid="edit"
            className={`icon-btn ${editing ? 'active' : ''}`}
            aria-label={editing ? 'Finish editing' : 'Edit script'}
            aria-pressed={editing}
            title={editing ? 'Done editing' : 'Edit script'}
            onClick={() => { setRunning(false); setEditing((v) => !v); }}
          >
            {editing ? <CheckIcon /> : <EditIcon />}
          </button>
          <span className="spacer" />
          <button
            ref={gearRef}
            type="button"
            data-testid="settings"
            className={`icon-btn ${settingsOpen ? 'active' : ''}`}
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            title="Settings"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <SettingsIcon />
          </button>
        </footer>

        <div
          ref={popoverRef}
          className="popover"
          role="dialog"
          aria-label="Settings"
          data-testid="settings-popover"
          hidden={!settingsOpen}
        >
          <label className="row">
            <span>Speed</span>
            <input data-testid="speed" type="range" min={10} max={300} step={5} value={s.speed}
              aria-label="Scroll speed" title="Scroll speed"
              onChange={(e) => change({ speed: Number(e.target.value) })} />
          </label>
          <label className="row">
            <span>Font</span>
            <input data-testid="font" type="range" min={16} max={96} step={2} value={s.fontSize}
              aria-label="Font size" title="Font size"
              onChange={(e) => change({ fontSize: Number(e.target.value) })} />
          </label>
          <label className="row">
            <span>Background</span>
            <input data-testid="opacity" type="range" min={0.3} max={1} step={0.05} value={s.opacity}
              aria-label="Background opacity" title="Background opacity (script text stays fully opaque)"
              onChange={(e) => change({ opacity: Number(e.target.value) })} />
          </label>
          <div className="row">
            <span>Private notes</span>
            <button
              type="button"
              role="switch"
              aria-checked={s.privateNotes}
              aria-label="Private notes"
              title="Toggle Private notes protection"
              data-testid="privacy-toggle"
              className={`theme-switch ${s.privateNotes ? 'on' : 'off'}`}
              disabled={privacyPending}
              onClick={() => void onTogglePrivacy()}
            >
              {s.privateNotes ? 'ON' : 'OFF'}
            </button>
          </div>
          {privacyError && (
            <div className="settings-error" data-testid="privacy-error" role="alert">
              {privacyError}
            </div>
          )}
          <div className="row">
            <span>Theme</span>
            <button
              type="button"
              role="switch"
              aria-checked={theme === 'dark'}
              aria-label="Theme"
              title="Switch between Light and Dark themes"
              data-testid="theme-toggle"
              className={`theme-switch ${theme}`}
              onClick={() => change({ theme: theme === 'dark' ? 'light' : 'dark' })}
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          </div>
          <div className="shortcuts" data-testid="shortcuts-list" aria-label="Global shortcuts">
            <div className="shortcuts-title">Global shortcuts</div>
            {shortcuts.map((item) => (
              <div key={item.action} className="shortcut-row" data-testid={`shortcut-${item.action}`}>
                <span>{item.description}</span>
                <span className={`kbd ${item.registered ? '' : 'unavailable'}`}>
                  {item.registered ? item.accelerator : `${item.accelerator} (Unavailable)`}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="reopen"
            className="btn-secondary"
            title="Recreate the overlay window using saved settings"
            onClick={() => void window.teleprompter.reopenOverlay()}
          >
            Reopen overlay
          </button>
        </div>

        <div
          className="grip"
          role="separator"
          aria-label="Resize"
          title="Drag to resize"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        />
      </div>
    </div>
  );
}
