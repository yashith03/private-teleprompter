export interface SlideSection {
  index: number;
  slideNumber: number;
  label: string;
  title: string;
  headingLine: string;
  lineIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ParsedSlides {
  sections: SlideSection[];
  preamble: string;
  duplicateNumbers: number[];
  skippedNumbers: number[];
  warnings: string[];
}

export interface SlideProgressState {
  activeIndex: number;
  fills: number[];
}

const HEADING_RE =
  /^(?:#{1,6}\s+|\*\*|__|\[|\()?\s*slide\s+#?0*(\d+)(?:\s*(?:\*\*|__|\]|\)))?(?:\s*(?:[:\-\u2013\u2014|.)]+)\s*(.*))?$/i;

const MAX_HEADING_LINE_LEN = 100;
const MAX_GAP_EXPANSION = 50;

/**
 * Matches standalone slide heading lines such as:
 * - "Slide 1"
 * - "Slide 01: Introduction"
 * - "## Slide 2 - Research Gap" / "## Slide 2 – Research Gap"
 * Ignores inline mentions inside prose paragraphs.
 */
export function parseSlideHeadingLine(
  line: string
): { slideNumber: number; label: string; title: string; headingLine: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LINE_LEN) return null;

  const m = HEADING_RE.exec(trimmed);
  if (!m) return null;

  const slideNumber = Number.parseInt(m[1], 10);
  if (!Number.isFinite(slideNumber)) return null;

  let title = (m[2] ?? '').trim();
  if (trimmed.startsWith('**') && title.endsWith('**')) {
    title = title.slice(0, -2).trim();
  } else if (trimmed.startsWith('__') && title.endsWith('__')) {
    title = title.slice(0, -2).trim();
  }

  return {
    slideNumber,
    label: String(slideNumber),
    title,
    headingLine: trimmed
  };
}

/**
 * Parses standalone slide sections across the full pasted script while preserving
 * original slide numbers, document order, and exact character slices.
 */
export function parseSlides(script: string): ParsedSlides {
  if (!script) {
    return { sections: [], preamble: '', duplicateNumbers: [], skippedNumbers: [], warnings: [] };
  }

  const hits: Array<{
    slideNumber: number;
    label: string;
    title: string;
    headingLine: string;
    lineIndex: number;
    startOffset: number;
  }> = [];

  let offset = 0;
  let lineIndex = 0;
  while (offset <= script.length) {
    const nl = script.indexOf('\n', offset);
    const lineEnd = nl === -1 ? script.length : nl;
    const rawLine = script.slice(offset, lineEnd).replace(/\r$/, '');
    const parsed = parseSlideHeadingLine(rawLine);
    if (parsed) {
      hits.push({
        ...parsed,
        lineIndex,
        startOffset: offset
      });
    }
    if (nl === -1) break;
    offset = nl + 1;
    lineIndex += 1;
  }

  if (hits.length === 0) {
    return {
      sections: [],
      preamble: script,
      duplicateNumbers: [],
      skippedNumbers: [],
      warnings: []
    };
  }

  const sections: SlideSection[] = hits.map((hit, i) => {
    const endOffset = i + 1 < hits.length ? hits[i + 1].startOffset : script.length;
    return {
      index: i,
      slideNumber: hit.slideNumber,
      label: hit.label,
      title: hit.title,
      headingLine: hit.headingLine,
      lineIndex: hit.lineIndex,
      startOffset: hit.startOffset,
      endOffset,
      text: script.slice(hit.startOffset, endOffset)
    };
  });

  const counts = new Map<number, number>();
  const duplicateNumbers: number[] = [];
  for (const sec of sections) {
    const next = (counts.get(sec.slideNumber) ?? 0) + 1;
    counts.set(sec.slideNumber, next);
    if (next === 2) duplicateNumbers.push(sec.slideNumber);
  }

  const skippedSet = new Set<number>();
  const skippedNumbers: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const cur = sections[i].slideNumber;
    const prev = i === 0 ? 0 : sections[i - 1].slideNumber;
    if (cur > prev + 1 && cur - prev - 1 <= MAX_GAP_EXPANSION) {
      for (let missing = prev + 1; missing < cur; missing++) {
        if (!skippedSet.has(missing)) {
          skippedSet.add(missing);
          skippedNumbers.push(missing);
        }
      }
    }
  }

  const warnings: string[] = [];
  if (duplicateNumbers.length > 0) {
    warnings.push(`Duplicate slide number(s): ${duplicateNumbers.map((n) => `Slide ${n}`).join(', ')}`);
  }
  if (skippedNumbers.length > 0) {
    warnings.push(`Skipped slide number(s): ${skippedNumbers.map((n) => `Slide ${n}`).join(', ')}`);
  }

  return {
    sections,
    preamble: script.slice(0, sections[0].startOffset),
    duplicateNumbers,
    skippedNumbers,
    warnings
  };
}

/**
 * Derives active slide index and per-segment proportional fill (0..1) directly
 * from section scrollTop anchors and the reader's current scrollTop.
 */
export function computeSlideProgress(
  anchors: readonly number[],
  scrollTop: number,
  maxScroll: number
): SlideProgressState {
  const count = anchors.length;
  if (count === 0) return { activeIndex: -1, fills: [] };

  const safeMax = Math.max(0, maxScroll);
  const pos = Math.min(Math.max(0, scrollTop), safeMax);

  if (safeMax <= 0 || pos >= safeMax - 1) {
    return {
      activeIndex: count - 1,
      fills: Array.from({ length: count }, () => 1)
    };
  }

  let activeIndex = 0;
  for (let i = 1; i < count; i++) {
    if (pos >= anchors[i] - 1) activeIndex = i;
    else break;
  }

  const fills = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    if (i < activeIndex) {
      fills[i] = 1;
    } else if (i > activeIndex) {
      fills[i] = 0;
    } else {
      const start = anchors[i];
      const end = i + 1 < count ? anchors[i + 1] : safeMax;
      const span = end - start;
      fills[i] = span <= 1 ? 1 : Math.min(1, Math.max(0, (pos - start) / span));
    }
  }

  return { activeIndex, fills };
}
