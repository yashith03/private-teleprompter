import fs from 'node:fs';
import path from 'node:path';
import { parseSlideHeadingLine, parseSlides } from '../shared/slides';
import {
  DEFAULT_ANSWER_INSTRUCTIONS,
  type QaKnowledgeBase,
  type QaKnowledgePatch,
  type QaPair,
  type QaSourceRef
} from '../shared/types';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'did', 'does', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'will', 'shall', 'may', 'might', 'must', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'as', 'into', 'about', 'like', 'through', 'after',
  'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under',
  'and', 'or', 'but', 'if', 'then', 'than', 'so', 'that', 'this', 'these',
  'those', 'it', 'its', 'you', 'your', 'yours', 'we', 'our', 'ours', 'they',
  'their', 'i', 'me', 'my', 'why', 'how', 'what', 'whats', 'wht', 'whts', 'hw',
  'which', 'who', 'whom', 'when', 'where', 'please', 'tell', 'explain',
  'describe', 'give', 'ur', 'pls', 'plz'
]);

const SYNONYM_CANON: Record<string, string> = {
  pick: 'choose',
  picked: 'choose',
  select: 'choose',
  selected: 'choose',
  chose: 'choose',
  choice: 'choose',
  reason: 'choose',
  reasons: 'choose',
  use: 'use',
  used: 'use',
  using: 'use',
  latency: 'performance',
  throughput: 'performance',
  fps: 'performance',
  speed: 'performance',
  fast: 'performance',
  faster: 'performance',
  render: 'render',
  rendering: 'render',
  renderer: 'render',
  graphics: 'render',
  method: 'method',
  methods: 'method',
  methodology: 'method',
  experiment: 'experiment',
  experiments: 'experiment',
  experimental: 'experiment',
  evaluate: 'evaluate',
  evaluation: 'evaluate'
};

function stemToken(word: string): string {
  const mapped = SYNONYM_CANON[word];
  if (mapped) return mapped;
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function rawTokens(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const w of raw.split(/\s+/)) {
    if (!w || STOP_WORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

function tokenize(text: string): string[] {
  return rawTokens(text).map(stemToken);
}

function damerauLevenshtein(a: string, b: string, maxDist: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + cost);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[m][n];
}

function expandQueryTokensWithFuzzy(
  question: string,
  knownStems: Set<string>,
  rawVocab: Set<string>
): string[] {
  const raws = rawTokens(question);
  if (raws.length === 0) return [];

  const candidates = new Set<string>(rawVocab);
  for (const [synKey, canon] of Object.entries(SYNONYM_CANON)) {
    if (knownStems.has(canon)) {
      candidates.add(synKey);
    }
  }

  return raws.map((rw) => {
    const stemmed = stemToken(rw);
    if (knownStems.has(stemmed) || rw.length < 5) {
      return stemmed;
    }

    const maxDist = rw.length >= 10 ? 3 : rw.length >= 7 ? 2 : 1;
    let bestCand: string | null = null;
    let bestDist = maxDist + 1;

    for (const cand of candidates) {
      if (cand.length < 4 || cand[0] !== rw[0]) continue;
      if (Math.abs(cand.length - rw.length) > maxDist) continue;
      const dist = damerauLevenshtein(rw, cand, maxDist);
      if (dist <= maxDist && dist < bestDist) {
        bestDist = dist;
        bestCand = cand;
        if (dist === 1) break;
      }
    }

    return bestCand ? stemToken(bestCand) : stemmed;
  });
}

function normalizeExact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findApprovedMatch(question: string, pairs: QaPair[]): QaPair | null {
  const qNorm = normalizeExact(question);
  if (!qNorm || pairs.length === 0) return null;

  const knownStems = new Set<string>();
  const rawVocab = new Set<string>();
  for (const pair of pairs) {
    if (!pair.question.trim() || !pair.answer.trim()) continue;
    for (const rw of rawTokens(pair.question)) {
      rawVocab.add(rw);
      knownStems.add(stemToken(rw));
    }
  }

  const qTokens = expandQueryTokensWithFuzzy(question, knownStems, rawVocab);
  const qSet = new Set(qTokens);

  let best: { pair: QaPair; score: number } | null = null;
  for (const pair of pairs) {
    if (!pair.question.trim() || !pair.answer.trim()) continue;
    if (normalizeExact(pair.question) === qNorm) {
      return pair;
    }

    const pTokens = tokenize(pair.question);
    const pSet = new Set(pTokens);
    if (qSet.size === 0 || pSet.size === 0) continue;

    let overlap = 0;
    for (const tok of qSet) {
      if (pSet.has(tok)) overlap += 1;
    }
    if (overlap === 0) continue;

    const union = new Set([...qSet, ...pSet]).size;
    const jaccard = overlap / union;
    const minContain = overlap / Math.min(qSet.size, pSet.size);
    const score = 0.6 * jaccard + 0.4 * minContain;

    if (score >= 0.62 && (!best || score > best.score)) {
      best = { pair, score };
    }
  }

  return best ? best.pair : null;
}

interface CandidateChunk {
  id: string;
  label: string;
  text: string;
  tokens: string[];
  titleTokens: Set<string>;
}

function splitNoteSections(notes: string): Array<{ title: string; text: string }> {
  const blocks = notes.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sections: Array<{ title: string; text: string }> = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let curTitle = '';
    let curLines: string[] = [];

    const flush = () => {
      const text = curLines.join('\n').trim();
      if (!text) return;
      if (text.length <= 1200) {
        sections.push({ title: curTitle, text });
        return;
      }
      // Split oversized single-newline blocks into bounded chunks so later lines aren't truncated away.
      let part: string[] = [];
      let partLen = 0;
      for (const line of curLines) {
        if (part.length > 0 && partLen + line.length + 1 > 900) {
          sections.push({ title: curTitle, text: part.join('\n').trim() });
          part = [line];
          partLen = line.length;
        } else {
          part.push(line);
          partLen += line.length + 1;
        }
      }
      if (part.length > 0) {
        sections.push({ title: curTitle, text: part.join('\n').trim() });
      }
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      const slideHeading = parseSlideHeadingLine(trimmed);
      const mdHeading = /^#{1,6}\s+(.+)$/.exec(trimmed);
      if (slideHeading || mdHeading) {
        flush();
        curTitle = slideHeading
          ? (slideHeading.title ? `Slide ${slideHeading.label}: ${slideHeading.title}` : `Slide ${slideHeading.label}`)
          : mdHeading![1].trim();
        curLines = [rawLine];
      } else {
        curLines.push(rawLine);
      }
    }
    flush();
  }

  return sections;
}

function buildChunks(kb: QaKnowledgeBase): CandidateChunk[] {
  const chunks: CandidateChunk[] = [];

  const speech = kb.slideSpeech.trim();
  if (speech) {
    const parsed = parseSlides(speech);
    if (parsed.sections.length > 0) {
      for (const sec of parsed.sections) {
        const id = `Slide ${sec.label}`;
        const label = sec.title ? `Slide ${sec.label}: ${sec.title}` : id;
        const text = sec.text.trim();
        if (text) {
          chunks.push({
            id,
            label,
            text,
            tokens: tokenize(`${label} ${text}`),
            titleTokens: new Set(tokenize(label))
          });
        }
      }
    } else {
      const paras = speech.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      paras.forEach((text, i) => {
        const id = `Speech ${i + 1}`;
        chunks.push({ id, label: id, text, tokens: tokenize(text), titleTokens: new Set() });
      });
    }
  }

  const notes = kb.researchNotes.trim();
  if (notes) {
    const noteSections = splitNoteSections(notes);
    noteSections.forEach((sec, i) => {
      const id = `Note ${i + 1}`;
      const firstLine = sec.text.split(/\r?\n/)[0]?.replace(/^#+\s*/, '').trim() || '';
      const heading = sec.title || (firstLine.length <= 48 ? firstLine : '');
      const label = heading ? `${id}: ${heading}` : id;
      chunks.push({
        id,
        label,
        text: sec.text,
        tokens: tokenize(`${label} ${sec.text}`),
        titleTokens: new Set(tokenize(heading))
      });
    });
  }

  return chunks;
}

export function retrieveRelevantExcerpts(
  question: string,
  kb: QaKnowledgeBase,
  maxExcerpts = 4
): QaSourceRef[] {
  if (rawTokens(question).length === 0) return [];

  const chunks = buildChunks(kb);
  if (chunks.length === 0) return [];

  // Document frequency for rarity weighting so specific technical terms outrank generic words.
  const df = new Map<string, number>();
  const rawVocab = new Set<string>();
  for (const ch of chunks) {
    const seen = new Set(ch.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
    for (const rw of rawTokens(ch.text)) {
      rawVocab.add(rw);
    }
  }

  const qTokens = expandQueryTokensWithFuzzy(question, new Set(df.keys()), rawVocab);
  if (qTokens.length === 0) return [];
  const qSet = new Set(qTokens);

  const scored: Array<{ chunk: CandidateChunk; score: number }> = [];
  for (const ch of chunks) {
    const tf = new Map<string, number>();
    for (const t of ch.tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    let score = 0;
    let hits = 0;
    for (const qt of qSet) {
      const freq = tf.get(qt) ?? 0;
      if (freq > 0) {
        hits += 1;
        const docFreq = df.get(qt) ?? 1;
        const idf = 1 + Math.log((chunks.length + 1) / docFreq);
        const titleBoost = ch.titleTokens.has(qt) ? 1.5 : 1;
        score += idf * (1 + Math.log(freq)) * titleBoost;
      }
    }
    if (hits > 0) {
      scored.push({ chunk: ch, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxExcerpts).map(({ chunk }) => ({
    id: chunk.id,
    label: chunk.label,
    excerpt: chunk.text.length > 900 ? `${chunk.text.slice(0, 897)}...` : chunk.text
  }));
}

export function verifyReferences(
  answerText: string,
  retrievedSources: QaSourceRef[]
): { verifiedRefs: string[]; unverifiedRefs: string[] } {
  const validMap = new Map<string, string>();
  for (const src of retrievedSources) {
    validMap.set(src.id.toLowerCase(), src.id);
  }

  const found = new Set<string>();
  const pattern = /\b(Slide|Note|Speech)\s+([0-9]+(?:\.[0-9]+)?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answerText)) !== null) {
    found.add(`${match[1]} ${match[2]}`);
  }

  const verifiedRefs: string[] = [];
  const unverifiedRefs: string[] = [];
  for (const ref of found) {
    const canonical = validMap.get(ref.toLowerCase());
    if (canonical) {
      if (!verifiedRefs.includes(canonical)) verifiedRefs.push(canonical);
    } else {
      if (!unverifiedRefs.includes(ref)) unverifiedRefs.push(ref);
    }
  }

  return { verifiedRefs, unverifiedRefs };
}

export class QaKnowledgeStore {
  private readonly filePath: string;
  private data: QaKnowledgeBase;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'qa-knowledge.json');
    this.data = this.load();
  }

  private load(): QaKnowledgeBase {
    const empty: QaKnowledgeBase = {
      slideSpeech: '',
      researchNotes: '',
      approvedPairs: [],
      answerInstructions: DEFAULT_ANSWER_INSTRUCTIONS
    };
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<QaKnowledgeBase>;
      const slideSpeech = typeof raw.slideSpeech === 'string' ? raw.slideSpeech : '';
      const researchNotes = typeof raw.researchNotes === 'string' ? raw.researchNotes : '';
      const answerInstructions =
        typeof raw.answerInstructions === 'string' ? raw.answerInstructions : DEFAULT_ANSWER_INSTRUCTIONS;
      const approvedPairs = Array.isArray(raw.approvedPairs)
        ? raw.approvedPairs.filter(
            (p): p is QaPair =>
              Boolean(
                p &&
                typeof p === 'object' &&
                typeof p.id === 'string' &&
                typeof p.question === 'string' &&
                typeof p.answer === 'string'
              )
          )
        : [];
      return { slideSpeech, researchNotes, approvedPairs, answerInstructions };
    } catch {
      return empty;
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get(): QaKnowledgeBase {
    return {
      slideSpeech: this.data.slideSpeech,
      researchNotes: this.data.researchNotes,
      approvedPairs: this.data.approvedPairs.map((p) => ({ ...p })),
      answerInstructions: this.data.answerInstructions
    };
  }

  update(patch: QaKnowledgePatch): QaKnowledgeBase {
    if (typeof patch.slideSpeech === 'string') {
      this.data.slideSpeech = patch.slideSpeech.slice(0, 100_000);
    }
    if (typeof patch.researchNotes === 'string') {
      this.data.researchNotes = patch.researchNotes.slice(0, 100_000);
    }
    if (typeof patch.answerInstructions === 'string') {
      this.data.answerInstructions = patch.answerInstructions.slice(0, 4000);
    }
    if (Array.isArray(patch.approvedPairs)) {
      this.data.approvedPairs = patch.approvedPairs
        .filter(
          (p): p is QaPair =>
            Boolean(
              p &&
              typeof p === 'object' &&
              typeof p.id === 'string' &&
              typeof p.question === 'string' &&
              typeof p.answer === 'string'
            )
        )
        .slice(0, 200)
        .map((p) => ({
          id: p.id.slice(0, 64),
          question: p.question.trim().slice(0, 1000),
          answer: p.answer.trim().slice(0, 4000),
          ...(typeof p.reference === 'string' && p.reference.trim()
            ? { reference: p.reference.trim().slice(0, 120) }
            : {})
        }));
    }
    this.save();
    return this.get();
  }
}
