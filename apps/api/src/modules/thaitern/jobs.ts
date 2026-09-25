/** AI screening of a THAItern submission: bands + evidence quotes that must exist in the work. */
import { PASS_BAND } from '@ideax/contracts';
import type { Deps } from '../../app.js';
import { audit, diag } from '../../core/audit.js';

export function registerThaiternJobs(deps: Deps) {
  const { db, ai, queue } = deps;
  queue.handle(
    'thaitern.score',
    async ({ submissionId }: { submissionId: string }, { attempt, cid }) => {
      const [s] = await db.query<any>(
        `select s.*, a.canvas, a.case_version_id from attempt_submissions s join attempts a on a.id = s.attempt_id where s.id = $1`,
        [submissionId],
      );
      if (!s || s.ai_status === 'COMPLETED') return;
      const [cv] = await db.query<{ criteria: Array<{ key: string; name: string; stage: number; cues: string[] }> }>('select criteria from case_versions where id = $1', [s.case_version_id]);
      const text = [s.summary, ...Object.values(s.answers as Record<string, string>), ...Object.values(s.canvas as Record<string, string>)].join('\n');
      await db.query(`update attempt_submissions set ai_status = 'RUNNING' where id = $1`, [submissionId]);
      let bands;
      try {
        bands = await ai.scoreAttempt({ text, criteria: cv.criteria });
      } catch (e) {
        await db.query(`update attempt_submissions set ai_status = 'FAILED' where id = $1`, [submissionId]);
        await diag(db, { subjectKind: 'attempt_submission', subjectId: submissionId, kind: 'screening_failed', detail: `attempt ${attempt}: ${(e as Error).message}`, cid });
        throw e;
      }
      const checked: Array<{ key: string; stage: number; band: number; why: string; quotes: string[] }> = [];
      for (const b of bands) {
        const quotes = b.quotes.filter((qt) => text.includes(qt));
        if (quotes.length < b.quotes.length) {
          await diag(db, { subjectKind: 'attempt_submission', subjectId: submissionId, kind: 'claim_dropped', detail: `${b.key}: quote not found in the work · AC-03`, cid });
        }
        // a band that claims evidence it cannot quote is lowered to the floor
        const band = b.quotes.length && !quotes.length ? 1 : b.band;
        checked.push({ key: b.key, stage: cv.criteria.find((c) => c.key === b.key)!.stage, band, why: b.why, quotes });
      }
      const passing = checked.filter((b) => b.band >= PASS_BAND).length;
      const shortlisted = passing >= Math.ceil(checked.length / 2);
      await db.tx(async (q) => {
        await q.query(`update attempt_submissions set ai_status = 'COMPLETED', status = 'SCREENED', ai_bands = $2, shortlisted = $3 where id = $1`, [submissionId, JSON.stringify(checked), shortlisted]);
        await audit(q, { cid, actor: null, object: `Screening · ${submissionId}`, prev: 'RECEIVED', next: `SCREENED (AI proposal) · shortlist=${shortlisted}`, reason: `model=${ai.model} · ${passing}/${checked.length} criteria ≥ band ${PASS_BAND}` });
      });
    },
    async ({ submissionId }: { submissionId: string }, _err, cid) => {
      // no AI: nobody is excluded; judges screen this one by hand
      await db.tx(async (q) => {
        await q.query(`update attempt_submissions set ai_status = 'ABANDONED', status = 'SCREENED', shortlisted = null where id = $1`, [submissionId]);
        await audit(q, { cid, actor: null, object: `Screening · ${submissionId}`, prev: 'RECEIVED', next: 'SCREENED (manual)', reason: 'AI retries exhausted · กรรมการคัดกรองเอง' });
      });
    },
  );
}
