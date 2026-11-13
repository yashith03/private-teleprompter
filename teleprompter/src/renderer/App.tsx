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
import {
  AI_PROVIDER_PRESETS,
  type AiConfigPatch,
  type AiModelListResult,
  type AiProviderId,
  type AiPublicConfig,
  type DeepgramModelId,
  type Settings,
  type ShortcutAction,
  type ShortcutBindingStatus,
  type SttConfig,
  type SttProviderId,
  type SttStatus
} from '../shared/types';
import {
  CheckIcon, CloseIcon, EditIcon, MinimizeIcon, PauseIcon, PlayIcon, RestartIcon, SettingsIcon, ShieldIcon
} from './icons';
import { QaPanel } from './QaPanel';

export const STEP_PX = 80;
type Patch = Partial<Omit<Settings, 'privateNotes'>>;
type TopTab = 'script' | 'qa';

export function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [activeTab, setActiveTab] = useState<TopTab>('script');
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
  const activeTabRef = useRef<TopTab>('script');
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
  const [aiConfig, setAiConfig] = useState<AiPublicConfig | null>(null);
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [aiDiscovery, setAiDiscovery] = useState<AiModelListResult | null>(null);
  const [aiDiscoveryLoading, setAiDiscoveryLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [manualModelMode, setManualModelMode] = useState(false);
  const aiDiscoverySeqRef = useRef(0);
  const aiActiveSelectionRef = useRef<{ provider: AiProviderId; customBaseUrl: string }>({
    provider: 'gemini',
    customBaseUrl: ''
  });
  const aiUrlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sttConfig, setSttConfig] = useState<SttConfig | null>(null);
  const [sttStatus, setSttStatus] = useState<SttStatus | null>(null);
  const [deepgramKeyDraft, setDeepgramKeyDraft] = useState('');

  const parsedSlides = useMemo(() => parseSlides(s?.script ?? ''), [s?.script]);

  const refreshAiModels = useCallback(async (target?: AiPublicConfig, showStatus = false) => {
    const seq = ++aiDiscoverySeqRef.current;
    const expectedProvider = target?.provider ?? aiActiveSelectionRef.current.provider;
    const expectedCustomUrl = (target?.customBaseUrl ?? aiActiveSelectionRef.current.customBaseUrl).trim();
    setAiDiscoveryLoading(true);
    try {
      const res = await window.teleprompter.listAiModels();
      if (seq !== aiDiscoverySeqRef.current) return;
      if (
        res.provider !== aiActiveSelectionRef.current.provider ||
        (res.provider === 'custom' &&
          expectedProvider === 'custom' &&
          expectedCustomUrl &&
          aiActiveSelectionRef.current.customBaseUrl.trim() !== expectedCustomUrl)
      ) {
        return;
      }
      setAiDiscovery(res);
      if (showStatus) {
        if (res.ok) {
          const chatCount = res.models.filter((m) => m.capability === 'chat').length;
          setAiStatus({ ok: true, text: `Discovered ${chatCount} chat model(s).` });
        } else {
          setAiStatus({
            ok: false,
            text: res.cached
              ? `Using cached models (${res.error || 'refresh failed'}).`
              : res.error || 'Could not list models.'
          });
        }
      }
    } finally {
      if (seq === aiDiscoverySeqRef.current) {
        setAiDiscoveryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void window.teleprompter.getSettings().then(setS);
    void window.teleprompter.getAiConfig().then((cfg) => {
      setAiConfig(cfg);
      aiActiveSelectionRef.current = {
        provider: cfg.provider,
        customBaseUrl: cfg.customBaseUrl.trim()
      };
      if (cfg.hasKey[cfg.provider] || (cfg.provider === 'custom' && cfg.customBaseUrl.trim())) {
        void refreshAiModels(cfg, false);
      }
    });
    void window.teleprompter.getSttConfig().then(setSttConfig);
    void window.teleprompter.getSttStatus().then(setSttStatus);
    void window.teleprompter.getShortcuts().then(setShortcuts);
    return window.teleprompter.onShortcutStatus(setShortcuts);
  }, [refreshAiModels]);

  const onSttConfigChange = useCallback(async (patch: Partial<SttConfig>) => {
    const updated = await window.teleprompter.updateSttConfig(patch);
    setSttConfig(updated);
    const status = await window.teleprompter.getSttStatus();
    setSttStatus(status);
  }, []);

  const onSaveDeepgramKey = useCallback(async () => {
    const trimmed = deepgramKeyDraft.trim();
    if (!trimmed) return;
    const updated = await window.teleprompter.setDeepgramApiKey(trimmed);
    setSttConfig(updated);
    setDeepgramKeyDraft('');
    const status = await window.teleprompter.getSttStatus();
    setSttStatus(status);
  }, [deepgramKeyDraft]);

  const onClearDeepgramKey = useCallback(async () => {
    const updated = await window.teleprompter.clearDeepgramApiKey();
    setSttConfig(updated);
    setDeepgramKeyDraft('');
    const status = await window.teleprompter.getSttStatus();
    setSttStatus(status);
  }, []);
  useEffect(() => { if (s) speedRef.current = s.speed; }, [s?.speed]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

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
    if (el.clientHeight === 0) return;

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
    if (!s || editing || activeTab !== 'script') return;
    if (readerRef.current) {
      readerRef.current.scrollTop = posRef.current;
    }
    measureAndSyncProgress();
  }, [s?.script, s?.fontSize, editing, activeTab, parsedSlides.sections.length, measureAndSyncProgress]);

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
      const active = document.activeElement as HTMLElement | null;
      if (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)) {
        return;
      }
      if (action === 'toggle-scroll') toggleRun();
      else if (action === 'step-up') stepScroll(-STEP_PX);
      else if (action === 'step-down') stepScroll(STEP_PX);
    });
  }, [toggleRun, stepScroll]);

  // Space toggles scrolling, except while a control, modifier key, non-script tab, or editor is active
  // (so Ctrl+Space never double-triggers and focused buttons/editor/chat input behave normally).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen((open) => {
          if (open) gearRef.current?.focus();
          return false;
        });
        return;
      }
      if (
        e.code !== 'Space' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey ||
        editingRef.current || activeTabRef.current !== 'script'
      ) return;
      const t = e.target as HTMLElement | null;
      if (t && (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
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

  const onAiConfigChange = useCallback(async (patch: AiConfigPatch) => {
    const next = await window.teleprompter.updateAiConfig(patch);
    setAiConfig(next);
    aiActiveSelectionRef.current = {
      provider: next.provider,
      customBaseUrl: next.customBaseUrl.trim()
    };
    if (patch.provider !== undefined) {
      aiDiscoverySeqRef.current += 1;
      setAiDiscovery(null);
      setAiDiscoveryLoading(false);
      setAiKeyDraft('');
      setAiStatus(null);
      setManualModelMode(false);
      if (next.hasKey[next.provider] || (next.provider === 'custom' && next.customBaseUrl.trim())) {
        void refreshAiModels(next, false);
      }
    } else if (patch.customBaseUrl !== undefined) {
      aiDiscoverySeqRef.current += 1;
      setAiDiscovery(null);
      if (aiUrlDebounceRef.current) clearTimeout(aiUrlDebounceRef.current);
      if (next.customBaseUrl.trim()) {
        aiUrlDebounceRef.current = setTimeout(() => {
          void refreshAiModels(next, false);
        }, 350);
      }
    }
  }, [refreshAiModels]);

  const onSaveAiKey = useCallback(async () => {
    if (!aiConfig || aiBusy) return;
    setAiBusy(true);
    setAiStatus(null);
    try {
      const next = await window.teleprompter.setAiApiKey(aiConfig.provider, aiKeyDraft);
      setAiConfig(next);
      setAiKeyDraft('');
      setAiStatus({
        ok: true,
        text: next.hasKey[next.provider]
          ? next.encryptionAvailable
            ? 'API key saved (OS-encrypted).'
            : 'API key stored in memory for this session.'
          : 'API key cleared.'
      });
      if (next.hasKey[next.provider] || (next.provider === 'custom' && next.customBaseUrl.trim())) {
        void refreshAiModels(next, false);
      }
    } catch (err) {
      setAiStatus({ ok: false, text: err instanceof Error ? err.message : 'Failed to save API key.' });
    } finally {
      setAiBusy(false);
    }
  }, [aiConfig, aiKeyDraft, aiBusy, refreshAiModels]);

  const onClearAiKey = useCallback(async () => {
    if (!aiConfig || aiBusy) return;
    setAiBusy(true);
    setAiStatus(null);
    try {
      const next = await window.teleprompter.clearAiApiKey(aiConfig.provider);
      setAiConfig(next);
      setAiKeyDraft('');
      setAiDiscovery(null);
      setAiStatus({ ok: true, text: 'API key cleared.' });
    } finally {
      setAiBusy(false);
    }
  }, [aiConfig, aiBusy]);

  const onListAiModels = useCallback(async () => {
    if (aiBusy || aiDiscoveryLoading) return;
    setAiStatus(null);
    await refreshAiModels(aiConfig ?? undefined, true);
  }, [aiBusy, aiDiscoveryLoading, refreshAiModels, aiConfig]);

  const onTestAiConnection = useCallback(async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiStatus(null);
    try {
      const res = await window.teleprompter.testAiConnection();
      if (res.ok) {
        const modelInfo = res.resolvedModel ? ` · ${res.resolvedModel}` : '';
        setAiStatus({ ok: true, text: `Connected (${res.latencyMs ?? 0}ms${modelInfo}): ${res.replyPreview ?? 'OK'}` });
        void refreshAiModels(aiConfig ?? undefined, false);
      } else {
        setAiStatus({ ok: false, text: res.error || 'Connection failed.' });
      }
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, aiConfig, refreshAiModels]);

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
          <div className="tabs" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'script'}
              data-testid="tab-script"
              className={`tab-btn ${activeTab === 'script' ? 'active' : ''}`}
              onClick={() => setActiveTab('script')}
            >
              Script
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'qa'}
              data-testid="tab-qa"
              className={`tab-btn ${activeTab === 'qa' ? 'active' : ''}`}
              onClick={() => {
                if (activeTab === 'script' && readerRef.current) {
                  posRef.current = readerRef.current.scrollTop;
                }
                setActiveTab('qa');
              }}
            >
              AI Q&amp;A
            </button>
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

        <div className="tab-panel" data-testid="script-panel" hidden={activeTab !== 'script'}>
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
        </div>

        <div className="tab-panel" data-testid="qa-panel-wrap" hidden={activeTab !== 'qa'}>
          <QaPanel
            aiConfig={aiConfig}
            resolvedAutoModel={
              aiDiscovery && aiDiscovery.provider === aiConfig?.provider
                ? aiDiscovery.recommended[0] ?? null
                : null
            }
            currentScript={s.script}
            isQaTabActive={activeTab === 'qa'}
            sttConfig={sttConfig}
            sttStatus={sttStatus}
            onSttConfigChange={onSttConfigChange}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

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
          {aiConfig && (
            <div className="ai-settings" data-testid="ai-settings" aria-label="AI Provider">
              <div className="shortcuts-title">AI Provider</div>
              <label className="row">
                <span>Provider</span>
                <select
                  className="ai-select"
                  data-testid="ai-provider"
                  aria-label="AI Provider"
                  value={aiConfig.provider}
                  onChange={(e) => void onAiConfigChange({ provider: e.target.value as AiProviderId })}
                >
                  {(Object.keys(AI_PROVIDER_PRESETS) as AiProviderId[]).map((id) => (
                    <option key={id} value={id}>{AI_PROVIDER_PRESETS[id].label}</option>
                  ))}
                </select>
              </label>
              {aiConfig.provider === 'custom' && (
                <label className="ai-field">
                  <span>Endpoint URL</span>
                  <input
                    type="url"
                    className="ai-text-input"
                    data-testid="ai-custom-url"
                    aria-label="Custom OpenAI-compatible endpoint URL"
                    placeholder="https://api.example.com/v1"
                    value={aiConfig.customBaseUrl}
                    onChange={(e) => void onAiConfigChange({ customBaseUrl: e.target.value })}
                  />
                </label>
              )}
              <div className="ai-field">
                <div className="ai-field-row">
                  <span>Model</span>
                  <button
                    type="button"
                    className="ai-mini-btn"
                    data-testid="ai-list-models"
                    disabled={aiBusy || aiDiscoveryLoading}
                    onClick={() => void onListAiModels()}
                  >
                    {aiDiscoveryLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                {(() => {
                  const activeDiscovery =
                    aiDiscovery && aiDiscovery.provider === aiConfig.provider ? aiDiscovery : null;
                  const discoveredSelectable = (activeDiscovery?.models ?? []).filter(
                    (m) => m.capability !== 'excluded'
                  );
                  const recommendedIds = activeDiscovery?.recommended ?? [];
                  const recommendedModels = recommendedIds
                    .map((id) => discoveredSelectable.find((m) => m.id === id))
                    .filter((m): m is NonNullable<typeof m> => Boolean(m))
                    .slice(0, 3);
                  const topRec = recommendedModels[0];
                  const savedModel = aiConfig.model.trim();
                  const savedInDiscovered =
                    Boolean(savedModel) && discoveredSelectable.some((m) => m.id === savedModel);
                  const isRetiredSavedModel =
                    aiConfig.modelMode === 'manual' &&
                    Boolean(savedModel) &&
                    !savedInDiscovered &&
                    Boolean(
                      activeDiscovery &&
                        activeDiscovery.ok &&
                        !activeDiscovery.cached &&
                        activeDiscovery.supportsDiscovery
                    );
                  const selectValue = manualModelMode
                    ? '__manual__'
                    : aiConfig.modelMode === 'auto'
                      ? '__auto__'
                      : savedModel || '__auto__';

                  return (
                    <>
                      <select
                        className="ai-select full"
                        data-testid="ai-model-select"
                        aria-label="Select model"
                        value={selectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__manual__') {
                            setManualModelMode(true);
                          } else if (val === '__auto__') {
                            setManualModelMode(false);
                            void onAiConfigChange({ modelMode: 'auto', model: '' });
                          } else {
                            setManualModelMode(false);
                            void onAiConfigChange({ modelMode: 'manual', model: val });
                          }
                        }}
                      >
                        <option value="__auto__">
                          {topRec
                            ? `Auto · Fast recommended (${topRec.id} · ${topRec.speedNote})`
                            : 'Auto · Fast recommended'}
                        </option>
                        {recommendedModels.length > 0 && (
                          <optgroup label="Recommended (fast Q&A)">
                            {recommendedModels.map((m) => (
                              <option key={`rec-${m.id}`} value={m.id}>
                                {m.id} · {m.speedNote}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {discoveredSelectable.length > 0 && (
                          <optgroup label="All models">
                            {discoveredSelectable.map((m) => (
                              <option key={`all-${m.id}`} value={m.id}>
                                {m.capability === 'unknown'
                                  ? `${m.id} (unverified capabilities)`
                                  : `${m.id}${m.observedFirstTokenMs ? ` (${m.observedFirstTokenMs}ms)` : ''}`}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {aiConfig.modelMode === 'manual' && savedModel && !savedInDiscovered && (
                          <option value={savedModel}>
                            {isRetiredSavedModel
                              ? `${savedModel} (Unavailable / retired)`
                              : `${savedModel} (saved)`}
                          </option>
                        )}
                        <option value="__manual__">Enter model ID manually</option>
                      </select>
                      {isRetiredSavedModel && (
                        <div className="ai-status err" data-testid="ai-model-retired">
                          <span>
                            Saved model &ldquo;{savedModel}&rdquo; was not found in the live{' '}
                            {AI_PROVIDER_PRESETS[aiConfig.provider].label} catalog.
                          </span>{' '}
                          <button
                            type="button"
                            className="ai-mini-btn"
                            data-testid="ai-model-replace-btn"
                            onClick={() => {
                              setManualModelMode(false);
                              if (topRec) {
                                void onAiConfigChange({ modelMode: 'manual', model: topRec.id });
                              } else {
                                void onAiConfigChange({ modelMode: 'auto', model: '' });
                              }
                            }}
                          >
                            {topRec ? `Use ${topRec.id}` : 'Switch to Auto'}
                          </button>
                        </div>
                      )}
                      {activeDiscovery && !activeDiscovery.supportsDiscovery && (
                        <div className="ai-status" data-testid="ai-discovery-note">
                          Endpoint does not support /models discovery — enter a model ID manually and use Test Connection.
                        </div>
                      )}
                      {activeDiscovery && activeDiscovery.cached && (
                        <div className="ai-status" data-testid="ai-discovery-cached">
                          Cached list · {activeDiscovery.error || 'Refresh failed'}
                        </div>
                      )}
                    </>
                  );
                })()}
                {manualModelMode && (
                  <label className="ai-field">
                    <span>Manual Model ID</span>
                    <input
                      type="text"
                      className="ai-text-input"
                      data-testid="ai-model-input"
                      aria-label="Manual Model ID"
                      placeholder="Enter model ID..."
                      value={aiConfig.model}
                      onChange={(e) => void onAiConfigChange({ modelMode: 'manual', model: e.target.value })}
                    />
                  </label>
                )}
              </div>
              <div className="ai-field">
                <span>API Key</span>
                <div className="ai-key-row">
                  <input
                    type="password"
                    className="ai-text-input"
                    data-testid="ai-key-input"
                    aria-label="API Key"
                    placeholder={aiConfig.hasKey[aiConfig.provider] ? 'Saved (encrypted)' : 'Enter API key...'}
                    value={aiKeyDraft}
                    onChange={(e) => setAiKeyDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ai-mini-btn"
                    data-testid="ai-key-save"
                    disabled={aiBusy || !aiKeyDraft.trim()}
                    onClick={() => void onSaveAiKey()}
                  >
                    Save
                  </button>
                  {aiConfig.hasKey[aiConfig.provider] && (
                    <button
                      type="button"
                      className="ai-mini-btn"
                      data-testid="ai-key-clear"
                      disabled={aiBusy}
                      onClick={() => void onClearAiKey()}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary"
                data-testid="ai-test-connection"
                disabled={aiBusy}
                onClick={() => void onTestAiConnection()}
              >
                Test Connection
              </button>
              {aiStatus && (
                <div
                  className={`ai-test-status ${aiStatus.ok ? 'ok' : 'err'}`}
                  data-testid="ai-test-status"
                  role="status"
                >
                  {aiStatus.text}
                </div>
              )}
            </div>
          )}
          {sttConfig && (
            <div className="settings-ai-section" data-testid="stt-settings">
              <div className="settings-ai-title">Voice / Speech-to-Text</div>
              <label className="row">
                <span>Speech-to-text</span>
                <select
                  className="ai-select"
                  data-testid="stt-provider"
                  aria-label="Speech-to-text provider"
                  value={sttConfig.provider}
                  onChange={(e) => void onSttConfigChange({ provider: e.target.value as SttProviderId })}
                >
                  <option value="whisper">Local Whisper</option>
                  <option value="deepgram">Deepgram</option>
                </select>
              </label>
              {sttConfig.provider === 'deepgram' && (
                <div className="qa-disclosure" data-testid="stt-deepgram-notice">
                  Audio is sent to Deepgram.
                </div>
              )}
              <div className="row">
                <span>Auto-listen in AI Q&amp;A</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sttConfig.autoListen}
                  aria-label="Auto-listen in AI Q&A"
                  title="Toggle Auto-listen in AI Q&A"
                  data-testid="stt-autolisten-toggle"
                  className={`theme-switch ${sttConfig.autoListen ? 'on' : 'off'}`}
                  onClick={() => void onSttConfigChange({ autoListen: !sttConfig.autoListen })}
                >
                  {sttConfig.autoListen ? 'ON' : 'OFF'}
                </button>
              </div>
              <label className="ai-field">
                <span>Language</span>
                <input
                  type="text"
                  className="ai-text-input"
                  data-testid="stt-language"
                  aria-label="Speech language"
                  placeholder="en"
                  value={sttConfig.language}
                  onChange={(e) => void onSttConfigChange({ language: e.target.value })}
                />
              </label>
              {sttConfig.provider === 'deepgram' ? (
                <>
                  <label className="ai-field">
                    <span>Deepgram Model</span>
                    <select
                      className="ai-select full"
                      data-testid="stt-deepgram-model"
                      aria-label="Deepgram model"
                      value={sttConfig.deepgramModel}
                      onChange={(e) =>
                        void onSttConfigChange({ deepgramModel: e.target.value as DeepgramModelId })
                      }
                    >
                      <option value="flux-general-en">Flux English (flux-general-en)</option>
                      <option value="nova-3">Nova-3 (nova-3)</option>
                    </select>
                  </label>
                  <div className="ai-field">
                    <span>Deepgram API Key</span>
                    <div className="ai-key-row">
                      <input
                        type="password"
                        className="ai-text-input"
                        data-testid="stt-deepgram-key-input"
                        aria-label="Deepgram API Key"
                        placeholder={sttConfig.hasDeepgramKey ? 'Saved (encrypted)' : 'Enter Deepgram key...'}
                        value={deepgramKeyDraft}
                        onChange={(e) => setDeepgramKeyDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="ai-mini-btn"
                        data-testid="stt-deepgram-key-save"
                        disabled={!deepgramKeyDraft.trim()}
                        onClick={() => void onSaveDeepgramKey()}
                      >
                        Save
                      </button>
                      {sttConfig.hasDeepgramKey && (
                        <button
                          type="button"
                          className="ai-mini-btn"
                          data-testid="stt-deepgram-key-clear"
                          onClick={() => void onClearDeepgramKey()}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="ai-field">
                    <span>Whisper executable (.exe)</span>
                    <input
                      type="text"
                      className="ai-text-input"
                      data-testid="stt-binary-path"
                      aria-label="Whisper executable (.exe)"
                      placeholder="Path to whisper-cli.exe"
                      value={sttConfig.binaryPath}
                      onChange={(e) => void onSttConfigChange({ binaryPath: e.target.value })}
                    />
                  </label>
                  <label className="ai-field">
                    <span>Whisper model (.bin)</span>
                    <input
                      type="text"
                      className="ai-text-input"
                      data-testid="stt-model-path"
                      aria-label="Whisper model (.bin)"
                      placeholder="Path to ggml-*.bin"
                      value={sttConfig.modelPath}
                      onChange={(e) => void onSttConfigChange({ modelPath: e.target.value })}
                    />
                  </label>
                </>
              )}
              {sttStatus && !sttStatus.available && sttStatus.reason && (
                <div className="ai-test-status err" data-testid="stt-status-reason">
                  {sttStatus.reason}
                </div>
              )}
            </div>
          )}
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
