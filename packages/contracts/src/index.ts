/**
 * Shared vocabulary between apps/api and apps/web.
 * Status values match docs/APP_FLOW.md §12. The UI colour of every status comes from TONE:
 * proposed (blue) = AI suggested, verified (green) = a human confirmed, attention (grey dashed) = not enough data.
 */
import { z } from 'zod';

/* ───────────── roles ───────────── */
export const ROLES = [
  'learner',
  'guardian',
  'thesis_mentor',
  'assistant_marker',
  'case_owner',
  'case_reviewer',
  'case_ops',
  'judge',
  'org_member',
  'platform_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  learner: 'ผู้เรียน',
  guardian: 'ผู้ปกครอง',
  thesis_mentor: 'อาจารย์',
  assistant_marker: 'ผู้ช่วยตรวจ',
  case_owner: 'เจ้าของโจทย์',
  case_reviewer: 'ผู้เชี่ยวชาญตรวจเคส',
  case_ops: 'ทีมผลิตเคส',
  judge: 'กรรมการ',
  org_member: 'องค์กร',
  platform_admin: 'ผู้ดูแลระบบ',
};

/* ───────────── tone (colour = meaning) ───────────── */
export type Tone = 'proposed' | 'verified' | 'attention' | 'neutral';

/* ───────────── rubric grades (DBA scale from the mockup) ───────────── */
export const GRADES = [
  { k: 'F', g: 0.5 },
  { k: 'D', g: 1 },
  { k: 'D+', g: 1.5 },
  { k: 'C', g: 2 },
  { k: 'C+', g: 2.5 },
  { k: 'B', g: 3 },
  { k: 'B+', g: 3.5 },
  { k: 'A', g: 4 },
] as const;
export type Grade = (typeof GRADES)[number]['k'];
export const GRADE_KEYS = GRADES.map((g) => g.k) as [Grade, ...Grade[]];
export function gradeValue(k: string | null | undefined): number | null {
  const found = GRADES.find((g) => g.k === k);
  return found ? found.g : null;
}

export const ANNOTATIONS = { U: 'unclear · เขียนไม่ชัด', D: 'more details · ขอรายละเอียดเพิ่ม', J: 'justify · ขอเหตุผลรองรับ' } as const;
export type AnnotationCode = keyof typeof ANNOTATIONS;

/* ───────────── IDEAX statuses ───────────── */
export const REVIEW_ITEM_STATUS = ['AI_PROPOSED', 'NO_PROPOSAL', 'VERIFIED', 'RETURNED_FOR_REVISION'] as const;
export type ReviewItemStatus = (typeof REVIEW_ITEM_STATUS)[number];
export const REVIEW_ITEM_TONE: Record<ReviewItemStatus, Tone> = {
  AI_PROPOSED: 'proposed',
  NO_PROPOSAL: 'attention',
  VERIFIED: 'verified',
  RETURNED_FOR_REVISION: 'attention',
};
export const REVIEW_ITEM_LABEL: Record<ReviewItemStatus, string> = {
  AI_PROPOSED: 'ระบบเสนอ',
  NO_PROPOSAL: 'ต้องให้คนดู',
  VERIFIED: 'อาจารย์ยืนยันแล้ว',
  RETURNED_FOR_REVISION: 'ส่งกลับให้แก้',
};

export const SUBMISSION_STATUS = ['SUBMITTED', 'IN_REVIEW', 'REVISION_REQUIRED', 'RESUBMITTED', 'FINALIZED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];

export const ANALYSIS_STATUS = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'ABANDONED'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUS)[number];

export const INSIGHT_GROUPS = {
  understood: 'เข้าใจดี',
  cannot_explain: 'งานดีแต่ยังอธิบายไม่ได้',
  needs_feedback: 'ควรได้ Feedback เพิ่ม',
  insufficient: 'หลักฐานยังไม่พอ',
} as const;
export type InsightGroup = keyof typeof INSIGHT_GROUPS;

/* ───────────── THAItern journey ───────────── */
export const TRACKS = { sme: 'SMEs Track', community: 'Community Track' } as const;
export type Track = keyof typeof TRACKS;

export const SME_GROUPS = {
  fnb: 'Food & Beverage',
  nonfood_products: 'Non-Food Products',
  nonfood_services: 'Non-Food Services',
} as const;
export type SmeGroup = keyof typeof SME_GROUPS;

export const ATTEMPT_STATES = [
  'CHOSEN',
  'FIRST_DRAFT',
  'LEARNING',
  'READY_TO_UNLOCK',
  'IN_PROGRESS',
  'PUSHBACK',
  'FINALIZING',
  'SUBMITTED',
  'EVALUATED',
  'CREDENTIALED',
  'EXPIRED',
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** Steps of the 14-step journey (+4a from Productive Failure), docs/APP_FLOW.md §7 */
export const JOURNEY_STEPS = [
  { key: '1', name: 'สมัครและสร้างทีม' },
  { key: '2', name: 'เลือกสิ่งที่อยากช่วย' },
  { key: '3', name: 'ระบบแนะนำ' },
  { key: '4a', name: 'ร่างคำตอบแรก' },
  { key: '4', name: 'เตรียมความรู้' },
  { key: '5', name: 'ปลดล็อก Case Booklet' },
  { key: '6', name: 'เข้าใจเจ้าของปัญหา' },
  { key: '7', name: 'Strategy Canvas' },
  { key: '8', name: 'ถูกท้าทาย' },
  { key: '9', name: 'ทดลองผลลัพธ์' },
  { key: '10', name: 'คำแนะนำจากคนจริง' },
  { key: '11', name: 'สื่อสารแบบคนทำงาน' },
  { key: '12', name: 'AI ตรวจก่อนส่ง' },
  { key: '13', name: 'รับ Feedback' },
  { key: '14', name: 'เปลี่ยนงานเป็นผลงาน' },
] as const;

export const STAGES = [
  { n: 1, name: 'Problem Structuring', th: 'วางโครงสร้างปัญหา' },
  { n: 2, name: 'Hypothesis', th: 'ตั้งสมมติฐาน' },
  { n: 3, name: 'Data Analysis', th: 'วิเคราะห์ข้อมูล' },
  { n: 4, name: 'Stakeholder Insight', th: 'เก็บข้อมูลเชิงคุณภาพ' },
  { n: 5, name: 'Option Evaluation', th: 'ประเมินทางเลือก' },
  { n: 6, name: 'Financial Reasoning', th: 'เหตุผลเชิงการเงิน' },
  { n: 7, name: 'Communication under Pressure', th: 'สื่อสารภายใต้แรงกดดัน' },
] as const;

export const SUPPORT_LEVELS = ['WATCH', 'GUIDED', 'SOLO'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const CANVAS_SECTIONS = [
  { key: 'problem', name: 'Problem', stage: 1 },
  { key: 'target', name: 'Target', stage: 4 },
  { key: 'unit_economics', name: 'Unit Economics', stage: 3 },
  { key: 'channels', name: 'Channels', stage: 5 },
  { key: 'risks', name: 'Risks', stage: 5 },
] as const;
export type CanvasSection = (typeof CANVAS_SECTIONS)[number]['key'];

/** Categorical banding instead of raw scores (plan chapter 3 · technology) */
export const BANDS = [
  { k: 1, name: 'เริ่มต้น' },
  { k: 2, name: 'กำลังพัฒนา' },
  { k: 3, name: 'ทำได้ดี' },
  { k: 4, name: 'โดดเด่น' },
] as const;
export const PASS_BAND = 3;

export const CERTIFICATE_LEVELS = { participation: 'Participation', merit: 'Merit', sme_choice: "SME's Choice" } as const;
export type CertificateLevel = keyof typeof CERTIFICATE_LEVELS;

/* ───────────── cases (Gate 3 production) ───────────── */
export const CASE_STATUS = [
  'INTAKE',
  'ANONYMIZING',
  'DRAFTING',
  'EXPERT_REVIEW',
  'OWNER_APPROVAL',
  'PUBLISHED',
  'SUSPENDED',
  'RETIRED',
] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];

export const ASSET_MARKINGS = ['confidential', 'pii', 'no_learner', 'time_bound'] as const;
export type AssetMarking = (typeof ASSET_MARKINGS)[number];

/* ───────────── publication / market ───────────── */
export const PUBLICATION_FIELDS = ['problem', 'approach', 'evidence', 'team', 'verification', 'rights'] as const;
export type PublicationField = (typeof PUBLICATION_FIELDS)[number];
/** Never allowed on a public card, whatever the owner selects */
export const FORBIDDEN_PUBLICATION_FIELDS = ['grades', 'annotations', 'internal_feedback', 'ai_proposals', 'sme_confidential'] as const;
export const VISIBILITIES = ['public', 'link', 'org'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const PUBLICATION_STATUS = ['PUBLICATION_DRAFT', 'PENDING_COAUTHORS', 'PUBLISHED', 'WITHDRAWN'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUS)[number];
export const CONTACT_STATUS = ['REQUESTED', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'DECLINED', 'EXPIRED', 'UNLOCKED'] as const;
export type ContactStatus = (typeof CONTACT_STATUS)[number];
export const ENGAGEMENT_STATUS = ['DISCUSSION', 'AGREED', 'CANCELLED', 'PAID'] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUS)[number];

/** Prices from the plan (chapter 4, table 33), in baht */
export const PRICES = { contactUnlock: 800, ideaPurchaseDefault: 500, mentorSlot: 350 } as const;
export const REVENUE_SHARE = { ideaToLearner: 0.4, mentorToMentor: 0.7 } as const;

/* ───────────── consent (plan appendix B) ───────────── */
export const CONSENTS = {
  tos: { required: true, label: 'ข้อกำหนดการใช้งาน' },
  confidentiality: { required: true, label: 'รักษาความลับข้อมูล SME / Case Booklet' },
  pdpa_ai: { required: true, label: 'ข้อมูลส่วนบุคคลและการประมวลผล Decision Trace ด้วย AI' },
  talent_matching: { required: false, label: 'ใช้ข้อมูลเพื่อจับคู่โอกาสฝึกงานหรือการทำงาน' },
  guardian: { required: false, label: 'ความยินยอมจากผู้ปกครอง (ผู้เยาว์)' },
} as const;
export type ConsentCode = keyof typeof CONSENTS;
export const CONSENT_TEXT_VERSION = '2026-09-v1';
/** The plan asks for guardian consent under 20 years old (chapter 3, SMEs Track) */
export const GUARDIAN_AGE_LIMIT = 20;

/* ───────────── request schemas ───────────── */
export const SignupBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  birthYear: z.number().int().min(1940).max(2020),
  institution: z.string().min(1).max(200),
  province: z.string().min(1).max(80),
  faculty: z.string().max(200).optional(),
  phone: z.string().min(9).max(15),
  guardianPhone: z.string().min(9).max(15).optional(),
  consents: z.array(z.enum(['tos', 'confidentiality', 'pdpa_ai', 'talent_matching'])),
});
export type SignupBody = z.infer<typeof SignupBody>;

export const DecisionBody = z.object({
  action: z.enum(['accept', 'grade', 'flag']),
  grade: z.enum(GRADE_KEYS).optional(),
  reason: z.string().max(500).optional(),
  codes: z.array(z.enum(['U', 'D', 'J'])).optional(),
  rowVersion: z.number().int(),
});
export type DecisionBody = z.infer<typeof DecisionBody>;

export const ReleaseBody = z.object({ mode: z.enum(['revise', 'finalize']), note: z.string().max(2000).optional() });

export const SubmitBody = z.object({ content: z.string().min(1), revisionNote: z.string().max(2000).optional() });
export const DisclosureBody = z.object({ tool: z.string().min(1).max(200), part: z.string().max(1000), confirmed: z.literal(true) });

export const PublicationBody = z.object({
  source: z.object({ kind: z.enum(['submission', 'attempt']), id: z.string() }),
  title: z.string().min(1).max(200),
  fields: z.record(z.string(), z.string().max(2000)),
  visibility: z.enum(VISIBILITIES),
  opportunities: z.array(z.string()).default([]),
});
export type PublicationBody = z.infer<typeof PublicationBody>;

/* ───────────── API error envelope ───────────── */
export interface ApiError {
  code: string;
  message_th: string;
  details?: unknown;
}
