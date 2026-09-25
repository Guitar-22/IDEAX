import type { Deps } from './app.js';

/**
 * The in-process queue does not survive a restart. On boot, put back every analysis or screening
 * that never finished, so no submission stays QUEUED forever.
 */
export async function recoverJobs({ db, queue }: Deps): Promise<number> {
  const runs = await db.query<{ submission_version_id: string }>(
    `select distinct on (submission_version_id) submission_version_id, status from analysis_runs order by submission_version_id, created_at desc`,
  );
  const pendingRuns = (runs as Array<{ submission_version_id: string; status: string }>).filter((r) => ['QUEUED', 'RUNNING', 'FAILED'].includes(r.status));
  for (const r of pendingRuns) queue.enqueue('ideax.analyze', { versionId: r.submission_version_id }, 'cid-recover');
  const subs = await db.query<{ id: string }>(`select id from attempt_submissions where ai_status in ('QUEUED', 'RUNNING', 'FAILED')`);
  for (const s of subs) queue.enqueue('thaitern.score', { submissionId: s.id }, 'cid-recover');
  return pendingRuns.length + subs.length;
}
