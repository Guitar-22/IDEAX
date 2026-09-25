import type { Queryable } from '../db/index.js';

export interface Actor {
  id: string;
  role: string;
  name: string;
}

/** One row per state transition: who, which role, what, before → after, why, correlation id. */
export async function audit(
  q: Queryable,
  e: { cid: string; actor: Actor | null; object: string; prev?: string; next?: string; reason?: string; at?: Date },
): Promise<void> {
  await q.query(
    `insert into audit_log(at, correlation_id, actor_id, role, object, prev, next, reason)
     values (coalesce($1, now()), $2, $3, $4, $5, $6, $7, $8)`,
    [e.at ?? null, e.cid, e.actor?.id ?? null, e.actor?.role ?? 'system', e.object, e.prev ?? '-', e.next ?? '-', e.reason ?? '-'],
  );
}

export interface TraceInput {
  cid: string;
  actorId: string | null;
  type: string;
  teamId?: string | null;
  context?: { kind: 'attempt' | 'assignment' | 'submission' | 'case' | 'user'; id: string };
  caseId?: string | null;
  journeyStep?: string | null;
  stage?: number | null;
  supportLevel?: string | null;
  payload?: Record<string, unknown>;
  at?: Date;
}

/** Decision Trace event (docs/APP_FLOW.md §13). Append-only. */
export async function trace(q: Queryable, e: TraceInput): Promise<void> {
  await q.query(
    `insert into trace_events(at, actor_id, team_id, context_kind, context_id, case_id, journey_step, stage, support_level, type, payload, correlation_id)
     values (coalesce($1, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      e.at ?? null,
      e.actorId,
      e.teamId ?? null,
      e.context?.kind ?? null,
      e.context?.id ?? null,
      e.caseId ?? null,
      e.journeyStep ?? null,
      e.stage ?? null,
      e.supportLevel ?? null,
      e.type,
      JSON.stringify(e.payload ?? {}),
      e.cid,
    ],
  );
}

export async function diag(
  q: Queryable,
  e: { subjectKind: string; subjectId: string; kind: string; detail: string; cid?: string },
): Promise<void> {
  await q.query(
    `insert into diagnostics(subject_kind, subject_id, kind, detail, correlation_id) values ($1, $2, $3, $4, $5)`,
    [e.subjectKind, e.subjectId, e.kind, e.detail, e.cid ?? null],
  );
}
