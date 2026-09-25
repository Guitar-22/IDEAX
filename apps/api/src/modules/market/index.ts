/** Gate 3 · องค์กร — publication, search over the projection, contact requests, idea purchases, ledger */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FORBIDDEN_PUBLICATION_FIELDS,
  PASS_BAND,
  PRICES,
  PUBLICATION_FIELDS,
  PublicationBody,
  REVENUE_SHARE,
} from '@ideax/contracts';
import type { Deps } from '../../app.js';
import type { Queryable } from '../../db/index.js';
import { audit } from '../../core/audit.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { actorOf, parse, requireRole, requireUser, type UserRow } from '../../core/http.js';
import { newId } from '../../core/ids.js';
import { consentState } from '../consent.js';

const TIER_RULE = 'A = รับรองครบทุกเกณฑ์และผ่านการทดสอบจริง · B = รับรองอย่างน้อยครึ่งหนึ่ง · C = น้อยกว่าครึ่ง';

/**
 * Finds text copied from confidential sources. Thai has no sentence punctuation, so we compare
 * whitespace-separated clauses: one long clause (≥ 24 chars) or two medium ones (≥ 12) count as copying.
 */
export function copiedPhrases(sources: string[], text: string): string[] {
  const phrases = [...new Set(sources.flatMap((t) => t.split(/[\s,;:·]+/)).map((x) => x.trim()).filter((x) => x.length >= 12))];
  const found = phrases.filter((x) => text.includes(x));
  return found.some((x) => x.length >= 24) || found.length >= 2 ? found : [];
}

export function tierOf(verified: number, total: number, tested: boolean): 'A' | 'B' | 'C' {
  if (total > 0 && verified >= total && tested) return 'A';
  if (total > 0 && verified >= total / 2) return 'B';
  return 'C';
}

/** Double-entry split of one payment. Credits always sum to the debit. */
export function splitPayment(amountSatang: number, kind: 'contact_unlock' | 'idea_purchase', ownerId: string) {
  if (kind === 'contact_unlock') {
    return [
      { account: 'cash', side: 'debit' as const, amount: amountSatang, userId: null },
      { account: 'platform_revenue', side: 'credit' as const, amount: amountSatang, userId: null },
    ];
  }
  const learner = Math.floor(amountSatang * REVENUE_SHARE.ideaToLearner);
  return [
    { account: 'cash', side: 'debit' as const, amount: amountSatang, userId: null },
    { account: 'learner_payable', side: 'credit' as const, amount: learner, userId: ownerId },
    { account: 'platform_revenue', side: 'credit' as const, amount: amountSatang - learner, userId: null },
  ];
}

interface PubRow {
  id: string;
  owner_id: string;
  source_kind: 'submission' | 'attempt';
  source_id: string;
  title: string;
  fields: Record<string, string>;
  verification_scope: string;
  visibility: 'public' | 'link' | 'org';
  opportunities: string[];
  status: string;
  verified_count: number;
  total_count: number;
  maturity: string;
  tier: string;
  track: string | null;
  published_at: Date | null;
}

function card(p: PubRow, ownerName: string) {
  return {
    id: p.id,
    title: p.title,
    owner: ownerName,
    fields: p.fields,
    verification: p.verification_scope,
    tier: p.tier,
    tierRule: TIER_RULE,
    verified: p.verified_count,
    total: p.total_count,
    maturity: p.maturity,
    opportunities: p.opportunities,
    track: p.track,
    publishedAt: p.published_at,
    prices: { contactUnlock: PRICES.contactUnlock, ideaPurchase: PRICES.ideaPurchaseDefault },
  };
}

export function registerMarket(app: FastifyInstance, deps: Deps) {
  const { db, clock, hooks } = deps;

  // TX-13: withdrawing talent-matching consent closes pending requests at once
  hooks.consentWithdrawn.push(async (q, e) => {
    if (e.code !== 'talent_matching') return;
    await q.query(
      `update contact_requests set status = 'DECLINED', decided_at = $2
       where status = 'REQUESTED' and publication_id in (select id from publications where owner_id = $1)`,
      [e.userId, e.at],
    );
  });

  async function pub(id: string): Promise<PubRow> {
    const [p] = await db.query<PubRow>('select * from publications where id = $1', [id]);
    if (!p) throw notFound('ผลงาน');
    return p;
  }
  async function ownPub(u: UserRow, id: string) {
    const p = await pub(id);
    if (p.owner_id !== u.id) throw forbidden('นี่ไม่ใช่ผลงานของคุณ');
    return p;
  }

  async function index(q: Queryable, p: PubRow) {
    if (p.visibility === 'link') return; // link-only works are reachable by URL but never searchable
    const [owner] = await q.query<{ name: string }>('select name from users where id = $1', [p.owner_id]);
    const doc = card(p, owner.name);
    const body = [p.title, ...Object.values(p.fields), p.verification_scope, p.maturity].join(' ').toLowerCase();
    await q.query(
      `insert into search_index(publication_id, visibility, doc, body, indexed_at) values ($1, $2, $3, $4, $5)
       on conflict (publication_id) do update set doc = $3, body = $4, indexed_at = $5`,
      [p.id, p.visibility, JSON.stringify(doc), body, clock.now()],
    );
  }

  async function goLive(q: Queryable, p: PubRow, u: UserRow | null, cid: string, reason: string) {
    const now = clock.now();
    await q.query(`update publications set status = 'PUBLISHED', published_at = $2 where id = $1`, [p.id, now]);
    p.status = 'PUBLISHED';
    p.published_at = now;
    await index(q, p);
    await audit(q, { cid, actor: u ? actorOf(u) : null, object: `Publication · ${p.title}`, prev: 'PUBLICATION_DRAFT', next: 'PUBLISHED', reason: `${reason} · visibility=${p.visibility}` });
  }

  /* ───────────── owner side ───────────── */

  /** Submitting work is not consent to publish: this is a separate, explicit step. */
  app.post('/v1/publications', async (req, reply) => {
    const u = requireRole(req, 'learner');
    const b = parse(PublicationBody, req.body);
    const bad = Object.keys(b.fields).filter((k) => !(PUBLICATION_FIELDS as readonly string[]).includes(k));
    if (bad.length) {
      const forbiddenKeys = bad.filter((k) => (FORBIDDEN_PUBLICATION_FIELDS as readonly string[]).includes(k));
      throw unprocessable('FIELD_NOT_ALLOWED', forbiddenKeys.length ? 'เกรดรายข้อ รหัส U/D/J Feedback ภายใน ข้อเสนอของ AI และข้อมูลลับของเจ้าของโจทย์ เปิดเผยไม่ได้' : 'มีช่องที่ระบบไม่รู้จัก', { fields: bad });
    }
    let verified = 0;
    let total = 0;
    let maturity = '';
    let scope = '';
    let track: string | null = null;
    let authors = [u.id];
    if (b.source.kind === 'submission') {
      const [s] = await db.query<{ student_id: string }>('select student_id from submissions where id = $1', [b.source.id]);
      if (!s || s.student_id !== u.id) throw forbidden('นี่ไม่ใช่งานของคุณ');
      const [rel] = await db.query<{ snapshot: any; released_at: Date; name: string }>(
        `select f.snapshot, f.released_at, us.name from feedback_releases f join submission_versions v on v.id = f.submission_version_id join users us on us.id = f.released_by
         where v.submission_id = $1 order by v.version_no desc limit 1`,
        [b.source.id],
      );
      verified = rel?.snapshot.counts.verified ?? 0;
      total = rel?.snapshot.counts.total ?? 0;
      if (!verified) throw unprocessable('NOTHING_VERIFIED', 'ยังเผยแพร่ไม่ได้ ต้องมีข้อที่อาจารย์ยืนยันอย่างน้อยหนึ่งข้อ');
      const names = rel.snapshot.criteria.filter((c: any) => c.items.some((i: any) => i.status === 'VERIFIED')).map((c: any) => c.name);
      scope = `${rel.name} ตรวจตามเกณฑ์ ${rel.snapshot.rubricName} · รับรองแล้ว ${verified}/${total} ข้อ ในด้าน ${names.join(', ')} · เมื่อ ${new Date(rel.released_at).toISOString().slice(0, 10)} · ไม่ได้ตรวจข้อมูลภาคสนาม`;
      maturity = 'ทบทวนวรรณกรรม';
    } else {
      const [a] = await db.query<{ id: string; team_id: string; state: string; case_id: string }>('select * from attempts where id = $1', [b.source.id]);
      if (!a) throw notFound('เคส');
      const members = (await db.query<{ user_id: string }>('select user_id from team_members where team_id = $1', [a.team_id])).map((m) => m.user_id);
      if (!members.includes(u.id)) throw forbidden('คุณไม่ได้อยู่ในทีมนี้');
      if (!['EVALUATED', 'CREDENTIALED'].includes(a.state)) throw unprocessable('NOT_EVALUATED', 'เผยแพร่ได้หลังกรรมการปล่อยผลแล้ว');
      const [s] = await db.query<{ confirmed_bands: Array<{ band: number }>; confirmed_by: string }>('select confirmed_bands, confirmed_by from attempt_submissions where attempt_id = $1', [a.id]);
      const [c] = await db.query<{ title: string; track: string }>('select title, track from cases where id = $1', [a.case_id]);
      verified = s.confirmed_bands.filter((x) => x.band >= PASS_BAND).length;
      total = s.confirmed_bands.length;
      scope = `กรรมการยืนยันผลในเคส “${c.title}” · ผ่าน ${verified}/${total} เกณฑ์ · เป็นการแก้โจทย์จำลองจากข้อมูลจริง ยังไม่ได้ทดลองกับธุรกิจ`;
      maturity = 'แก้โจทย์จำลองแล้ว';
      track = c.track;
      authors = members;
      // confidential SME text must never be copied into a public card (appendix B confidentiality)
      const secret = await db.query<{ content: string }>(`select coalesce(anonymized_content, content) as content from case_assets where case_id = $1 and 'confidential' = any(markings)`, [a.case_id]);
      const cv = (await db.query<{ booklet: Array<{ body: string }> }>('select booklet from case_versions where case_id = $1 order by version_no desc limit 1', [a.case_id]))[0];
      const leaked = copiedPhrases([...secret.map((x) => x.content), ...(cv?.booklet ?? []).map((p) => p.body)], Object.values(b.fields).join('\n'));
      if (leaked.length) throw unprocessable('CONFIDENTIAL_CONTENT', 'มีข้อความจาก Case Booklet ของเจ้าของโจทย์ ซึ่งเป็นข้อมูลลับ เขียนด้วยคำของคุณเองแทน', { count: leaked.length });
    }
    const id = newId('pub');
    const tier = tierOf(verified, total, false);
    await db.tx(async (q) => {
      await q.query(
        `insert into publications(id, owner_id, source_kind, source_id, title, fields, verification_scope, visibility, opportunities, status, verified_count, total_count, maturity, tier, track, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUBLICATION_DRAFT', $10, $11, $12, $13, $14, $15)`,
        [id, u.id, b.source.kind, b.source.id, b.title, JSON.stringify(b.fields), scope, b.visibility, b.opportunities, verified, total, maturity, tier, track, clock.now()],
      );
      for (const a of authors) await q.query('insert into publication_authors(publication_id, user_id, consented_at) values ($1, $2, $3)', [id, a, a === u.id ? clock.now() : null]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Publication · ${b.title}`, prev: '-', next: 'PUBLICATION_DRAFT', reason: `fields=${Object.keys(b.fields).join(',')}` });
    });
    return reply.status(201).send({ id, status: 'PUBLICATION_DRAFT', tier, coAuthors: authors.length - 1 });
  });

  app.get('/v1/me/publications', async (req) => {
    const u = requireRole(req, 'learner');
    const rows = await db.query(
      `select p.*, (select json_agg(json_build_object('userId', a.user_id, 'consented', a.consented_at is not null)) from publication_authors a where a.publication_id = p.id) as authors
       from publications p where p.owner_id = $1 or exists (select 1 from publication_authors a where a.publication_id = p.id and a.user_id = $1) order by p.created_at desc`,
      [u.id],
    );
    return { publications: rows };
  });

  /** Exactly the card organisations will see. */
  app.get('/v1/publications/:id/preview', async (req) => {
    const u = requireRole(req, 'learner');
    const p = await ownPub(u, (req.params as { id: string }).id);
    return { card: card(p, u.name), notOnCard: ['เกรดรายข้อ', 'รหัส U/D/J', 'Feedback ภายใน', 'ข้อเสนอของ AI', 'ข้อมูลลับของเจ้าของโจทย์', 'ข้อมูลติดต่อ'] };
  });

  app.post('/v1/publications/:id/publish', async (req) => {
    const u = requireRole(req, 'learner');
    const p = await ownPub(u, (req.params as { id: string }).id);
    if (p.status !== 'PUBLICATION_DRAFT' && p.status !== 'WITHDRAWN') throw conflict('WRONG_STATUS', `เผยแพร่ไม่ได้ในสถานะ ${p.status}`);
    const pending = await db.query('select user_id from publication_authors where publication_id = $1 and consented_at is null', [p.id]);
    return db.tx(async (q) => {
      if (pending.length) {
        await q.query(`update publications set status = 'PENDING_COAUTHORS' where id = $1`, [p.id]);
        await audit(q, { cid: req.cid, actor: actorOf(u), object: `Publication · ${p.title}`, prev: p.status, next: 'PENDING_COAUTHORS', reason: `รอสมาชิกยืนยัน ${pending.length} คน · AC-05` });
        return { status: 'PENDING_COAUTHORS', waitingFor: pending.length };
      }
      await goLive(q, p, u, req.cid, 'owner_consent');
      return { status: 'PUBLISHED' };
    });
  });

  app.post('/v1/publications/:id/consent', async (req) => {
    const u = requireRole(req, 'learner');
    const p = await pub((req.params as { id: string }).id);
    const [row] = await db.query('select consented_at from publication_authors where publication_id = $1 and user_id = $2', [p.id, u.id]);
    if (!row) throw forbidden('คุณไม่ได้เป็นผู้ร่วมจัดทำผลงานนี้');
    return db.tx(async (q) => {
      await q.query('update publication_authors set consented_at = $3 where publication_id = $1 and user_id = $2', [p.id, u.id, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Publication · ${p.title}`, next: 'COAUTHOR_CONSENT', reason: 'co-author agreed' });
      const pending = await q.query('select 1 from publication_authors where publication_id = $1 and consented_at is null', [p.id]);
      if (!pending.length && p.status === 'PENDING_COAUTHORS') {
        await goLive(q, p, u, req.cid, 'all co-authors consented');
        return { status: 'PUBLISHED' };
      }
      return { status: p.status, waitingFor: pending.length };
    });
  });

  /** AC-08: out of the index, public URL closed, pending requests closed. */
  app.post('/v1/publications/:id/withdraw', async (req) => {
    const u = requireRole(req, 'learner');
    const p = await ownPub(u, (req.params as { id: string }).id);
    if (p.status !== 'PUBLISHED' && p.status !== 'PENDING_COAUTHORS') throw conflict('WRONG_STATUS', 'ผลงานนี้ไม่ได้เผยแพร่อยู่');
    await db.tx(async (q) => {
      await q.query('delete from search_index where publication_id = $1', [p.id]);
      await q.query(`update publications set status = 'WITHDRAWN', withdrawn_at = $2 where id = $1`, [p.id, clock.now()]);
      await q.query(`update contact_requests set status = 'DECLINED', decided_at = $2 where publication_id = $1 and status = 'REQUESTED'`, [p.id, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Publication · ${p.title}`, prev: p.status, next: 'WITHDRAWN', reason: 'owner_withdraw · removed from search index · public URL closed' });
    });
    return { status: 'WITHDRAWN' };
  });

  /** Public URL: public or link visibility only; withdrawn = 410 Gone. */
  app.get('/v1/public/publications/:id', async (req, reply) => {
    const [p] = await db.query<PubRow>('select * from publications where id = $1', [(req.params as { id: string }).id]);
    if (p?.status === 'WITHDRAWN') return reply.status(410).send({ code: 'GONE', message_th: 'เจ้าของถอนการเผยแพร่ผลงานนี้แล้ว' });
    if (!p || p.status !== 'PUBLISHED' || p.visibility === 'org') throw notFound('ผลงาน');
    const [owner] = await db.query<{ name: string }>('select name from users where id = $1', [p.owner_id]);
    return card(p, owner.name);
  });

  /* ───────────── organisation side ───────────── */

  async function orgOf(u: UserRow) {
    const [o] = await db.query<{ id: string; name: string; domain_verified: boolean }>('select * from organizations where id = $1', [u.org_id]);
    if (!o) throw forbidden('บัญชีนี้ไม่ได้ผูกกับองค์กร');
    return o;
  }

  /** AC-06: reads search_index only. Unpublished work does not exist here, and nothing hints otherwise. */
  app.get('/v1/market/search', async (req) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    const f = parse(z.object({ q: z.string().max(200).default(''), tier: z.enum(['A', 'B', 'C']).optional(), track: z.string().optional(), sort: z.enum(['recent', 'tier', 'verified']).default('recent') }), req.query);
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = await db.query<{ doc: any; body: string }>(
      `select doc, body from search_index where (visibility = 'public' or ($1 and visibility = 'org'))`,
      [org.domain_verified],
    );
    let hits = rows.filter((r) => terms.every((t) => r.body.includes(t))).map((r) => r.doc);
    if (f.tier) hits = hits.filter((d) => d.tier === f.tier);
    if (f.track) hits = hits.filter((d) => d.track === f.track);
    const order = { A: 0, B: 1, C: 2 } as Record<string, number>;
    hits.sort((a, b) =>
      f.sort === 'tier' ? order[a.tier] - order[b.tier] : f.sort === 'verified' ? b.verified - a.verified : String(b.publishedAt).localeCompare(String(a.publishedAt)),
    );
    await db.query('insert into search_queries(org_id, user_id, q, filters, results, at) values ($1, $2, $3, $4, $5, $6)', [org.id, u.id, f.q, JSON.stringify({ tier: f.tier, track: f.track }), hits.length, clock.now()]);
    return { results: hits, index: 'publication_projection' };
  });

  app.get('/v1/market/publications/:id', async (req) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    const [r] = await db.query<{ doc: any; visibility: string }>('select doc, visibility from search_index where publication_id = $1', [(req.params as { id: string }).id]);
    if (!r || (r.visibility === 'org' && !org.domain_verified)) throw notFound('ผลงาน');
    const [sl] = await db.query('select note from shortlists where org_id = $1 and publication_id = $2', [org.id, r.doc.id]);
    return { ...r.doc, shortlisted: !!sl, note: sl?.note ?? null };
  });

  app.get('/v1/market/trends', async (req) => {
    const u = requireRole(req, 'org_member');
    await orgOf(u);
    const [counts] = await db.query(
      `select (select count(*)::int from search_index) as published,
              (select count(*)::int from search_queries) as searches,
              (select count(*)::int from contact_requests) as contact_requests,
              (select count(*)::int from engagements) as engagements`,
    );
    const tiers = await db.query(`select doc->>'tier' as tier, count(*)::int as n from search_index group by 1 order by 1`);
    const topQueries = await db.query(`select lower(q) as q, count(*)::int as n from search_queries where q <> '' group by 1 order by n desc limit 8`);
    return { counts, tiers, topQueries, source: 'นับจากเหตุการณ์ในระบบเอง' };
  });

  app.get('/v1/orgs/me/shortlist', async (req) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    const rows = await db.query(
      `select s.publication_id, s.note, s.created_at, i.doc from shortlists s left join search_index i on i.publication_id = s.publication_id where s.org_id = $1 order by s.created_at desc`,
      [org.id],
    );
    // a work withdrawn after shortlisting disappears from the card but the team note remains
    return { items: rows.map((r: any) => ({ publicationId: r.publication_id, note: r.note, card: r.doc ?? null, withdrawn: !r.doc })) };
  });

  app.post('/v1/orgs/me/shortlist', async (req) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    const b = parse(z.object({ publicationId: z.string(), note: z.string().max(2000).default('') }), req.body);
    const [r] = await db.query('select 1 from search_index where publication_id = $1', [b.publicationId]);
    if (!r) throw notFound('ผลงาน');
    await db.query(
      `insert into shortlists(org_id, publication_id, note, created_by, created_at) values ($1, $2, $3, $4, $5) on conflict (org_id, publication_id) do update set note = $3`,
      [org.id, b.publicationId, b.note, u.id, clock.now()],
    );
    return { saved: true };
  });

  /* ───────────── contact requests (AC-07) ───────────── */

  async function expireIfDue(q: Queryable) {
    await q.query(`update contact_requests set status = 'EXPIRED' where status = 'REQUESTED' and expires_at < $1`, [clock.now()]);
  }

  app.post('/v1/contact-requests', async (req, reply) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    if (!org.domain_verified) throw forbidden('องค์กรต้องยืนยันโดเมนก่อนขอติดต่อ');
    const b = parse(z.object({ publicationId: z.string(), purpose: z.string().min(10).max(1000), scope: z.string().min(5).max(1000), expiresAt: z.string().datetime() }), req.body);
    const [r] = await db.query('select 1 from search_index where publication_id = $1', [b.publicationId]);
    if (!r) throw notFound('ผลงาน');
    if (new Date(b.expiresAt) <= clock.now()) throw unprocessable('EXPIRY_IN_PAST', 'วันหมดอายุต้องอยู่ในอนาคต');
    const id = newId('ctr');
    await db.tx(async (q) => {
      await q.query(
        `insert into contact_requests(id, org_id, publication_id, requester_id, purpose, scope, expires_at, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, 'REQUESTED', $8)`,
        [id, org.id, b.publicationId, u.id, b.purpose, b.scope, b.expiresAt, clock.now()],
      );
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `ContactRequest · ${org.name}`, prev: '-', next: 'REQUESTED', reason: `purpose=${b.purpose.slice(0, 60)} · ยังไม่เปิดข้อมูลส่วนตัว` });
    });
    return reply.status(201).send({ id, status: 'REQUESTED' });
  });

  /** Organisation view: contact details appear only after the owner accepts AND the unlock is paid. */
  app.get('/v1/orgs/me/requests', async (req) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    await expireIfDue(db);
    const contacts = await db.query<any>(
      `select c.*, p.title, u2.name as owner_name, u2.email as owner_email from contact_requests c join publications p on p.id = c.publication_id join users u2 on u2.id = p.owner_id where c.org_id = $1 order by c.created_at desc`,
      [org.id],
    );
    const engagements = await db.query(
      `select e.id, e.option, e.amount_satang, e.status, e.created_at, e.paid_at, p.title from engagements e join publications p on p.id = e.publication_id where e.org_id = $1 order by e.created_at desc`,
      [org.id],
    );
    return {
      contacts: contacts.map(({ owner_email, disclosed, ...c }) => ({
        ...c,
        contact: c.status === 'UNLOCKED' ? Object.fromEntries((disclosed ?? []).map((k: string) => [k, k === 'email' ? owner_email : null])) : null,
      })),
      engagements,
    };
  });

  app.get('/v1/me/requests', async (req) => {
    const u = requireRole(req, 'learner');
    await expireIfDue(db);
    const contacts = await db.query(
      `select c.id, c.purpose, c.scope, c.expires_at, c.status, c.created_at, o.name as org_name, o.domain_verified, p.title
       from contact_requests c join publications p on p.id = c.publication_id join organizations o on o.id = c.org_id where p.owner_id = $1 order by c.created_at desc`,
      [u.id],
    );
    const engagements = await db.query(
      `select e.id, e.option, e.amount_satang, e.status, e.created_at, o.name as org_name, p.title
       from engagements e join publications p on p.id = e.publication_id join organizations o on o.id = e.org_id where p.owner_id = $1 order by e.created_at desc`,
      [u.id],
    );
    const consents = await consentState(db, u.id);
    return { contacts, engagements, talentMatching: consents.talent_matching };
  });

  async function ownRequest(u: UserRow, id: string) {
    await expireIfDue(db);
    const [c] = await db.query<any>('select c.*, p.owner_id, p.title from contact_requests c join publications p on p.id = c.publication_id where c.id = $1', [id]);
    if (!c) throw notFound('คำขอ');
    if (c.owner_id !== u.id) throw forbidden('คำขอนี้ไม่ได้ส่งถึงคุณ');
    if (c.status !== 'REQUESTED') throw conflict('WRONG_STATUS', c.status === 'EXPIRED' ? 'คำขอหมดอายุแล้ว' : `คำขอนี้ ${c.status} แล้ว`);
    return c;
  }

  app.post('/v1/contact-requests/:id/:decision', async (req) => {
    const u = requireRole(req, 'learner');
    const { id, decision } = parse(z.object({ id: z.string(), decision: z.enum(['accept', 'partial', 'decline']) }), req.params);
    const c = await ownRequest(u, id);
    const { disclose } = parse(z.object({ disclose: z.array(z.enum(['email'])).default(['email']) }), req.body ?? {});
    if (decision === 'accept') {
      const consents = await consentState(db, u.id);
      if (!consents.talent_matching) throw conflict('TALENT_CONSENT_REQUIRED', 'ต้องให้ความยินยอมเรื่องการจับคู่โอกาสก่อน จึงเปิดข้อมูลติดต่อได้ (TX-13)');
    }
    const next = decision === 'accept' ? 'ACCEPTED' : decision === 'partial' ? 'PARTIALLY_ACCEPTED' : 'DECLINED';
    await db.tx(async (q) => {
      await q.query('update contact_requests set status = $2, disclosed = $3, decided_at = $4 where id = $1', [c.id, next, decision === 'accept' ? JSON.stringify(disclose) : null, clock.now()]);
      // the decision itself is the consent record: who, what, when
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `ContactRequest · ${c.title}`, prev: 'REQUESTED', next, reason: decision === 'accept' ? `owner_consent · disclose=${disclose.join(',')}` : decision === 'partial' ? 'owner_partial · ยังไม่เปิดข้อมูลติดต่อ' : 'owner_declined' });
    });
    return { status: next };
  });

  app.post('/v1/contact-requests/:id/pay', async (req) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    const [c] = await db.query<any>('select c.*, p.owner_id from contact_requests c join publications p on p.id = c.publication_id where c.id = $1', [(req.params as { id: string }).id]);
    if (!c || c.org_id !== org.id) throw notFound('คำขอ');
    if (c.status !== 'ACCEPTED') throw conflict('NOT_ACCEPTED', 'ชำระได้หลังเจ้าของผลงานตอบรับเท่านั้น');
    await db.tx(async (q) => {
      await pay(q, { kind: 'contact_unlock', refId: c.id, orgId: org.id, amountSatang: PRICES.contactUnlock * 100, ownerId: c.owner_id });
      await q.query(`update contact_requests set status = 'UNLOCKED', unlocked_at = $2 where id = $1`, [c.id, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `ContactRequest · ${org.name}`, prev: 'ACCEPTED', next: 'UNLOCKED', reason: `paid ${PRICES.contactUnlock} บาท` });
    });
    return { status: 'UNLOCKED' };
  });

  /* ───────────── idea purchase (plan table 33: 40% to the learner) ───────────── */

  async function pay(q: Queryable, p: { kind: 'contact_unlock' | 'idea_purchase'; refId: string; orgId: string; amountSatang: number; ownerId: string }) {
    const id = newId('pay');
    const now = clock.now();
    await q.query(`insert into payments(id, kind, ref_id, payer_org_id, amount_satang, status, paid_at) values ($1, $2, $3, $4, $5, 'PAID', $6)`, [id, p.kind, p.refId, p.orgId, p.amountSatang, now]);
    for (const e of splitPayment(p.amountSatang, p.kind, p.ownerId)) {
      await q.query('insert into ledger_entries(payment_id, account, user_id, side, amount_satang, at) values ($1, $2, $3, $4, $5, $6)', [id, e.account, e.userId, e.side, e.amount, now]);
    }
    return id;
  }

  app.post('/v1/engagements', async (req, reply) => {
    const u = requireRole(req, 'org_member');
    const org = await orgOf(u);
    if (!org.domain_verified) throw forbidden('องค์กรต้องยืนยันโดเมนก่อน');
    const b = parse(z.object({ publicationId: z.string(), option: z.string().min(3).max(200), amountBaht: z.number().int().min(1).max(10_000_000) }), req.body);
    const [r] = await db.query<{ doc: any }>('select doc from search_index where publication_id = $1', [b.publicationId]);
    if (!r) throw notFound('ผลงาน');
    if (r.doc.tier === 'C' && /สิทธิ์เชิงพาณิชย์|licen[cs]e/i.test(b.option)) throw unprocessable('TIER_NOT_ELIGIBLE', 'ผลงาน Tier C ยังไม่เปิดขายสิทธิ์เชิงพาณิชย์');
    const id = newId('eng');
    await db.tx(async (q) => {
      await q.query(`insert into engagements(id, org_id, publication_id, requester_id, option, amount_satang, status, created_at) values ($1, $2, $3, $4, $5, $6, 'DISCUSSION', $7)`, [id, org.id, b.publicationId, u.id, b.option, b.amountBaht * 100, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Engagement · ${r.doc.title}`, prev: '-', next: 'DISCUSSION', reason: `${b.option} · ${b.amountBaht} บาท · ยังไม่ตัดเงิน` });
    });
    return reply.status(201).send({ id, status: 'DISCUSSION' });
  });

  app.post('/v1/engagements/:id/:decision', async (req) => {
    const { id, decision } = parse(z.object({ id: z.string(), decision: z.enum(['approve', 'decline', 'pay']) }), req.params);
    const u = requireUser(req);
    const [e] = await db.query<any>('select e.*, p.owner_id, p.title from engagements e join publications p on p.id = e.publication_id where e.id = $1', [id]);
    if (!e) throw notFound('คำขอ');
    if (decision === 'pay') {
      if (u.role !== 'org_member' || u.org_id !== e.org_id) throw forbidden();
      if (e.status !== 'AGREED') throw conflict('NOT_AGREED', 'ชำระได้หลังเจ้าของผลงานอนุมัติ');
      await db.tx(async (q) => {
        await pay(q, { kind: 'idea_purchase', refId: e.id, orgId: e.org_id, amountSatang: Number(e.amount_satang), ownerId: e.owner_id });
        await q.query(`update engagements set status = 'PAID', paid_at = $2 where id = $1`, [e.id, clock.now()]);
        await audit(q, { cid: req.cid, actor: actorOf(u), object: `Engagement · ${e.title}`, prev: 'AGREED', next: 'PAID', reason: `learner share ${REVENUE_SHARE.ideaToLearner * 100}%` });
      });
      return { status: 'PAID' };
    }
    if (u.id !== e.owner_id) throw forbidden('เฉพาะเจ้าของผลงานเท่านั้น');
    if (e.status !== 'DISCUSSION') throw conflict('WRONG_STATUS', `คำขอนี้ ${e.status} แล้ว`);
    const next = decision === 'approve' ? 'AGREED' : 'CANCELLED';
    await db.tx(async (q) => {
      await q.query('update engagements set status = $2, decided_at = $3 where id = $1', [e.id, next, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Engagement · ${e.title}`, prev: 'DISCUSSION', next, reason: decision === 'approve' ? 'owner_approved · ไฟล์ต้นฉบับไม่ถูกส่งออกทั้งก้อน' : 'owner_declined' });
    });
    return { status: next };
  });

  app.get('/v1/me/payouts', async (req) => {
    const u = requireRole(req, 'learner');
    const rows = await db.query<{ amount_satang: string; at: Date; kind: string }>(
      `select l.amount_satang, l.at, p.kind from ledger_entries l join payments p on p.id = l.payment_id where l.account = 'learner_payable' and l.user_id = $1 order by l.at desc`,
      [u.id],
    );
    const total = rows.reduce((s, r) => s + Number(r.amount_satang), 0);
    return { totalBaht: total / 100, entries: rows.map((r) => ({ ...r, amountBaht: Number(r.amount_satang) / 100 })) };
  });
}

export { AppError };
