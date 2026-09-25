const segmenter = new Intl.Segmenter('th', { granularity: 'word' });

/** Counts words for Thai and English alike (Thai has no spaces between words). */
export function wordCount(text: string): number {
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  section: string | null;
}

const ABBREVIATIONS = new Set(['al', 'e.g', 'i.e', 'etc', 'vs', 'fig', 'no', 'dr', 'prof', 'cf', 'pp', 'vol']);

/**
 * Splits a document into sentences with character offsets, remembering the nearest
 * section heading (a line such as "2.3 Theoretical framing" or "§2.3 ...").
 * A period ends a sentence only when followed by whitespace/end of line and not after
 * a known abbreviation ("et al.", "e.g.").
 */
export function splitSentences(doc: string): Sentence[] {
  const out: Sentence[] = [];
  let section: string | null = null;
  let offset = 0;
  for (const line of doc.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const heading = line.match(/^\s*(?:#+\s*)?§?(\d+(?:\.\d+)+)\s+\S/);
    if (heading && line.trim().length < 90 && !/[.!?]\s*$/.test(line.trim())) {
      section = `§${heading[1]}`;
      continue;
    }
    let segStart = 0;
    const push = (from: number, to: number) => {
      const raw = line.slice(from, to);
      const trimmed = raw.trim();
      if (trimmed.length < 3) return;
      const start = lineStart + from + raw.indexOf(trimmed);
      out.push({ text: trimmed, start, end: start + trimmed.length, section });
    };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '。') continue;
      const next = line[i + 1];
      if (next !== undefined && !/\s/.test(next)) continue;
      if (ch === '.') {
        const word = line.slice(segStart, i).split(/\s+/).pop()?.toLowerCase() ?? '';
        if (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word)) continue;
      }
      push(segStart, i + 1);
      segStart = i + 1;
    }
    push(segStart, line.length);
  }
  return out;
}
