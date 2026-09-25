/**
 * Removes details that identify people before anything reaches a Case Booklet (plan p.30, TX-14).
 * Rule-based on purpose: predictable, auditable, and a human (case ops + owner) still reviews the result.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[อีเมล]'],
  [/\b\d{1}[- ]?\d{4}[- ]?\d{5}[- ]?\d{2}[- ]?\d{1}\b/g, '[เลขประจำตัว]'],
  [/(?:\+66|0)\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/g, '[เบอร์โทร]'],
  [/(?:line\s*id|ไลน์)\s*[:：]?\s*@?[\w.-]+/gi, '[ไลน์]'],
];

export function anonymize(text: string, maskTerms: string[] = []): { text: string; replaced: number } {
  let replaced = 0;
  let out = text;
  for (const [re, label] of PATTERNS) {
    out = out.replace(re, () => {
      replaced++;
      return label;
    });
  }
  for (const term of maskTerms.filter((t) => t.trim().length >= 2)) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, () => {
      replaced++;
      return '[ชื่อบุคคล]';
    });
  }
  return { text: out, replaced };
}

/** Very small CSV reader for Data Room assets (first line = columns). */
export function parseCsv(text: string): { columns: string[]; rows: Array<Array<string | number>> } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const split = (l: string) => l.split(',').map((c) => c.trim());
  const columns = split(lines[0] ?? '');
  const rows = lines.slice(1).map((l) => split(l).map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
  return { columns, rows };
}
