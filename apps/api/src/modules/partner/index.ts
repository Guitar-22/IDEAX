/** Gate 3 · เจ้าของโจทย์ / ทีมผลิตเคส / ผู้เชี่ยวชาญ / กรรมการ — case production and evaluation */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSET_MARKINGS, PASS_BAND, SME_GROUPS, type CaseStatus } from '@ideax/contracts';
import type { Deps } from '../../app.js';
import type { Queryable } from '../../db/index.js';
import { audit, trace } from '../../core/audit.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { actorOf, parse, requireRole, requireUser, type UserRow } from '../../core/http.js';
import { newId } from '../../core/ids.js';
import { getCase, releaseCaseRound, type CaseRow } from '../thaitern/service.js';
import { anonymize, parseCsv } from './anonymize.js';

/** SME reading quota per ISO week (interview: 2–3 works per week, plan p.41). */
export const OWNER_WEEKLY_READS = 3;

const DEFAULT_CRITERIA = {
  sme: [
    { key: 'structure', name: 'แยกอาการกับต้นเหตุ', stage: 1, cues: ['ต้นเหตุ|สาเหตุ|root cause|เพราะ'] },
    { key: 'data', name: 'ใช้ข้อมูลจริงเป็นหลักฐาน', stage: 3, cues: ['ข้อมูล|ยอดขาย|%|ต้นทุน|อัตรา'] },
    { key: 'options', name: 'ประเมินทางเลือกและความเสี่ยง', stage: 5, cues: ['ทางเลือก|เปรียบเทียบ|ความเสี่ยง'] },
    { key: 'finance', name: 'เหตุผลเชิงการเงิน', stage: 6, cues: ['กำไร|จุดคุ้มทุน|ราคา|บาท'] },
  ],
  community: [
    { key: 'structure', name: 'แยกอาการกับต้นเหตุ', stage: 1, cues: ['ต้นเหตุ|สาเหตุ|เพราะ'] },
    { key: 'empathy', name: 'รับฟังผู้มีส่วนได้ส่วนเสีย', stage: 4, cues: ['ชาวบ้าน|สัมภาษณ์|ชุมชน'] },
    { key: 'options', name: 'ประเมินทางเลือกและผลกระทบ', stage: 5, cues: ['ทางเลือก|ผลกระทบ|ความเสี่ยง|ยินยอม'] },
  ],
};

function isoWeekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

export function registerPartner(app: FastifyInstance, deps: Deps) {
  const { db, clock } = deps;

  async function caseAccess(u: UserRow, caseId: string, roles: string[]): Promise<CaseRow> {
    const c = await getCase(db, caseId);
    if (!roles.includes(u.role)) throw forbidden();
    if (u.role === 'case_owner' && u.org_id !== c.org_id) throw forbidden('เคสนี้ไม่ใช่ของกิจการคุณ');
    return c;
  }

  async function move(q: Queryable, c: CaseRow, next: CaseStatus, u: UserRow, cid: string, reason: string, extra: Record<string, unknown> = {}) {
    const sets = Object.keys(extra).map((k, i) => `${k} = $${i + 3}`);
    await q.query(`update cases set status = $2${sets.length ? ', ' + sets.join(', ') : ''} where id = $1`, [c.id, next, ...Object.values(extra)]);
    await audit(q, { cid, actor: actorOf(u), object: `Case · ${c.title}`, prev: c.status, next, reason });
    await trace(q, { cid, actorId: u.id, type: `case.${next.toLowerCase()}`, context: { kind: 'case', id: c.id }, caseId: c.id, payload: { reason } });
  }

  function requireStatus(c: CaseRow, allowed: CaseStatus[]) {
    if (!allowed.includes(c.status as CaseStatus)) throw conflict('WRONG_CASE_STATUS', `ทำรายการนี้ไม่ได้ในสถานะ ${c.status}`, { status: c.status, allowed });
  }

  /* ───────────── production pipeline (docs §6) ───────────── */

  app.get('/v1/partner/cases', async (req) => {
    const u = requireRole(req, 'case_owner', 'case_ops', 'case_reviewer', 'judge', 'platform_admin');
    const rows = await db.query(
      `select c.id, c.title, c.track, c.sme_group, c.sub_category, c.status, c.published_at, c.suspended_at, o.name as org_name, rv.name as reviewed_by_name,
              (select count(*)::int from attempts a where a.case_id = c.id) as attempts,
              (select count(*)::int from attempt_submissions s join attempts a on a.id = s.attempt_id where a.case_id = c.id) as submissions
       from cases c join organizations o on o.id = c.org_id left join users rv on rv.id = c.reviewed_by
       where ($1::text is null or c.org_id = $1) order by c.created_at desc`,
      [u.role === 'case_owner' ? u.org_id : null],
    );
    return { cases: rows };
  });

  app.post('/v1/partner/cases', async (req, reply) => {
    const u = requireRole(req, 'case_ops');
    const b = parse(
      z.object({
        orgId: z.string(),
        track: z.enum(['sme', 'community']),
        smeGroup: z.enum(Object.keys(SME_GROUPS) as [string, ...string[]]).nullable().optional(),
        subCategory: z.string().min(1),
        industry: z.string().min(1),
        province: z.string().optional(),
        title: z.string().min(1),
        teaser: z.string().min(1),
        challengeBrief: z.string().min(1),
        stages: z.array(z.number().int().min(1).max(7)).min(1),
        takedownDays: z.number().int().min(1).max(60).default(7),
      }),
      req.body,
    );
    const [org] = await db.query('select * from organizations where id = $1', [b.orgId]);
    if (!org) throw notFound('องค์กรเจ้าของโจทย์');
    const id = newId('case');
    await db.tx(async (q) => {
      await q.query(
        `insert into cases(id, org_id, track, sme_group, sub_category, industry, province, title, teaser, challenge_brief, status, stages, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'INTAKE', $11, $12)`,
        [id, b.orgId, b.track, b.smeGroup ?? null, b.subCategory, b.industry, b.province ?? null, b.title, b.teaser, b.challengeBrief, b.stages, clock.now()],
      );
      await q.query('insert into data_agreements(id, case_id, org_id, takedown_days) values ($1, $2, $3, $4)', [newId('agr'), id, b.orgId, b.takedownDays]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Case · ${b.title}`, prev: '-', next: 'INTAKE', reason: `org=${org.name} · agreement unsigned` });
    });
    return reply.status(201).send({ id, status: 'INTAKE' });
  });

  app.get('/v1/partner/cases/:id', async (req) => {
    const u = requireUser(req);
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner', 'case_ops', 'case_reviewer', 'judge', 'platform_admin']);
    const [agreement] = await db.query('select * from data_agreements where case_id = $1', [c.id]);
    const assets = await db.query('select id, kind, name, content, anonymized_content, markings, usable_until, created_at from case_assets where case_id = $1 order by created_at', [c.id]);
    const [latest] = await db.query('select id, version_no, created_at from case_versions where case_id = $1 order by version_no desc limit 1', [c.id]);
    const [rv] = c.reviewed_by ? await db.query('select name from users where id = $1', [c.reviewed_by]) : [null];
    return { case: { ...c, reviewed_by_name: rv?.name ?? null }, agreement, assets, latestVersion: latest ?? null };
  });

  /** Owner signs the data licence (plan appendix C). Nothing can be delivered before this. */
  app.post('/v1/partner/cases/:id/agreement/sign', async (req) => {
    const u = requireRole(req, 'case_owner');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner']);
    await db.tx(async (q) => {
      await q.query('update data_agreements set signed_by = $2, signed_at = $3 where case_id = $1 and signed_at is null', [c.id, u.id, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `DataAgreement · ${c.title}`, prev: 'UNSIGNED', next: 'SIGNED', reason: 'owner e-sign · term 10 years' });
    });
    return { signed: true };
  });

  app.post('/v1/partner/cases/:id/assets', async (req, reply) => {
    const u = requireRole(req, 'case_owner', 'case_ops');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner', 'case_ops']);
    requireStatus(c, ['INTAKE', 'ANONYMIZING']);
    const [agr] = await db.query('select signed_at from data_agreements where case_id = $1', [c.id]);
    if (!agr?.signed_at) throw unprocessable('AGREEMENT_REQUIRED', 'ต้องลงนามข้อตกลงอนุญาตใช้ข้อมูลก่อนส่งข้อมูล');
    const b = parse(
      z.object({
        kind: z.enum(['brief', 'audio_transcript', 'data', 'persona', 'finance', 'question', 'other']),
        name: z.string().min(1),
        content: z.string().min(1).max(200_000),
        markings: z.array(z.enum(ASSET_MARKINGS)).default([]),
        usableUntil: z.string().date().optional(),
      }),
      req.body,
    );
    const id = newId('ast');
    await db.tx(async (q) => {
      await q.query('insert into case_assets(id, case_id, kind, name, content, markings, usable_until, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [id, c.id, b.kind, b.name, b.content, b.markings, b.usableUntil ?? null, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `CaseAsset · ${c.title} · ${b.name}`, next: 'RECEIVED', reason: `markings=${b.markings.join(',') || '-'}` });
    });
    return reply.status(201).send({ id });
  });

  app.post('/v1/partner/cases/:id/anonymize', async (req) => {
    const u = requireRole(req, 'case_ops');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_ops']);
    requireStatus(c, ['INTAKE', 'ANONYMIZING']);
    const { maskTerms } = parse(z.object({ maskTerms: z.array(z.string()).default([]) }), req.body ?? {});
    const assets = await db.query<{ id: string; content: string }>('select id, content from case_assets where case_id = $1', [c.id]);
    if (!assets.length) throw unprocessable('NO_ASSETS', 'ยังไม่มีข้อมูลจากเจ้าของโจทย์');
    let replaced = 0;
    await db.tx(async (q) => {
      for (const a of assets) {
        const r = anonymize(a.content, [...c.mask_terms, ...maskTerms]);
        replaced += r.replaced;
        await q.query('update case_assets set anonymized_content = $2 where id = $1', [a.id, r.text]);
      }
      await q.query('update cases set mask_terms = $2 where id = $1', [c.id, [...new Set([...c.mask_terms, ...maskTerms])]]);
      await move(q, c, 'ANONYMIZING', u, req.cid, `ปกปิด ${replaced} จุด · รอตรวจโดยคน`);
    });
    return { replaced, status: 'ANONYMIZING' };
  });

  /** Assemble the learner package from anonymized assets. Assets marked no_learner, pii or expired never enter it. */
  app.post('/v1/partner/cases/:id/draft', async (req) => {
    const u = requireRole(req, 'case_ops');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_ops']);
    requireStatus(c, ['ANONYMIZING', 'DRAFTING']);
    const today = clock.now().toISOString().slice(0, 10);
    const assets = await db.query<{ kind: string; name: string; anonymized_content: string | null; markings: string[]; usable_until: string | null }>(
      'select kind, name, anonymized_content, markings, usable_until::text from case_assets where case_id = $1 order by created_at',
      [c.id],
    );
    if (assets.some((a) => a.anonymized_content === null)) throw unprocessable('NOT_ANONYMIZED', 'ยังมีข้อมูลที่ยังไม่ผ่านการปกปิดตัวตน');
    const usable = assets.filter((a) => !a.markings.includes('no_learner') && !a.markings.includes('pii') && !(a.usable_until && a.usable_until < today));
    const excluded = assets.length - usable.length;
    const booklet = usable.filter((a) => a.kind === 'brief' || a.kind === 'other').map((a) => ({ title: a.name, body: a.anonymized_content! }));
    for (const a of usable.filter((x) => x.kind === 'audio_transcript')) booklet.push({ title: `Founder Audio Briefing · ${a.name} (บทถอดความ)`, body: a.anonymized_content! });
    const dataRoom = usable.filter((a) => a.kind === 'data').map((a) => ({ name: a.name, ...parseCsv(a.anonymized_content!) }));
    const personas = usable.filter((a) => a.kind === 'persona').flatMap((a) => {
      try {
        return [JSON.parse(a.anonymized_content!)];
      } catch {
        throw unprocessable('BAD_PERSONA', `ข้อมูลตัวละคร “${a.name}” ต้องเป็น JSON`);
      }
    });
    const financeAsset = usable.find((a) => a.kind === 'finance');
    const finance = financeAsset ? JSON.parse(financeAsset.anonymized_content!) : null;
    const questions = usable.filter((a) => a.kind === 'question').flatMap((a) => a.anonymized_content!.split('\n').map((t) => t.trim()).filter(Boolean)).map((q, i) => ({ id: `q${i + 1}`, q }));
    if (!booklet.length || !questions.length || !finance) throw unprocessable('DRAFT_INCOMPLETE', 'ต้องมีอย่างน้อย brief, คำถามของเจ้าของโจทย์ และข้อมูลการเงิน', { booklet: booklet.length, questions: questions.length, finance: !!finance });
    const [{ n }] = await db.query<{ n: number }>('select coalesce(max(version_no), 0)::int as n from case_versions where case_id = $1', [c.id]);
    await db.tx(async (q) => {
      await q.query(
        'insert into case_versions(id, case_id, version_no, booklet, data_room, personas, finance, questions, criteria) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [newId('cv'), c.id, n + 1, JSON.stringify(booklet), JSON.stringify(dataRoom), JSON.stringify(personas), JSON.stringify(finance), JSON.stringify(questions), JSON.stringify(DEFAULT_CRITERIA[c.track])],
      );
      await move(q, c, 'EXPERT_REVIEW', u, req.cid, `draft v${n + 1} · ใช้ ${usable.length} ไฟล์ · กันออก ${excluded} ไฟล์ (no_learner/pii/หมดอายุ)`);
    });
    return { versionNo: n + 1, pages: booklet.length, dataRoom: dataRoom.length, personas: personas.length, questions: questions.length, excluded };
  });

  /** Learner-facing preview for owner/reviewer: exactly what learners will see. */
  app.get('/v1/partner/cases/:id/preview', async (req) => {
    const u = requireUser(req);
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner', 'case_ops', 'case_reviewer']);
    const [v] = await db.query('select * from case_versions where case_id = $1 order by version_no desc limit 1', [c.id]);
    if (!v) throw notFound('ร่าง Case Booklet');
    return { teaser: c.teaser, challengeBrief: c.challenge_brief, versionNo: v.version_no, booklet: v.booklet, dataRoom: v.data_room, personas: v.personas.map((p: any) => ({ name: p.name, intro: p.intro })), questions: v.questions };
  });

  app.post('/v1/partner/cases/:id/expert-review', async (req) => {
    const u = requireRole(req, 'case_reviewer');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_reviewer']);
    requireStatus(c, ['EXPERT_REVIEW']);
    const b = parse(z.object({ decision: z.enum(['approve', 'revise']), notes: z.string().min(1).max(2000) }), req.body);
    await db.tx(async (q) => {
      if (b.decision === 'approve') await move(q, c, 'OWNER_APPROVAL', u, req.cid, `expert approved: ${b.notes}`, { reviewed_by: u.id, reviewed_at: clock.now(), review_notes: b.notes });
      else await move(q, c, 'DRAFTING', u, req.cid, `expert asks for changes: ${b.notes}`, { review_notes: b.notes });
    });
    return { status: b.decision === 'approve' ? 'OWNER_APPROVAL' : 'DRAFTING' };
  });

  app.post('/v1/partner/cases/:id/owner-approval', async (req) => {
    const u = requireRole(req, 'case_owner');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner']);
    requireStatus(c, ['OWNER_APPROVAL']);
    if (!c.reviewed_by) throw unprocessable('EXPERT_REVIEW_REQUIRED', 'ผู้เชี่ยวชาญต้องตรวจเคสก่อนเผยแพร่ (TX-17)');
    const b = parse(z.object({ approve: z.boolean(), notes: z.string().max(2000).default('') }), req.body);
    const now = clock.now();
    await db.tx(async (q) => {
      if (b.approve) await move(q, c, 'PUBLISHED', u, req.cid, `owner_approved ${b.notes}`.trim(), { approved_at: now, published_at: now });
      else await move(q, c, 'DRAFTING', u, req.cid, `owner asks for changes: ${b.notes}`);
    });
    return { status: b.approve ? 'PUBLISHED' : 'DRAFTING' };
  });

  /** Takedown (appendix C §10): no new unlocks; attempts already under way continue this round. */
  app.post('/v1/partner/cases/:id/takedown', async (req) => {
    const u = requireRole(req, 'case_owner');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner']);
    requireStatus(c, ['PUBLISHED']);
    const { reason } = parse(z.object({ reason: z.string().min(1) }), req.body);
    const running = (await db.query<{ n: number }>(`select count(*)::int as n from attempts where case_id = $1 and state in ('IN_PROGRESS', 'PUSHBACK', 'FINALIZING')`, [c.id]))[0].n;
    await db.tx(async (q) => move(q, c, 'SUSPENDED', u, req.cid, `owner takedown: ${reason} · ${running} ทีมที่เริ่มแล้วทำต่อได้ถึงจบรอบ`, { suspended_at: clock.now() }));
    return { status: 'SUSPENDED', runningAttempts: running };
  });

  app.post('/v1/partner/cases/:id/reinstate', async (req) => {
    const u = requireRole(req, 'case_owner');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner']);
    requireStatus(c, ['SUSPENDED']);
    await db.tx(async (q) => move(q, c, 'PUBLISHED', u, req.cid, 'owner reinstated', { suspended_at: null }));
    return { status: 'PUBLISHED' };
  });

  app.post('/v1/partner/cases/:id/retire', async (req) => {
    const u = requireRole(req, 'case_ops');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_ops']);
    requireStatus(c, ['PUBLISHED', 'SUSPENDED']);
    await db.tx(async (q) => {
      // appendix C §11: stop using the data; keep only what the law requires
      await q.query(`update case_assets set content = '[ลบตามข้อตกลงสิ้นสุด]', anonymized_content = null where case_id = $1`, [c.id]);
      await move(q, c, 'RETIRED', u, req.cid, 'agreement ended · raw data destroyed');
    });
    return { status: 'RETIRED' };
  });

  /* ───────────── evaluation (docs §8) ───────────── */

  async function submissionRow(id: string) {
    const [s] = await db.query<any>(
      `select s.*, a.case_id, a.canvas, a.team_id, a.case_version_id, t.name as team_name
       from attempt_submissions s join attempts a on a.id = s.attempt_id join teams t on t.id = a.team_id where s.id = $1`,
      [id],
    );
    if (!s) throw notFound('ผลงาน');
    return s;
  }

  app.get('/v1/partner/cases/:id/submissions', async (req) => {
    const u = requireRole(req, 'judge', 'case_ops');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['judge', 'case_ops']);
    const rows = await db.query(
      `select s.id, s.receipt_id, s.received_at, s.status, s.ai_status, s.ai_bands, s.shortlisted, s.confirmed_bands, s.owner_feedback, s.sme_choice, t.name as team_name
       from attempt_submissions s join attempts a on a.id = s.attempt_id join teams t on t.id = a.team_id where a.case_id = $1 order by s.received_at`,
      [c.id],
    );
    return { case: { id: c.id, title: c.title }, submissions: rows };
  });

  /** The owner sees only screened-in works, and the weekly quota (TX-11). */
  app.get('/v1/partner/cases/:id/shortlist', async (req) => {
    const u = requireRole(req, 'case_owner');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['case_owner']);
    const since = isoWeekStart(clock.now());
    const [{ used }] = await db.query<{ used: number }>('select count(*)::int as used from owner_reads where owner_id = $1 and at >= $2', [u.id, since]);
    const rows = await db.query(
      `select s.id, s.received_at, s.owner_feedback, s.sme_choice, t.name as team_name, exists (select 1 from owner_reads r where r.owner_id = $2 and r.submission_id = s.id) as opened
       from attempt_submissions s join attempts a on a.id = s.attempt_id join teams t on t.id = a.team_id
       where a.case_id = $1 and s.shortlisted is true order by s.received_at`,
      [c.id, u.id],
    );
    return { case: { id: c.id, title: c.title }, quota: { perWeek: OWNER_WEEKLY_READS, used, left: Math.max(0, OWNER_WEEKLY_READS - used) }, submissions: rows };
  });

  app.get('/v1/partner/submissions/:id', async (req) => {
    const u = requireRole(req, 'case_owner', 'judge', 'case_ops');
    const s = await submissionRow((req.params as { id: string }).id);
    await caseAccess(u, s.case_id, ['case_owner', 'judge', 'case_ops']);
    if (u.role === 'case_owner') {
      if (s.shortlisted !== true) throw forbidden('เจ้าของโจทย์อ่านได้เฉพาะผลงานที่ผ่านการคัดกรอง');
      const seen = await db.query('select 1 from owner_reads where owner_id = $1 and submission_id = $2', [u.id, s.id]);
      if (!seen.length) {
        const [{ used }] = await db.query<{ used: number }>('select count(*)::int as used from owner_reads where owner_id = $1 and at >= $2', [u.id, isoWeekStart(clock.now())]);
        if (used >= OWNER_WEEKLY_READS) throw new AppError(429, 'WEEKLY_QUOTA', `อ่านครบ ${OWNER_WEEKLY_READS} ผลงานของสัปดาห์นี้แล้ว ผลงานที่เหลือจะเปิดให้สัปดาห์หน้า`);
        await db.query('insert into owner_reads(owner_id, submission_id, at) values ($1, $2, $3)', [u.id, s.id, clock.now()]);
      }
    }
    const [cv] = await db.query('select questions, criteria from case_versions where id = $1', [s.case_version_id]);
    return {
      id: s.id,
      team: s.team_name,
      receivedAt: s.received_at,
      status: s.status,
      summary: s.summary,
      answers: cv.questions.map((q: any) => ({ ...q, answer: s.answers[q.id] ?? '' })),
      canvas: s.canvas,
      aiBands: s.ai_bands, // shown in blue: a proposal, not a result
      aiStatus: s.ai_status,
      criteria: cv.criteria.map(({ key, name, stage }: any) => ({ key, name, stage })),
      confirmedBands: s.confirmed_bands,
      ownerFeedback: s.owner_feedback,
      judgeFeedback: s.judge_feedback,
      smeChoice: s.sme_choice,
    };
  });

  /** AI drafts feedback following the guide; a human edits and sends it. */
  app.post('/v1/partner/submissions/:id/feedback-draft', async (req) => {
    const u = requireRole(req, 'case_owner', 'judge');
    const s = await submissionRow((req.params as { id: string }).id);
    await caseAccess(u, s.case_id, ['case_owner', 'judge']);
    const bands: Array<{ key: string; band: number; why: string }> = s.ai_bands ?? [];
    const strong = bands.filter((b) => b.band >= PASS_BAND).map((b) => b.why);
    const weak = bands.filter((b) => b.band < PASS_BAND).map((b) => b.why);
    const draft = [
      'ขอบคุณที่ตั้งใจทำโจทย์ของเรา',
      strong.length ? `สิ่งที่ทำได้ดี: ${strong.join(' · ')}` : '',
      weak.length ? `สิ่งที่อยากให้พัฒนาต่อ: ${weak.join(' · ')}` : '',
      'ข้อเสนอแนะนี้เป็นมุมมองของเจ้าของกิจการ ไม่ใช่คะแนนสอบ',
    ].filter(Boolean).join('\n');
    return { draft, proposed: true, guide: ['เริ่มจากสิ่งที่ทำได้ดี', 'ชี้สิ่งที่พัฒนาได้พร้อมเหตุผล', 'ไม่วิจารณ์ตัวบุคคล', 'ไม่เปิดเผยข้อมูลลับเพิ่ม'] };
  });

  app.post('/v1/partner/submissions/:id/owner-feedback', async (req) => {
    const u = requireRole(req, 'case_owner');
    const s = await submissionRow((req.params as { id: string }).id);
    await caseAccess(u, s.case_id, ['case_owner']);
    if (s.shortlisted !== true) throw forbidden('ให้ Feedback ได้เฉพาะผลงานที่ผ่านการคัดกรอง');
    if (s.status === 'RELEASED') throw conflict('ALREADY_RELEASED', 'ปล่อยผลแล้ว');
    const b = parse(z.object({ feedback: z.string().min(20).max(4000), smeChoice: z.boolean().default(false) }), req.body);
    await db.tx(async (q) => {
      await q.query('update attempt_submissions set owner_feedback = $2, owner_feedback_by = $3, sme_choice = $4 where id = $1', [s.id, b.feedback, u.id, b.smeChoice]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `OwnerFeedback · ${s.team_name}`, next: b.smeChoice ? "SME'S_CHOICE" : 'FEEDBACK_GIVEN', reason: `${b.feedback.length} chars` });
    });
    return { saved: true };
  });

  /** Judges confirm or change the AI bands. The human value is what counts. */
  app.post('/v1/partner/submissions/:id/confirm', async (req) => {
    const u = requireRole(req, 'judge');
    const s = await submissionRow((req.params as { id: string }).id);
    await caseAccess(u, s.case_id, ['judge']);
    if (s.status === 'RELEASED') throw conflict('ALREADY_RELEASED', 'ปล่อยผลแล้ว');
    if (s.status === 'RECEIVED') throw conflict('NOT_SCREENED', 'รอคัดกรองก่อน');
    const b = parse(z.object({ bands: z.array(z.object({ key: z.string(), band: z.number().int().min(1).max(4), reason: z.string().max(500).optional() })), feedback: z.string().min(20).max(4000) }), req.body);
    const [cv] = await db.query<{ criteria: Array<{ key: string; stage: number }> }>('select criteria from case_versions where id = $1', [s.case_version_id]);
    const keys = cv.criteria.map((c) => c.key).sort();
    if (JSON.stringify(b.bands.map((x) => x.key).sort()) !== JSON.stringify(keys)) throw unprocessable('BANDS_INCOMPLETE', 'ต้องยืนยันครบทุกเกณฑ์', { expected: keys });
    const ai: Record<string, number> = Object.fromEntries((s.ai_bands ?? []).map((x: any) => [x.key, x.band]));
    const changedWithoutReason = b.bands.filter((x) => ai[x.key] !== undefined && ai[x.key] !== x.band && !x.reason?.trim());
    if (changedWithoutReason.length) throw unprocessable('REASON_REQUIRED', 'ระดับต่างจากที่ระบบเสนอ ต้องระบุเหตุผล', { keys: changedWithoutReason.map((x) => x.key) });
    const confirmed = b.bands.map((x) => ({ key: x.key, band: x.band, stage: cv.criteria.find((c) => c.key === x.key)!.stage }));
    await db.tx(async (q) => {
      await q.query(`update attempt_submissions set status = 'CONFIRMED', confirmed_bands = $2, confirmed_by = $3, judge_feedback = $4 where id = $1`, [s.id, JSON.stringify(confirmed), u.id, b.feedback]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Evaluation · ${s.team_name}`, prev: `AI ${JSON.stringify(ai)}`, next: `CONFIRMED ${confirmed.map((x) => `${x.key}=${x.band}`).join(' ')}`, reason: 'human_confirmed' });
    });
    return { status: 'CONFIRMED', bands: confirmed };
  });

  /** Every team gets feedback (TX-10): release waits until all are confirmed. */
  app.post('/v1/partner/cases/:id/release', async (req) => {
    const u = requireRole(req, 'judge');
    const c = await caseAccess(u, (req.params as { id: string }).id, ['judge']);
    return releaseCaseRound(deps, { caseId: c.id, judge: actorOf(u), cid: req.cid });
  });
}
