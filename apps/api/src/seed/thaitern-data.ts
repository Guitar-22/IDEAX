/**
 * Demo cases for the THAItern journey. Every business, person and number below is FICTIONAL
 * and exists only to exercise the flows (labelled "ตัวอย่างสมมติ" in the UI).
 * The yogurt shop follows the kind of example the plan gives (chapter 3, SMEs Track).
 */
import type { FinanceParams } from '../modules/thaitern/simulator.js';

export interface CaseSeed {
  id: string;
  org: string;
  owner: string;
  track: 'sme' | 'community';
  smeGroup: string | null;
  subCategory: string;
  industry: string;
  province: string;
  title: string;
  teaser: string;
  challengeBrief: string;
  stages: number[];
  booklet: Array<{ title: string; body: string }>;
  dataRoom: Array<{ name: string; columns: string[]; rows: Array<Array<string | number>>; note?: string }>;
  personas: Array<{ key: string; name: string; role: string; intro: string; facts: Array<{ keywords: string[]; answer: string }> }>;
  finance: FinanceParams;
  questions: Array<{ id: string; q: string }>;
  criteria: Array<{ key: string; name: string; stage: number; cues: string[] }>;
}

const COMMON_CRITERIA = [
  { key: 'structure', name: 'แยกอาการกับต้นเหตุ', stage: 1, cues: ['ต้นเหตุ|สาเหตุ|root cause|เพราะ'] },
  { key: 'data', name: 'ใช้ข้อมูลจริงเป็นหลักฐาน', stage: 3, cues: ['ข้อมูล|ยอดขาย|ของเสีย|%|ต้นทุน|อัตรา'] },
  { key: 'options', name: 'ประเมินทางเลือกและความเสี่ยง', stage: 5, cues: ['ทางเลือก|เปรียบเทียบ|ความเสี่ยง|option|แทนที่จะ'] },
  { key: 'finance', name: 'เหตุผลเชิงการเงิน', stage: 6, cues: ['กำไร|จุดคุ้มทุน|ราคา|margin|บาท'] },
];

export const CASES: CaseSeed[] = [
  {
    id: 'case_yogurt',
    org: 'org_yogurt',
    owner: 'u_owner',
    track: 'sme',
    smeGroup: 'fnb',
    subCategory: 'F&B Outlets & Catering',
    industry: 'fnb_beverage',
    province: 'กรุงเทพมหานคร',
    title: 'ร้านโยเกิร์ตปั่น “นมเย็นดี” · 2 สาขา',
    teaser: 'ร้านเครื่องดื่มโยเกิร์ตปั่นสูตรของครอบครัว มี 2 สาขา คือบรรทัดทองและจามจุรีสแควร์ ลูกค้าส่วนใหญ่เป็นนิสิตและคนทำงานย่านสามย่าน (ตัวอย่างสมมติ)',
    challengeBrief: 'ปีนี้ยอดขายรวมเพิ่มขึ้น แต่กำไรกลับลดลง เจ้าของอยากรู้ว่าเงินรั่วไปตรงไหน และควรแก้อะไรก่อนใน 3 เดือนข้างหน้า',
    stages: [1, 3, 5, 6],
    booklet: [
      { title: 'ภาพรวมกิจการ', body: 'เปิดมา 6 ปี สาขาแรกที่บรรทัดทอง สาขาที่สองที่จามจุรีสแควร์เปิดเมื่อ 14 เดือนก่อน เมนูหลักคือโยเกิร์ตปั่น 3 ขนาด (S 55 บาท, M 65 บาท, L 79 บาท) โยเกิร์ตหมักเองวันต่อวัน เก็บได้ไม่เกิน 2 วัน' },
      { title: 'สิ่งที่เจ้าของสังเกต', body: 'ช่วงบ่าย 14:00–17:00 ที่สาขาจามจุรีมีโยเกิร์ตเหลือทิ้งบ่อย พนักงานบอกว่าลูกค้าช่วงบ่ายสั่งแก้ว L น้อยลงเพราะคิดว่าแพง ส่วนสาขาบรรทัดทองขายหมดก่อนเย็นบ่อยครั้ง' },
      { title: 'ข้อจำกัด', body: 'ไม่มีงบปรับปรุงร้านเกิน 50,000 บาทในไตรมาสนี้ พนักงานมีสาขาละ 3 คน เจ้าของไม่อยากลดคุณภาพวัตถุดิบ' },
    ],
    dataRoom: [
      {
        name: 'ยอดขายรายเดือน (แก้ว)',
        columns: ['เดือน', 'บรรทัดทอง', 'จามจุรี', 'รวม'],
        rows: [
          ['ม.ค.', 2400, 1900, 4300],
          ['ก.พ.', 2450, 2100, 4550],
          ['มี.ค.', 2500, 2300, 4800],
          ['เม.ย.', 2380, 2450, 4830],
        ],
      },
      {
        name: 'ของเสียต่อสาขา (% ของโยเกิร์ตที่หมัก)',
        columns: ['เดือน', 'บรรทัดทอง', 'จามจุรี'],
        rows: [
          ['ม.ค.', '4%', '11%'],
          ['ก.พ.', '5%', '14%'],
          ['มี.ค.', '4%', '17%'],
          ['เม.ย.', '5%', '18%'],
        ],
        note: 'ของเสียจามจุรีส่วนใหญ่เกิดช่วง 14:00–17:00',
      },
      {
        name: 'สัดส่วนขนาดแก้ว (เม.ย.)',
        columns: ['ขนาด', 'บรรทัดทอง', 'จามจุรี'],
        rows: [
          ['S', '30%', '52%'],
          ['M', '45%', '38%'],
          ['L', '25%', '10%'],
        ],
      },
    ],
    personas: [
      {
        key: 'owner',
        name: 'คุณสุดา · เจ้าของร้าน',
        role: 'owner',
        intro: 'ถามได้เรื่องประวัติร้าน เป้าหมาย และข้อจำกัด',
        facts: [
          { keywords: ['เป้าหมาย', 'อยากได้', 'goal'], answer: 'อยากให้กำไรกลับมาเท่าปีก่อนภายใน 3 เดือน โดยไม่ลดคุณภาพโยเกิร์ต' },
          { keywords: ['งบ', 'เงินลงทุน', 'budget'], answer: 'ไตรมาสนี้มีงบปรับปรุงไม่เกิน 50,000 บาท' },
          { keywords: ['สาขา', 'จามจุรี', 'เปิด'], answer: 'จามจุรีเปิดมา 14 เดือน ค่าเช่าสูงกว่าบรรทัดทองประมาณ 1.5 เท่า' },
          { keywords: ['ราคา', 'ขึ้นราคา', 'แพง'], answer: 'ไม่ได้ขึ้นราคามา 2 ปีแล้ว แต่กลัวลูกค้านิสิตหาย' },
        ],
      },
      {
        key: 'ops',
        name: 'พี่ต้น · ผู้จัดการสาขาจามจุรี',
        role: 'ops',
        intro: 'ถามได้เรื่องการผลิต ของเสีย และตารางงาน',
        facts: [
          { keywords: ['ของเสีย', 'ทิ้ง', 'เหลือ', 'waste'], answer: 'หมักโยเกิร์ตทีเดียวตอนเช้าเท่ากันทุกวัน ช่วงบ่ายเหลือเยอะเพราะลูกค้าน้อย ต้องทิ้งตอนปิดร้าน' },
          { keywords: ['หมัก', 'ผลิต', 'รอบ'], answer: 'ตอนนี้หมักรอบเดียว 06:00 ถ้าจะหมักสองรอบต้องมีคนเข้าเช้ากับบ่าย' },
          { keywords: ['พนักงาน', 'คน', 'กะ'], answer: 'มี 3 คน กะเช้า 2 กะบ่าย 1' },
          { keywords: ['บ่าย', 'ช่วงเวลา'], answer: 'ช่วง 14:00–17:00 ลูกค้าน้อยสุด ส่วนใหญ่สั่งแก้ว S' },
        ],
      },
      {
        key: 'marketing',
        name: 'น้องแพร · ดูแลเพจร้าน',
        role: 'marketing',
        intro: 'ถามได้เรื่องลูกค้า โปรโมชัน และรีวิว',
        facts: [
          { keywords: ['ลูกค้า', 'กลุ่ม', 'ใคร'], answer: 'ช่วงเช้าเป็นคนทำงาน ช่วงบ่ายเป็นนิสิตที่มาเป็นกลุ่ม' },
          { keywords: ['โปร', 'ส่วนลด', 'promotion'], answer: 'เคยทำโปรซื้อ 2 แก้วลด 10 บาทแล้วยอดบ่ายเพิ่มราว 15% แต่เลิกเพราะกลัวขาดทุน' },
          { keywords: ['รีวิว', 'ความเห็น'], answer: 'รีวิวบอกว่าอร่อยแต่แก้ว L แพงไป' },
        ],
      },
    ],
    finance: { unit: 'แก้ว', basePrice: 65, baseUnitsPerMonth: 4830, unitCost: 26, fixedCostPerMonth: 95000, wagePerStaff: 13000, unitsPerStaff: 900, priceElasticity: -1.3, marketingLift: 0.25, baseHeadcount: 6, baseMarketing: 5000 },
    questions: [
      { id: 'q1', q: 'อะไรคือต้นเหตุหลักที่ทำให้กำไรลดทั้งที่ยอดขายเพิ่ม' },
      { id: 'q2', q: 'ถ้าทำได้เพียงหนึ่งอย่างใน 3 เดือน ควรทำอะไร และจะวัดผลอย่างไร' },
    ],
    criteria: COMMON_CRITERIA,
  },
  {
    id: 'case_hostel',
    org: 'org_hostel',
    owner: 'u_owner2',
    track: 'sme',
    smeGroup: 'nonfood_services',
    subCategory: 'Tourism & Hospitality',
    industry: 'hospitality',
    province: 'กรุงเทพมหานคร',
    title: 'โฮสเทล “บ้านริมคลอง” · 24 เตียง',
    teaser: 'โฮสเทลเล็กริมคลองในย่านเมืองเก่า ลูกค้าเป็นนักท่องเที่ยวต่างชาติแบบแบ็กแพ็ก (ตัวอย่างสมมติ)',
    challengeBrief: 'วันธรรมดาห้องว่างเกินครึ่ง แต่สุดสัปดาห์เต็มจนต้องปฏิเสธลูกค้า เจ้าของอยากเพิ่มรายได้วันธรรมดาโดยไม่ต้องลดราคาทั้งสัปดาห์',
    stages: [1, 3, 5, 6],
    booklet: [
      { title: 'ภาพรวมกิจการ', body: 'มี 24 เตียง ราคาเฉลี่ย 450 บาท/คืน ลูกค้า 80% จองผ่านแพลตฟอร์มออนไลน์ซึ่งคิดค่าธรรมเนียม 18%' },
      { title: 'สิ่งที่เจ้าของสังเกต', body: 'อัตราเข้าพักวันธรรมดา 42% สุดสัปดาห์ 96% ลูกค้าวันธรรมดาส่วนใหญ่พัก 1 คืน' },
    ],
    dataRoom: [
      { name: 'อัตราเข้าพัก (%)', columns: ['วัน', 'อัตรา'], rows: [['จ.–พฤ.', '42%'], ['ศ.', '78%'], ['ส.–อา.', '96%']] },
      { name: 'ช่องทางจอง', columns: ['ช่องทาง', 'สัดส่วน', 'ค่าธรรมเนียม'], rows: [['แพลตฟอร์ม OTA', '80%', '18%'], ['จองตรง', '20%', '0%']] },
    ],
    personas: [
      {
        key: 'owner',
        name: 'คุณเอก · เจ้าของโฮสเทล',
        role: 'owner',
        intro: 'ถามได้เรื่องราคาและเป้าหมาย',
        facts: [
          { keywords: ['ราคา', 'ลดราคา'], answer: 'ไม่อยากลดราคาทั้งสัปดาห์ เพราะสุดสัปดาห์เต็มอยู่แล้ว' },
          { keywords: ['เป้าหมาย', 'อยากได้'], answer: 'อยากให้วันธรรมดาเข้าพักอย่างน้อย 60%' },
        ],
      },
    ],
    finance: { unit: 'คืน-เตียง', basePrice: 450, baseUnitsPerMonth: 380, unitCost: 90, fixedCostPerMonth: 110000, wagePerStaff: 14000, unitsPerStaff: 250, priceElasticity: -1.1, marketingLift: 0.3, baseHeadcount: 3, baseMarketing: 3000 },
    questions: [
      { id: 'q1', q: 'ทำไมวันธรรมดาจึงว่าง และกลุ่มลูกค้าไหนที่ยังไม่ได้เข้าถึง' },
      { id: 'q2', q: 'เสนอหนึ่งแผนเพิ่มรายได้วันธรรมดา พร้อมตัวเลขที่คาดว่าจะได้' },
    ],
    criteria: COMMON_CRITERIA,
  },
  {
    id: 'case_community',
    org: 'org_community',
    owner: 'u_owner',
    track: 'community',
    smeGroup: null,
    subCategory: 'ย่านประวัติศาสตร์ / ขนมไทย',
    industry: 'community_food',
    province: 'กรุงเทพมหานคร',
    title: 'กลุ่มขนมไทยชุมชนตลาดเก่า',
    teaser: 'ชุมชนตลาดเก่าที่เคยรุ่งเรือง มีโรงละครเก่าและขนมไทยโบราณที่ทำกันมาหลายรุ่น (ตัวอย่างสมมติ)',
    challengeBrief: 'คนทำขนมรุ่นใหม่ลดลง ลูกค้าส่วนใหญ่เป็นคนในชุมชน อยากให้ขนมเป็นที่รู้จักโดยไม่เสียความเป็นของดั้งเดิม',
    stages: [1, 4, 5],
    booklet: [{ title: 'ประวัติชุมชน', body: 'ตลาดเก่าอายุกว่า 100 ปี มีครอบครัวทำขนมไทย 7 ครอบครัว อายุเฉลี่ยคนทำขนม 58 ปี' }],
    dataRoom: [{ name: 'รายได้ต่อครอบครัว (บาท/เดือน)', columns: ['ช่วง', 'รายได้'], rows: [['ปกติ', 9000], ['เทศกาล', 21000]] }],
    personas: [
      {
        key: 'elder',
        name: 'ป้าจันทร์ · คนทำขนมรุ่นที่ 3',
        role: 'community',
        intro: 'ถามได้เรื่องสูตร ประวัติ และคนรุ่นใหม่',
        facts: [
          { keywords: ['สูตร', 'ขนม'], answer: 'สูตรไม่เคยจดเป็นตัวหนังสือ สอนกันด้วยการทำให้ดู' },
          { keywords: ['รุ่นใหม่', 'ลูกหลาน'], answer: 'ลูกหลานไปทำงานในเมือง กลับมาช่วยแค่ช่วงเทศกาล' },
        ],
      },
    ],
    finance: { unit: 'กล่อง', basePrice: 60, baseUnitsPerMonth: 600, unitCost: 22, fixedCostPerMonth: 8000, wagePerStaff: 6000, unitsPerStaff: 250, priceElasticity: -0.8, marketingLift: 0.35, baseHeadcount: 3, baseMarketing: 0 },
    questions: [
      { id: 'q1', q: 'ชุมชนมีทุนอะไรอยู่แล้วที่ยังไม่ได้ใช้' },
      { id: 'q2', q: 'เสนอหนึ่งแนวทางที่ชุมชนเป็นเจ้าของเอง พร้อมวิธีขอความยินยอม' },
    ],
    criteria: [
      { key: 'structure', name: 'แยกอาการกับต้นเหตุ', stage: 1, cues: ['ต้นเหตุ|สาเหตุ|เพราะ'] },
      { key: 'empathy', name: 'รับฟังผู้มีส่วนได้ส่วนเสีย', stage: 4, cues: ['ป้า|ชาวบ้าน|สัมภาษณ์|ชุมชน'] },
      { key: 'options', name: 'ประเมินทางเลือกและผลกระทบ', stage: 5, cues: ['ทางเลือก|ผลกระทบ|ความเสี่ยง|ยินยอม'] },
    ],
  },
];
