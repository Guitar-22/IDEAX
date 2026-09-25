/** Background analysis of a submitted version (docs/APP_FLOW.md §9.2). */
import type { Deps } from '../../app.js';
import type { ItemHints, ProposalOut } from '../../ai/provider.js';
import { anchorHash } from '../../ai/mock.js';
import { audit, diag } from '../../core/audit.js';
import { newId } from '../../core/ids.js';
import { loadVersion } from './service.js';

async function latestRun(deps: Deps, versionId: string) {
  const rows = await deps.db.query<{ id: string; status: string }>(
    'select id, status from analysis_runs where submission_version_id = $1 order by created_at desc limit 1',
    [versionId],
  );
  return rows[0];
}

export function registerIdeaxJobs(deps: Deps) {
  const { db, ai, clock, queue } = deps;

  queue.handle(
    'ideax.analyze',
    async ({ versionId }: { versionId: string }, { attempt, cid }) => {
      const run = await latestRun(deps, versionId);
      if (!run || run.status === 'COMPLETED' || run.status === 'ABANDONED') return;
      const ctx = await loadVersion(db, versionId);
      const items = await db.query<{ no: string; text: string; hints: ItemHints }>(
        'select no, text, hints from rubric_items where rubric_id = $1 order by position',
        [ctx.assignment.rubric_id],
      );
      await db.query(`update analysis_runs set status = 'RUNNING', attempts = $2, updated_at = $3 where id = $1`, [run.id, attempt, clock.now()]);

      let proposals: ProposalOut[];
      try {
        proposals = await ai.analyzeSubmission({ content: ctx.version.content, items });
      } catch (err) {
        await db.query(`update analysis_runs set status = 'FAILED', last_error = $2, updated_at = $3 where id = $1`, [run.id, String((err as Error).message), clock.now()]);
        await diag(db, { subjectKind: 'submission_version', subjectId: versionId, kind: 'analysis_failed', detail: `attempt ${attempt}: ${(err as Error).message}`, cid });
        throw err;
      }

      const content = ctx.version.content;
      await db.tx(async (q) => {
        const codeByRange = new Map<string, string>();
        let seq = 0;
        let dropped = 0;
        let anchorsOk = 0;
        let anchorsTotal = 0;
        for (const p of proposals) {
          const codes: string[] = [];
          for (const a of p.anchors) {
            anchorsTotal++;
            const valid = a.start >= 0 && a.end <= content.length && a.end > a.start && anchorHash(content.slice(a.start, a.end)) === a.hash;
            if (!valid) {
              // AC-03: a claim that cannot be traced back to the text is never shown
              await diag(q, { subjectKind: 'submission_version', subjectId: versionId, kind: 'claim_dropped', detail: `item ${p.itemNo}: anchor ${a.start}-${a.end} hash mismatch · AC-03`, cid });
              continue;
            }
            anchorsOk++;
            const key = `${a.start}:${a.end}`;
            let code = codeByRange.get(key);
            if (!code) {
              code = `ANC-${ctx.version.version_no}${String(++seq).padStart(3, '0')}`;
              codeByRange.set(key, code);
              await q.query(
                'insert into anchors(id, submission_version_id, code, loc, start_offset, end_offset, hash) values ($1, $2, $3, $4, $5, $6, $7)',
                [newId('anc'), versionId, code, a.loc, a.start, a.end, a.hash],
              );
            }
            codes.push(code);
          }
          let { grade, kind, why } = p;
          let reasonCode: string | null = p.reasonCode ?? null;
          if (kind === 'presence' && p.anchors.length > 0 && codes.length === 0) {
            dropped++;
            grade = null;
            kind = 'gap';
            reasonCode = 'claim_dropped';
            why = 'ข้อเสนอของระบบชี้กลับไปยังข้อความในงานไม่ได้ จึงไม่แสดงข้อเสนอ ต้องให้อาจารย์ตัดสินเอง';
          }
          if (reasonCode === 'extraction_gap' || reasonCode === 'missing_artifact' || reasonCode === 'other_chapter') {
            await diag(q, { subjectKind: 'submission_version', subjectId: versionId, kind: reasonCode, detail: `item ${p.itemNo}: ${why}${reasonCode === 'extraction_gap' ? ' · AC-10' : ''}`, cid });
          }
          await q.query(
            `insert into item_proposals(analysis_run_id, submission_version_id, item_no, grade, kind, why, feedback, anchor_codes, reason_code)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [run.id, versionId, p.itemNo, grade, kind, why, p.feedback, codes, reasonCode],
          );
          await q.query(
            `insert into review_items(submission_version_id, item_no, status, grade, ai_grade)
             values ($1, $2, $3, $4, $4) on conflict (submission_version_id, item_no) do nothing`,
            [versionId, p.itemNo, grade ? 'AI_PROPOSED' : 'NO_PROPOSAL', grade],
          );
        }
        await diag(q, {
          subjectKind: 'submission_version',
          subjectId: versionId,
          kind: 'analysis_run',
          detail: `model=${ai.model} · rubric=${ctx.assignment.rubric_id} · anchors ${anchorsOk}/${anchorsTotal} ผ่าน validation · dropped=${dropped} · word_count=${ctx.version.word_count}`,
          cid,
        });
        await q.query(`update analysis_runs set status = 'COMPLETED', model = $2, updated_at = $3 where id = $1`, [run.id, ai.model, clock.now()]);
        await audit(q, { cid, actor: null, object: `AnalysisRun · v${ctx.version.version_no} · ${ctx.student.name}`, prev: 'QUEUED', next: 'COMPLETED', reason: `attempt ${attempt} · model=${ai.model}` });
      });

      if (ctx.assignment.verification) {
        const questions = await ai.verificationQuestions(content).catch(() => []);
        for (const [i, question] of questions.entries()) {
          await db.query(
            'insert into verification_questions(submission_version_id, position, question) values ($1, $2, $3) on conflict do nothing',
            [versionId, i + 1, question],
          );
        }
      }
    },
    // retries exhausted: the teacher still reviews, just without AI proposals
    async ({ versionId }: { versionId: string }, err, cid) => {
      const run = await latestRun(deps, versionId);
      const ctx = await loadVersion(db, versionId);
      const items = await db.query<{ no: string }>('select no from rubric_items where rubric_id = $1 order by position', [ctx.assignment.rubric_id]);
      await db.tx(async (q) => {
        await q.query(`update analysis_runs set status = 'ABANDONED', last_error = $2, updated_at = $3 where id = $1`, [run.id, String((err as Error)?.message), clock.now()]);
        for (const it of items) {
          await q.query(
            `insert into review_items(submission_version_id, item_no, status) values ($1, $2, 'NO_PROPOSAL') on conflict do nothing`,
            [versionId, it.no],
          );
        }
        await audit(q, { cid, actor: null, object: `AnalysisRun · v${ctx.version.version_no} · ${ctx.student.name}`, prev: 'FAILED', next: 'ABANDONED', reason: 'retries exhausted · อาจารย์ตรวจแบบไม่มีข้อเสนอ' });
      });
    },
  );
}
