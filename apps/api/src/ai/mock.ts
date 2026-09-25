/**
 * Deterministic, rule-based stand-in for an LLM. It is NOT a model: it matches cue patterns
 * and counts evidence so that every flow (and every test) behaves the same way offline.
 * Replace with a real provider behind AiProvider for production.
 */
import type { Grade } from '@ideax/contracts';
import { sha256 } from '../core/ids.js';
import { splitSentences, type Sentence } from '../core/text.js';
import {
  AiUnavailableError,
  type AiProvider,
  type AnchorOut,
  type BandOut,
  type CoachOut,
  type CriterionInput,
  type PersonaInput,
  type ProposalOut,
  type RubricItemInput,
} from './provider.js';

export function anchorHash(text: string): string {
  return sha256(text).slice(0, 12);
}

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
function tokens(s: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(s.toLowerCase())) if (seg.isWordLike) out.push(seg.segment);
  return out;
}

const HAS_NUMBER = /\d/;
const FIGURE_IMAGE = /\[(?:figure|รูป)[^\]]*(?:image|ภาพ)[^\]]*\]/i;
const TEXT_TABLE = /^\s*(?:table|ตาราง)\s*\d/im;
const REFERENCE_HEADING = /^\s*(?:references|reference list|bibliography|บรรณานุกรม|เอกสารอ้างอิง)\s*$/im;
const SECTION_HEADING = /^\s*(?:#+\s*)?§?\d+(?:\.\d+)+\s+\S/gm;

function gradeFromScore(score: number): Grade {
  if (score >= 3) return 'B+';
  if (score === 2) return 'B';
  return 'C+';
}

function anchorOf(content: string, s: Sentence): AnchorOut {
  return { start: s.start, end: s.end, hash: anchorHash(content.slice(s.start, s.end)), loc: s.section };
}

function short(s: string, n = 70) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export class MockAiProvider implements AiProvider {
  readonly model = 'mock-rules-v1';
  private down = false;

  setDown(down: boolean) {
    this.down = down;
  }
  isDown() {
    return this.down;
  }
  private guard() {
    if (this.down) throw new AiUnavailableError();
  }

  async analyzeSubmission({ content, items }: { content: string; items: RubricItemInput[] }): Promise<ProposalOut[]> {
    this.guard();
    const sentences = splitSentences(content);
    return items.map((item) => this.analyzeItem(content, sentences, item));
  }

  private analyzeItem(content: string, sentences: Sentence[], item: RubricItemInput): ProposalOut {
    const h = item.hints;
    const base = { itemNo: item.no };

    if (h.needs === 'figure_text') {
      const tableLine = sentences.find((s) => TEXT_TABLE.test(s.text) || /^\|/.test(s.text));
      if (tableLine) {
        return {
          ...base,
          grade: 'B',
          kind: 'presence',
          why: `พบตารางที่เป็นข้อความ: “${short(tableLine.text)}”`,
          feedback: h.fbPresent ?? 'ใช้ตารางสื่อข้อมูลที่ซับซ้อนได้',
          anchors: [anchorOf(content, tableLine)],
        };
      }
      if (FIGURE_IMAGE.test(content)) {
        return {
          ...base,
          grade: null,
          kind: 'unreadable',
          reasonCode: 'extraction_gap',
          why: 'ภาพประกอบฝังมาเป็นรูป ไม่มีชั้นข้อความ ระบบอ่านเนื้อในไม่ได้จึงไม่เสนอเกรด',
          feedback: '',
          anchors: [],
        };
      }
    }

    if (h.needs === 'reference_list') {
      if (!REFERENCE_HEADING.test(content)) {
        return {
          ...base,
          grade: null,
          kind: 'gap',
          reasonCode: 'missing_artifact',
          why: 'ไม่พบรายการอ้างอิงในไฟล์ที่ส่ง ระบบจึงตรวจความครบถ้วนไม่ได้',
          feedback: '',
          anchors: [],
        };
      }
      const after = sentences.filter((s) => s.start > content.search(REFERENCE_HEADING)).slice(0, 2);
      return {
        ...base,
        grade: after.length >= 2 ? 'B' : 'C+',
        kind: 'presence',
        why: `พบรายการอ้างอิง ${after.length} รายการแรกที่ตรวจได้`,
        feedback: h.fbPresent ?? 'แนบรายการอ้างอิงมาแล้ว',
        anchors: after.map((s) => anchorOf(content, s)),
      };
    }

    if (h.needs === 'section_structure') {
      const headings = content.match(SECTION_HEADING)?.length ?? 0;
      const first = sentences[0];
      const grade: Grade = headings >= 5 ? 'B' : headings >= 3 ? 'C+' : 'D+';
      return {
        ...base,
        grade,
        kind: first ? 'presence' : 'absence',
        why: `พบหัวข้อย่อย ${headings} หัวข้อ เรียงเป็นลำดับในบท`,
        feedback: h.fbPresent ?? 'ลำดับหัวข้อช่วยให้อ่านต่อกันได้',
        anchors: first ? [anchorOf(content, first)] : [],
      };
    }

    const cues = (h.cues ?? []).map((c) => new RegExp(c, 'i'));
    let score = 0;
    const matched: Sentence[] = [];
    for (const s of sentences) {
      const hits = cues.filter((re) => re.test(s.text)).length;
      if (hits) {
        score += hits;
        matched.push(s);
      }
    }

    if (!matched.length) {
      if (h.needs === 'other_chapter') {
        return {
          ...base,
          grade: null,
          kind: 'gap',
          reasonCode: 'other_chapter',
          why: 'เนื้อหาที่เกณฑ์นี้ต้องการน่าจะอยู่ในบทอื่นที่ไม่ได้ส่งมา ระบบจึงไม่เสนอเกรด',
          feedback: '',
          anchors: [],
        };
      }
      return {
        ...base,
        grade: 'D+',
        kind: 'absence',
        why: 'อ่านทั้งบทแล้วไม่พบข้อความที่ตรงกับเกณฑ์นี้',
        feedback: h.fbAbsent ?? 'ยังไม่พบส่วนที่ตอบเกณฑ์นี้ในบท',
        anchors: [],
      };
    }

    return {
      ...base,
      grade: gradeFromScore(score),
      kind: 'presence',
      why: `พบ ${matched.length} จุดที่ตรงกับเกณฑ์ เช่น “${short(matched[0].text)}”`,
      feedback: h.fbPresent ?? 'มีหลักฐานของเกณฑ์นี้ในบท',
      anchors: matched.slice(0, 3).map((s) => anchorOf(content, s)),
    };
  }

  async verificationQuestions(content: string): Promise<string[]> {
    this.guard();
    const claims = splitSentences(content).filter((s) => HAS_NUMBER.test(s.text) || /(because|เพราะ|therefore|จึง|this matters)/i.test(s.text));
    const picked = (claims.length ? claims : splitSentences(content)).slice(0, 2);
    return picked.map(
      (s) => `คุณเขียนว่า “${short(s.text, 90)}” ข้อมูลอะไรสนับสนุนข้อความนี้ และถ้าเงื่อนไขเปลี่ยนไปคุณจะตัดสินใจต่างออกไปอย่างไร`,
    );
  }

  async judgeExplanation({ answer }: { question: string; answer: string }) {
    this.guard();
    const reasoning = /(เพราะ|because|ข้อมูล|data|ถ้า|if|หาก|เนื่องจาก|since)/i.test(answer);
    const explained = answer.trim().length >= 60 && reasoning;
    return {
      explained,
      why: explained ? 'อธิบายด้วยเหตุผลและอ้างข้อมูลได้' : 'คำอธิบายสั้นหรือยังไม่ได้ให้เหตุผล/ข้อมูลรองรับ',
    };
  }

  async personaReply({ persona, question }: { persona: PersonaInput; question: string }): Promise<string> {
    this.guard();
    const q = new Set(tokens(question));
    let best: { score: number; answer: string } = { score: 0, answer: '' };
    for (const f of persona.facts) {
      const score = f.keywords.filter((k) => q.has(k.toLowerCase()) || question.toLowerCase().includes(k.toLowerCase())).length;
      if (score > best.score) best = { score, answer: f.answer };
    }
    if (best.score > 0) return best.answer;
    const topics = persona.facts.map((f) => f.keywords[0]).slice(0, 4).join(', ');
    return `เรื่องนี้${persona.role === 'owner' ? 'ผม' : 'ดิฉัน'}ไม่มีข้อมูลในเคสนี้ครับ/ค่ะ ลองถามเรื่อง ${topics} ดูไหม`;
  }

  async coach({ section, text }: { section: string; text: string }): Promise<CoachOut> {
    this.guard();
    const t = text.trim();
    const questions: string[] = [];
    const needsNumbers = ['problem', 'unit_economics', 'risks'].includes(section);
    const missingEvidence = needsNumbers && !HAS_NUMBER.test(t);
    if (!t) {
      questions.push(OPENERS[section] ?? 'เริ่มจากสิ่งที่คุณสังเกตเห็นในข้อมูลก่อน อะไรคืออาการ และอะไรน่าจะเป็นต้นเหตุ?');
    } else {
      if (missingEvidence) questions.push('ตัวเลขอะไรจาก Data Room ที่สนับสนุนข้อนี้? ระบุแท็บหรือแถวที่ใช้');
      if (t.length < 120) questions.push('ช่วยขยายว่าทำไมคุณคิดแบบนี้ มีทางเลือกอื่นที่ตัดทิ้งไปไหม เพราะอะไร?');
      questions.push(FOLLOWUPS[section] ?? 'ถ้าเงื่อนไขหลักเปลี่ยน เช่น ต้นทุนเพิ่ม 10% คุณจะยังเลือกแบบนี้ไหม?');
    }
    const band = !t ? 1 : missingEvidence ? 2 : t.length < 120 ? 2 : HAS_NUMBER.test(t) && t.length > 200 ? 4 : 3;
    return { questions, missingEvidence, band };
  }

  async pushbackChallenge({ canvas, round }: { canvas: Record<string, string>; round: number }) {
    this.guard();
    const order = ['problem', 'unit_economics', 'risks', 'target', 'channels'];
    const weakest = [...order].sort((a, b) => weakness(canvas[b] ?? '') - weakness(canvas[a] ?? ''))[(round - 1) % order.length];
    return { section: weakest, challenge: CHALLENGES[weakest] };
  }

  async pushbackJudge({ section, defense }: { section: string; defense: string }) {
    this.guard();
    const cites = HAS_NUMBER.test(defense) || /(ข้อมูล|data room|ยอดขาย|ต้นทุน|สัมภาษณ์|ลูกค้า)/i.test(defense);
    const long = defense.trim().length >= 80;
    const passed = cites && long;
    return {
      passed,
      why: passed
        ? 'ตอบข้อโต้แย้งด้วยข้อมูลและเหตุผล ผ่านไปเฟสถัดไปได้'
        : `ยังไม่พอ: ${!long ? 'คำตอบสั้นเกินไป ' : ''}${!cites ? 'ยังไม่อ้างข้อมูลจากเคส' : ''}`.trim(),
      section,
    };
  }

  async scoreAttempt({ text, criteria }: { text: string; criteria: CriterionInput[] }): Promise<BandOut[]> {
    this.guard();
    const sentences = splitSentences(text);
    return criteria.map((c) => {
      const res = c.cues.map((x) => new RegExp(x, 'i'));
      const hits = sentences.filter((s) => res.some((re) => re.test(s.text)));
      const withNumbers = hits.filter((s) => HAS_NUMBER.test(s.text)).length;
      const band = Math.min(4, 1 + Math.min(2, hits.length) + (withNumbers ? 1 : 0));
      return {
        key: c.key,
        band,
        why: hits.length
          ? `พบ ${hits.length} ประโยคที่เกี่ยวกับ ${c.name}${withNumbers ? ' และมีตัวเลขรองรับ' : ''}`
          : `ยังไม่พบส่วนที่แสดง ${c.name}`,
        quotes: hits.slice(0, 2).map((s) => s.text),
      };
    });
  }
}

function weakness(t: string): number {
  return (t.trim().length < 120 ? 2 : 0) + (HAS_NUMBER.test(t) ? 0 : 1);
}

const OPENERS: Record<string, string> = {
  problem: 'จากข้อมูลที่เห็น อะไรคืออาการ (เช่นยอดขายลด) และอะไรน่าจะเป็นต้นเหตุจริง? ลองแตกด้วย 5 Whys',
  target: 'ลูกค้ากลุ่มไหนที่ปัญหานี้กระทบมากที่สุด คุณรู้จากข้อมูลส่วนไหน?',
  unit_economics: 'ต่อหนึ่งหน่วยขาย ร้านได้เงินเท่าไร และต้นทุนอะไรบ้างที่กินกำไร?',
  channels: 'ลูกค้ากลุ่มเป้าหมายเจอร้านผ่านช่องทางไหนบ้าง ช่องทางไหนคุ้มที่สุด?',
  risks: 'ถ้าแผนนี้ไม่ได้ผล จะรู้ได้เร็วแค่ไหน และความเสียหายสูงสุดคืออะไร?',
};
const FOLLOWUPS: Record<string, string> = {
  problem: 'ถ้าต้นเหตุที่คุณเลือกผิด ข้อมูลอะไรจะบอกคุณได้เร็วที่สุด?',
  target: 'ถ้าเลือกกลุ่มนี้ กลุ่มไหนที่คุณยอมเสียไป และคุ้มไหม?',
  unit_economics: 'ถ้าต้นทุนวัตถุดิบขึ้น 10% ตัวเลขนี้ยังเป็นบวกไหม?',
  channels: 'ช่องทางนี้เจ้าของร้านทำเองได้จริงด้วยคนและงบที่มีไหม?',
  risks: 'ความเสี่ยงข้อไหนที่เจ้าของร้านรับไม่ได้ และคุณจะลดมันอย่างไร?',
};
const CHALLENGES: Record<string, string> = {
  problem: 'ผมไม่แน่ใจว่าคุณเจอต้นเหตุจริง ข้อมูลที่คุณใช้บอกแค่อาการหรือเปล่า? อะไรทำให้มั่นใจว่าไม่ใช่สาเหตุอื่น',
  unit_economics: 'ตัวเลขต่อหน่วยของคุณดูดีเกินจริง ถ้ารวมของเสียและค่าแรงช่วงบ่ายเข้าไป ยังคุ้มอยู่ไหม? ขอตัวเลข',
  risks: 'แผนนี้ถ้าล้มจะเสียอะไรบ้าง คุณประเมินความเสี่ยงต่ำไปหรือเปล่า? อะไรคือสัญญาณเตือนที่จะวัด',
  target: 'ทำไมต้องเป็นกลุ่มนี้ ข้อมูลอะไรบอกว่าเขาจะจ่าย ไม่ใช่แค่ชอบ?',
  channels: 'ช่องทางที่เสนอต้องใช้คนและงบ ร้านนี้มีพอไหม? ถ้าไม่มี จะเริ่มจากอะไร',
};
