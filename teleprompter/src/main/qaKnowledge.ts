import fs from 'node:fs';
import path from 'node:path';
import { parseSlides } from '../shared/slides';
import type {
  QaKnowledgeBase,
  QaKnowledgePatch,
  QaPair,
  QaSourceRef
} from '../shared/types';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'did', 'does', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'will', 'shall', 'may', 'might', 'must', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'as', 'into', 'about', 'like', 'through', 'after',
  'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under',
  'and', 'or', 'but', 'if', 'then', 'than', 'so', 'that', 'this', 'these',
  'those', 'it', 'its', 'you', 'your', 'yours', 'we', 'our', 'ours', 'they',
  'their', 'i', 'me', 'my', 'why', 'how', 'what', 'which', 'who', 'whom',
  'when', 'where', 'please', 'tell', 'explain', 'describe', 'give'
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
  graphics: 'render'
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

function tokenize(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const w of raw.split(/\s+/)) {
    if (!w || STOP_WORDS.has(w)) continue;
    out.push(stemToken(w));
  }
  return out;
}

function normalizeExact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findApprovedMatch(question: string, pairs: QaPair[]): QaPair | null {
  const qNorm = normalizeExact(question);
  if (!qNorm || pairs.length === 0) return null;

  const qTokens = tokenize(question);
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
        if (text) chunks.push({ id, label, text, tokens: tokenize(`${label} ${text}`) });
      }
    } else {
      const paras = speech.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      paras.forEach((text, i) => {
        const id = `Speech ${i + 1}`;
        chunks.push({ id, label: id, text, tokens: tokenize(text) });
      });
    }
  }

  const notes = kb.researchNotes.trim();
  if (notes) {
    const paras = notes.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    paras.forEach((raw, i) => {
      const id = `Note ${i + 1}`;
      const firstLine = raw.split(/\r?\n/)[0]?.replace(/^#+\s*/, '').trim() || '';
      const label = firstLine && firstLine.length <= 48 ? `${id}: ${firstLine}` : id;
      chunks.push({ id, label, text: raw, tokens: tokenize(raw) });
    });
  }

  return chunks;
}

export function retrieveRelevantExcerpts(
  question: string,
  kb: QaKnowledgeBase,
  maxExcerpts = 4
): QaSourceRef[] {
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return [];
  const qSet = new Set(qTokens);

  const chunks = buildChunks(kb);
  if (chunks.length === 0) return [];

  // Document frequency for rarity weighting so specific technical terms outrank generic words.
  const df = new Map<string, number>();
  for (const ch of chunks) {
    const seen = new Set(ch.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const scored: Array<{ chunk: CandidateChunk; score: number }> = [];
  for (const ch of chunks) {
    const cSet = new Set(ch.tokens);
    let score = 0;
    let hits = 0;
    for (const qt of qSet) {
      if (cSet.has(qt)) {
        hits += 1;
        const docFreq = df.get(qt) ?? 1;
        score += 1 + Math.log((chunks.length + 1) / docFreq);
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
    excerpt: chunk.text.length > 600 ? `${chunk.text.slice(0, 597)}...` : chunk.text
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
      approvedPairs: []
    };
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<QaKnowledgeBase>;
      const slideSpeech = typeof raw.slideSpeech === 'string' ? raw.slideSpeech : '';
      const researchNotes = typeof raw.researchNotes === 'string' ? raw.researchNotes : '';
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
      return { slideSpeech, researchNotes, approvedPairs };
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
      approvedPairs: this.data.approvedPairs.map((p) => ({ ...p }))
    };
  }

  update(patch: QaKnowledgePatch): QaKnowledgeBase {
    if (typeof patch.slideSpeech === 'string') {
      this.data.slideSpeech = patch.slideSpeech.slice(0, 100_000);
    }
    if (typeof patch.researchNotes === 'string') {
      this.data.researchNotes = patch.researchNotes.slice(0, 100_000);
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
