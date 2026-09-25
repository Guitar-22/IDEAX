/**
 * Foundation sessions per track: session titles and frameworks from the plan (chapter 3,
 * tables 16 and 17). Session summaries and quiz questions are written for this demo;
 * theory is restated in our own words, never copied from textbooks (plan table 21).
 */
import type { Track } from '@ideax/contracts';

export interface Session {
  key: string;
  title: string;
  frameworks: string[];
  summary: string[];
}

export interface QuizQuestion {
  id: string;
  q: string;
  choices: string[];
  answer: number;
}

export const QUIZ_PASS_PERCENT = 80;

export const SESSIONS: Record<Track, Session[]> = {
  sme: [
    {
      key: 'sme-1',
      title: 'Case Thinking 101',
      frameworks: ['Issue Tree', 'MECE', '5 Whys'],
      summary: [
        'โจทย์ธุรกิจมักเริ่มจาก “อาการ” เช่น ยอดขายลด แต่สิ่งที่ต้องแก้คือ “ต้นเหตุ”',
        'Issue Tree แตกปัญหาเป็นกิ่งย่อยที่ไม่ซ้ำกันและครอบคลุม (MECE)',
        '5 Whys ถามว่า “ทำไม” ต่อเนื่องจนเจอสาเหตุที่ลงมือแก้ได้',
      ],
    },
    {
      key: 'sme-2',
      title: 'Understanding the Business',
      frameworks: ['Business Model Canvas', 'Customer Journey', 'Five Forces', 'TAM/SAM/SOM'],
      summary: [
        'เข้าใจว่าธุรกิจหาเงินจากใคร ด้วยคุณค่าอะไร ผ่านช่องทางไหน',
        'Customer Journey ช่วยหาจุดที่ลูกค้าหลุดหายไป',
        'ขนาดตลาดบอกว่าโอกาสใหญ่พอให้ลงแรงหรือไม่',
      ],
    },
    {
      key: 'sme-3',
      title: 'Numbers that Matter',
      frameworks: ['Profitability Framework', 'Unit Economics', 'Break-even'],
      summary: [
        'กำไร = รายได้ − ต้นทุน แยกต้นทุนคงที่กับต้นทุนผันแปรให้ออก',
        'Unit Economics ดูว่าขายหนึ่งหน่วยแล้วเหลือเงินเท่าไร',
        'จุดคุ้มทุน = ต้นทุนคงที่ ÷ (ราคา − ต้นทุนผันแปรต่อหน่วย)',
      ],
    },
    {
      key: 'sme-4',
      title: 'Strategy & Pitch',
      frameworks: ['Impact–Feasibility Matrix', 'Pyramid Principle'],
      summary: [
        'เทียบทางเลือกด้วยผลกระทบ ความเป็นไปได้ และความเสี่ยง',
        'Pyramid Principle: บอกข้อสรุปก่อน แล้วค่อยให้เหตุผลและหลักฐาน',
      ],
    },
  ],
  community: [
    {
      key: 'com-1',
      title: 'Community Empathy & Fieldwork 101',
      frameworks: ['Human-centered Design', 'แผนที่ทุนชุมชน'],
      summary: ['ฟังให้เข้าใจก่อนเสนอทางแก้', 'ถามแบบปลายเปิด ไม่ชี้นำคำตอบ', 'ทำแผนที่ว่าชุมชนมีทุนอะไรอยู่แล้ว'],
    },
    {
      key: 'com-2',
      title: 'Cultural Heritage & Place-Making',
      frameworks: ['อัตลักษณ์ท้องถิ่น', 'การเล่าเรื่อง', 'ท่องเที่ยวเชิงสร้างสรรค์'],
      summary: ['คุณค่ามาจากเรื่องเล่าและอัตลักษณ์ที่มีอยู่จริง', 'อย่าสร้างเรื่องที่ชุมชนไม่ได้เป็นเจ้าของ'],
    },
    {
      key: 'com-3',
      title: 'Sustainable Community Business Models',
      frameworks: ['Social Business Model Canvas'],
      summary: ['ต้องอยู่ได้ทางการเงิน ควบคู่กับผลกระทบเชิงบวกต่อสังคมและสิ่งแวดล้อม'],
    },
    {
      key: 'com-4',
      title: 'Community Engagement & Ethics',
      frameworks: ['ABCD Framework', 'ความยินยอมของชุมชน'],
      summary: ['ร่วมสร้างกับชาวบ้าน ไม่ใช่ทำแทน', 'ขอความยินยอมก่อนเผยแพร่เรื่องของชุมชน'],
    },
  ],
};

export const QUIZ: Record<Track, QuizQuestion[]> = {
  sme: [
    { id: 's1', q: 'ยอดขายลดลง 20% ข้อใดคือ “อาการ” ไม่ใช่ “ต้นเหตุ”', choices: ['ยอดขายลดลง 20%', 'ลูกค้าประจำย้ายไปร้านใหม่เพราะรอนาน', 'วัตถุดิบขาดช่วงบ่าย', 'ราคาสูงกว่าคู่แข่ง 15 บาท'], answer: 0 },
    { id: 's2', q: 'หลัก MECE หมายถึงอะไร', choices: ['ทุกกิ่งต้องมีตัวเลข', 'ไม่ซ้ำกันและครอบคลุมทั้งหมด', 'เรียงจากสำคัญมากไปน้อย', 'ใช้ได้เฉพาะปัญหาการเงิน'], answer: 1 },
    { id: 's3', q: '5 Whys ใช้ทำอะไร', choices: ['ประเมินราคา', 'หาสาเหตุที่ลงมือแก้ได้', 'แบ่งกลุ่มลูกค้า', 'เขียนสไลด์'], answer: 1 },
    { id: 's4', q: 'ส่วนใดของ Business Model Canvas บอกว่าธุรกิจหาเงินอย่างไร', choices: ['Key Partners', 'Revenue Streams', 'Channels', 'Key Activities'], answer: 1 },
    { id: 's5', q: 'Customer Journey ช่วยให้เห็นอะไรมากที่สุด', choices: ['จุดที่ลูกค้าหลุดหาย', 'ต้นทุนคงที่', 'ภาษีที่ต้องจ่าย', 'จำนวนพนักงาน'], answer: 0 },
    { id: 's6', q: 'ราคา 65 บาท ต้นทุนผันแปร 25 บาท ต้นทุนคงที่ 40,000 บาท จุดคุ้มทุนคือกี่หน่วย', choices: ['800', '1,000', '615', '1,600'], answer: 1 },
    { id: 's7', q: 'ข้อใดเป็นต้นทุนผันแปร', choices: ['ค่าเช่าร้านรายเดือน', 'แก้วและนมต่อแก้ว', 'เงินเดือนผู้จัดการ', 'ค่าตกแต่งร้าน'], answer: 1 },
    { id: 's8', q: 'Unit Economics ดูอะไร', choices: ['เงินที่เหลือต่อการขายหนึ่งหน่วย', 'ยอดขายทั้งปี', 'จำนวนสาขา', 'ส่วนแบ่งตลาด'], answer: 0 },
    { id: 's9', q: 'Impact–Feasibility Matrix ใช้ทำอะไร', choices: ['คัดทางเลือกที่ได้ผลมากและทำได้จริง', 'คำนวณภาษี', 'ออกแบบโลโก้', 'จัดตารางงาน'], answer: 0 },
    { id: 's10', q: 'Pyramid Principle เริ่มการนำเสนอด้วยอะไร', choices: ['ประวัติบริษัท', 'ข้อสรุปหลัก', 'ตารางข้อมูลทั้งหมด', 'คำขอบคุณ'], answer: 1 },
  ],
  community: [
    { id: 'c1', q: 'ก่อนเสนอทางแก้ให้ชุมชน ควรทำอะไรก่อน', choices: ['ฟังและทำความเข้าใจคนในพื้นที่', 'ออกแบบโลโก้', 'ตั้งราคาสินค้า', 'ยิงโฆษณา'], answer: 0 },
    { id: 'c2', q: 'คำถามแบบใดชี้นำคำตอบน้อยที่สุด', choices: ['ป้าชอบขนมนี้ใช่ไหม', 'เล่าให้ฟังหน่อยว่าขนมนี้เริ่มทำตอนไหน', 'ขายได้วันละ 100 ชิ้นใช่ไหม', 'อยากขายออนไลน์ใช่ไหม'], answer: 1 },
    { id: 'c3', q: 'แผนที่ทุนชุมชนบันทึกอะไร', choices: ['สิ่งที่ชุมชนมีอยู่แล้ว เช่น ทักษะ สถานที่ เรื่องเล่า', 'หนี้สินของชาวบ้าน', 'คู่แข่งในเมือง', 'ราคาที่ดิน'], answer: 0 },
    { id: 'c4', q: 'คุณค่าของการท่องเที่ยวเชิงสร้างสรรค์มาจากอะไร', choices: ['เรื่องเล่าและอัตลักษณ์ที่มีอยู่จริง', 'การสร้างตึกใหม่', 'การลดราคา', 'การจ้างดารา'], answer: 0 },
    { id: 'c5', q: 'ทำไมไม่ควรแต่งเรื่องเล่าที่ชุมชนไม่ได้เป็นเจ้าของ', choices: ['ทำให้เสียความน่าเชื่อถือและไม่ยั่งยืน', 'เพราะเขียนยาก', 'เพราะผิดไวยากรณ์', 'เพราะใช้เวลานาน'], answer: 0 },
    { id: 'c6', q: 'Social Business Model Canvas ต่างจาก BMC ปกติอย่างไร', choices: ['มีช่องผลกระทบทางสังคมและสิ่งแวดล้อม', 'ไม่มีช่องรายได้', 'ใช้ได้กับบริษัทใหญ่เท่านั้น', 'ไม่ต้องมีลูกค้า'], answer: 0 },
    { id: 'c7', q: 'ธุรกิจชุมชนที่ยั่งยืนต้องมีอะไรคู่กัน', choices: ['รายได้ที่อยู่ได้จริง + ผลดีต่อชุมชน', 'ทุนจากรัฐตลอดไป', 'ดาราโปรโมต', 'สาขาในห้าง'], answer: 0 },
    { id: 'c8', q: 'หลัก ABCD เริ่มจากอะไร', choices: ['ทุนและจุดแข็งที่ชุมชนมี', 'ปัญหาที่ชุมชนขาด', 'งบประมาณ', 'คู่แข่ง'], answer: 0 },
    { id: 'c9', q: 'ก่อนเผยแพร่เรื่องราวของชุมชน ต้องทำอะไร', choices: ['ขอความยินยอมจากชุมชน', 'ตั้งชื่อใหม่', 'ถ่ายรูปให้มากที่สุด', 'ไม่ต้องทำอะไร'], answer: 0 },
    { id: 'c10', q: '“ร่วมสร้าง” กับชุมชนหมายถึงอะไร', choices: ['ชาวบ้านร่วมคิดและตัดสินใจด้วย', 'ทำให้เสร็จแล้วส่งมอบ', 'จ้างชาวบ้านทำตามแบบ', 'ให้เงินอย่างเดียว'], answer: 0 },
  ],
};

export function scoreQuiz(track: Track, answers: Record<string, number>): number {
  const qs = QUIZ[track];
  const right = qs.filter((q) => answers[q.id] === q.answer).length;
  return Math.round((right / qs.length) * 100);
}

/** Questions as served to learners: never the answer key. */
export function publicQuiz(track: Track) {
  return QUIZ[track].map(({ id, q, choices }) => ({ id, q, choices }));
}
