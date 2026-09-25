'use client';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GRADE_KEYS, REVIEW_ITEM_LABEL, REVIEW_ITEM_TONE, type Grade } from '@ideax/contracts';
import { api, ApiError } from '@/lib/api';
import { dt } from '@/lib/format';
import { Guard } from '@/components/Guard';
import { Chip, ErrorBox, Loading, Modal, useToast } from '@/components/ui';

type Item = {
  no: string;
  criterionId: string;
  text: string;
  status: keyof typeof REVIEW_ITEM_LABEL;
  grade: string | null;
  aiGrade: string | null;
  reason: string;
  ann: string[];
  rowVersion: number;
  kind: string | null;
  why: string | null;
  anchors: string[];
  reasonCode: string | null;
  decidedBy: string | null;
};

function Doc({ content, anchors, active, onPick }: { content: string; anchors: any[]; active: string[]; onPick: (code: string) => void }) {
  // anchors are sentences: build non-overlapping segments in document order
  const segs = useMemo(() => {
    const uniq = new Map<string, { start: number; end: number; codes: string[] }>();
    for (const a of anchors) {
      const k = `${a.start}:${a.end}`;
      const cur = uniq.get(k) ?? { start: a.start as number, end: a.end as number, codes: [] as string[] };
      cur.codes.push(a.code);
      uniq.set(k, cur);
    }
    const list = [...uniq.values()].sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; codes?: string[] }> = [];
    let at = 0;
    for (const s of list) {
      if (s.start < at) continue;
      if (s.start > at) out.push({ text: content.slice(at, s.start) });
      out.push({ text: content.slice(s.start, s.end), codes: s.codes });
      at = s.end;
    }
    out.push({ text: content.slice(at) });
    return out;
  }, [content, anchors]);
  return (
    <div className="doc-body" style={{ whiteSpace: 'pre-wrap' }}>
      {segs.map((s, i) =>
        s.codes ? (
          <span
            key={i}
            className={`span ${s.codes.some((c) => active.includes(c)) ? 'on' : ''}`}
            onClick={() => onPick(s.codes![0])}
            data-anchor={s.codes.join(' ')}
            title={s.codes.join(', ')}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}

function GradeModal({ item, onClose, onSave, error }: { item: Item; onClose: () => void; onSave: (g: Grade, reason: string) => void; error: unknown }) {
  const [g, setG] = useState<Grade | null>((item.aiGrade as Grade) ?? null);
  const [reason, setReason] = useState('');
  const needReason = !item.aiGrade || g !== item.aiGrade;
  return (
    <Modal title={`${item.aiGrade ? 'ให้เกรดข้อ' : 'ให้เกรดเอง · ข้อ'} ${item.no}`} onClose={onClose}>
      <p className="muted fs13">{item.text}</p>
      <div className="gstrip" role="radiogroup" aria-label="เกรด">
        {GRADE_KEYS.map((k) => (
          <button key={k} type="button" className={`g ${g === k ? 'on v' : ''} ${item.aiGrade === k ? 'bar' : ''}`} onClick={() => setG(k)} aria-pressed={g === k}>
            {k}
          </button>
        ))}
      </div>
      <div className="glab">
        <span>F</span>
        <span>{item.aiGrade ? `ขีดใต้ = ระบบเสนอ ${item.aiGrade}` : 'ระบบไม่เสนอเกรดข้อนี้'}</span>
        <span>A</span>
      </div>
      <div className="field">
        <label>เหตุผลหนึ่งบรรทัด {needReason ? '(บังคับ เพราะต่างจากที่ระบบเสนอ)' : '(ไม่บังคับ)'}</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น มีประโยคเชื่อมแต่ใช้เฉพาะท้ายบท" />
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn pri" disabled={!g || (needReason && !reason.trim())} onClick={() => g && onSave(g, reason)}>
          บันทึกเป็นผลของอาจารย์
        </button>
        <button className="btn" onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </Modal>
  );
}

function FlagModal({ item, codes, onClose, onSave, error }: { item: Item; codes: Record<string, string>; onClose: () => void; onSave: (c: string[], reason: string) => void; error: unknown }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  return (
    <Modal title={`ส่งกลับให้แก้ · ข้อ ${item.no}`} onClose={onClose}>
      <p className="muted fs13">ข้อที่ส่งกลับไม่มีเกรด และไม่ถูกนับเป็น F</p>
      <div className="stack">
        {Object.entries(codes).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={picked.includes(k)} onChange={(e) => setPicked(e.target.checked ? [...picked, k] : picked.filter((x) => x !== k))} />
            <span>
              <b>{k}</b> · {label}
            </span>
          </label>
        ))}
      </div>
      <div className="field">
        <label>สิ่งที่ต้องแก้</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น เพิ่มประโยคที่บอกว่าอะไรยังขาด ท้าย §2.4" />
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn" disabled={!picked.length && !reason.trim()} onClick={() => onSave(picked, reason)}>
          ส่งกลับให้แก้
        </button>
        <button className="btn" onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </Modal>
  );
}

function Review({ svid }: { svid: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['review', svid], queryFn: () => api<any>(`/v1/reviews/${svid}`) });
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<{ queue: any[] }>('/v1/teacher/queue') });
  const [active, setActive] = useState<string[]>([]);
  const [modal, setModal] = useState<{ kind: 'grade' | 'flag'; item: Item } | null>(null);
  const [conflict, setConflict] = useState<any>(null);
  const [pane, setPane] = useState<'q' | 'c' | 'r'>('r');
  const [openCri, setOpenCri] = useState<string | null>('C1');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['review', svid] });
    void qc.invalidateQueries({ queryKey: ['queue'] });
  };

  const decide = useMutation({
    mutationFn: (v: { no: string; body: any }) => api(`/v1/reviews/${svid}/items/${v.no}/decision`, { body: v.body }),
    onSuccess: () => {
      setModal(null);
      refresh();
      toast('บันทึกแล้ว — เก็บทั้งค่าที่ระบบเสนอและค่าที่คุณให้');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REVIEW_CONFLICT') {
        setModal(null);
        setConflict(e.details?.theirs);
      }
    },
  });
  const bulk = useMutation({
    mutationFn: (cid: string) => api<any>(`/v1/reviews/${svid}/criteria/${cid}/accept`, { body: {} }),
    onSuccess: (r) => {
      refresh();
      toast(`ยืนยัน ${r.accepted.length} ข้อแล้ว · บันทึกเป็นการตัดสินใจครั้งเดียว`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.messageTh : 'ผิดพลาด'),
  });
  const undo = useMutation({ mutationFn: (it: Item) => api(`/v1/reviews/${svid}/items/${it.no}/undo`, { body: { rowVersion: it.rowVersion } }), onSuccess: refresh, onError: (e) => toast(e instanceof ApiError ? e.messageTh : 'ผิดพลาด') });
  const ann = useMutation({ mutationFn: (v: { no: string; code: string }) => api(`/v1/reviews/${svid}/items/${v.no}/annotations`, { body: { code: v.code } }), onSuccess: refresh });

  if (q.isLoading) return <Loading what="งาน" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  const items: Item[] = r.items;
  const released = !!r.release;
  const pending = items.filter((i) => i.status === 'AI_PROPOSED' || i.status === 'NO_PROPOSAL').length;
  const anchorFor = (codes: string[]) => r.anchors.filter((a: any) => codes.includes(a.code));

  return (
    <>
      <div className="page-h">
        <div>
          <h1>
            ตรวจงาน · {r.student.name}
          </h1>
          <p className="muted fs14">
            {r.assignment.title} ฉบับที่ {r.version.versionNo} · ใบรับงาน {r.version.receiptId} · ส่ง {dt(r.version.receivedAt)} · {r.version.words.toLocaleString()} คำ · {r.version.sha256}
          </p>
        </div>
        <div className="row">
          <Link className="btn" href="/t">
            กลับคิว
          </Link>
          <Link className={`btn ${pending === 0 && !released ? 'pri' : ''}`} href={`/t/release/${svid}`}>
            {released ? 'ดูผลที่ปล่อยแล้ว' : `ส่ง Feedback (${items.length - pending}/${items.length})`}
          </Link>
        </div>
      </div>
      {r.analysis?.status !== 'COMPLETED' && (
        <div className="rule warn">
          <b>การวิเคราะห์: {r.analysis?.status ?? '—'}</b>
          {r.analysis?.status === 'ABANDONED' ? 'AI ไม่พร้อมหลังลองซ้ำ ทุกข้อจึงเป็นสีเทา ตรวจได้ตามปกติโดยไม่มีข้อเสนอ' : 'กำลังเตรียมหลักฐาน'}
        </div>
      )}
      <div className="panel">
        <div className="panel-bar">
          <span>
            <strong>{r.rubric.name}</strong> · เส้นผ่าน {r.rubric.passMark.toFixed(1)} · ถ่วงน้ำหนัก{r.rubric.weighting === 'equal' ? 'เท่ากันทุกข้อ (ต้นฉบับไม่ระบุน้ำหนัก)' : 'ตามที่กำหนด'}
          </span>
          <span>
            เฉลี่ยข้อที่ยืนยันแล้ว <b>{r.summary.average !== null ? r.summary.average.toFixed(2) : '—'}</b> · ยืนยัน {r.summary.verified} · ส่งกลับ {r.summary.returned} · ค้าง {r.summary.pending}
          </span>
        </div>
        <div className="ptabs">
          {(
            [
              ['q', 'คิว'],
              ['c', 'บทความ'],
              ['r', 'เกณฑ์'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={pane === k ? 'on' : ''} onClick={() => setPane(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="three">
          <div className={`pane pane-l ${pane === 'q' ? 'act' : ''}`}>
            <div className="pane-title">คิวตรวจ</div>
            {queue.data?.queue.map((x) => (
              <Link key={x.version_id} href={`/t/review/${x.version_id}`} className={`qitem ${x.version_id === svid ? 'sel' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="qbadge" style={{ background: x.released ? 'var(--verified)' : 'var(--proposed)' }} />
                {x.student_name} · v{x.version_no}
              </Link>
            ))}
          </div>
          <div className={`pane pane-c ${pane === 'c' ? 'act' : ''}`}>
            <div className="pane-title">บทที่ส่ง · คลิกประโยคที่ขีดเส้นเพื่อดูว่าเป็นหลักฐานของข้อไหน</div>
            <Doc content={r.version.content} anchors={r.anchors} active={active} onPick={(c) => setActive([c])} />
            {r.version.revisionNote && <div className="rule info"><b>บันทึกการแก้ของผู้เรียน</b>{r.version.revisionNote}</div>}
            <details style={{ marginTop: 14 }}>
              <summary className="dim fs13">Diagnostic events ({r.diagnostics.length})</summary>
              {r.diagnostics.map((x: any, i: number) => (
                <div className="log" key={i}>
                  <b>{x.kind}</b> · {x.detail}
                </div>
              ))}
            </details>
          </div>
          <div className={`pane pane-r ${pane === 'r' ? 'act' : ''}`}>
            {r.criteria.map((c: any) => {
              const its = items.filter((i) => i.criterionId === c.id);
              const proposed = its.filter((i) => i.status === 'AI_PROPOSED').length;
              const open = openCri === c.id;
              return (
                <div className="crigrp" key={c.id}>
                  <div className="crigrp-h" onClick={() => setOpenCri(open ? null : c.id)} style={{ cursor: 'pointer' }}>
                    <h4>
                      <span className="no">{c.no}</span> {c.name}
                    </h4>
                    <p className="th">{c.th}</p>
                  </div>
                  {open && (
                    <div className="crigrp-b">
                      {its.map((it) => (
                        <div className="it" key={it.no} data-testid={`item-${it.no}`}>
                          <div className="it-h">
                            <span className="no">{it.no}</span>
                            <p>{it.text}</p>
                          </div>
                          <div className="it-row">
                            <Chip tone={REVIEW_ITEM_TONE[it.status]}>{REVIEW_ITEM_LABEL[it.status]}</Chip>
                            {it.status === 'VERIFIED' && it.grade && <span className="band v">{it.grade}</span>}
                            {it.status === 'AI_PROPOSED' && it.aiGrade && <span className="band p" title="ระบบเสนอ">{it.aiGrade}</span>}
                            {it.decidedBy && <span className="dim fs13">โดย {it.decidedBy}</span>}
                          </div>
                          <div className="it-body" style={{ marginTop: 7 }}>
                            {it.why && (
                              <div className={`evid ${it.status === 'VERIFIED' ? 'isv' : ''} ${it.anchors.length ? '' : 'none'}`} onClick={() => it.anchors.length && (setActive(it.anchors), setPane('c'))}>
                                {it.why}
                                {it.anchors.length > 0 && <div className="dim fs13">หลักฐาน {anchorFor(it.anchors).map((a: any) => `${a.code} ${a.loc ?? ''}`).join(' · ')}</div>}
                              </div>
                            )}
                            {it.reason && <div className="trail">เหตุผลของผู้ตรวจ: {it.reason}</div>}
                            {!released && (
                              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                                {it.status === 'AI_PROPOSED' && (
                                  <button className="btn sm pri" disabled={decide.isPending} onClick={() => decide.mutate({ no: it.no, body: { action: 'accept', rowVersion: it.rowVersion } })}>
                                    ยืนยัน {it.aiGrade}
                                  </button>
                                )}
                                {(it.status === 'AI_PROPOSED' || it.status === 'NO_PROPOSAL') && (
                                  <>
                                    <button className="btn sm" onClick={() => (decide.reset(), setModal({ kind: 'grade', item: it }))}>
                                      {it.status === 'NO_PROPOSAL' ? 'ให้เกรดเอง' : 'เปลี่ยนเกรด'}
                                    </button>
                                    <button className="btn sm warn" onClick={() => (decide.reset(), setModal({ kind: 'flag', item: it }))}>
                                      ส่งกลับให้แก้
                                    </button>
                                  </>
                                )}
                                {(it.status === 'VERIFIED' || it.status === 'RETURNED_FOR_REVISION') && (
                                  <button className="btn sm" onClick={() => undo.mutate(it)}>
                                    ย้อนกลับ
                                  </button>
                                )}
                                <span className="anns" aria-label="รหัส annotation">
                                  {Object.keys(r.annotations).map((k) => (
                                    <button key={k} className={`ann ${it.ann.includes(k) ? 'on' : ''}`} title={r.annotations[k]} onClick={() => ann.mutate({ no: it.no, code: k })}>
                                      {k}
                                    </button>
                                  ))}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="gsum">
                    <span>เฉลี่ยเกณฑ์นี้ {r.summary.byCriterion[c.id] != null ? r.summary.byCriterion[c.id].toFixed(2) : '—'}</span>
                    {!released && proposed > 0 && (
                      <button className="btn sm blue" disabled={bulk.isPending} onClick={() => bulk.mutate(c.id)}>
                        ยืนยันที่ระบบเสนอทั้งเกณฑ์ ({proposed})
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {modal?.kind === 'grade' && (
        <GradeModal item={modal.item} error={decide.error} onClose={() => setModal(null)} onSave={(g, reason) => decide.mutate({ no: modal.item.no, body: { action: 'grade', grade: g, reason, rowVersion: modal.item.rowVersion } })} />
      )}
      {modal?.kind === 'flag' && (
        <FlagModal item={modal.item} codes={r.annotations} error={decide.error} onClose={() => setModal(null)} onSave={(codes, reason) => decide.mutate({ no: modal.item.no, body: { action: 'flag', codes, reason, rowVersion: modal.item.rowVersion } })} />
      )}
      {conflict && (
        <Modal title="มีคนแก้ผลชิ้นนี้พร้อมกับคุณ" onClose={() => setConflict(null)}>
          <p className="muted">
            {conflict.decidedBy ?? 'ผู้ตรวจอีกคน'} บันทึกผลข้อนี้ไว้แล้ว{conflict.decidedAt ? ` เมื่อ ${dt(conflict.decidedAt)}` : ''} ฉบับที่คุณเปิดอยู่จึงเป็นเวอร์ชันเก่า
          </p>
          <div className="card">
            ค่าที่บันทึกไปแล้ว: <b>{conflict.status}</b> {conflict.grade ?? ''} {conflict.reason ? `· “${conflict.reason}”` : ''}
          </div>
          <p className="dim fs13" style={{ marginTop: 10 }}>ระบบไม่เขียนทับอัตโนมัติ · AC-11</p>
          <div className="row">
            <button
              className="btn pri"
              onClick={() => {
                setConflict(null);
                refresh();
              }}
            >
              โหลดฉบับล่าสุด
            </button>
            <button className="btn" onClick={() => setConflict(null)}>
              ปิดไว้ก่อน
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page({ params }: { params: Promise<{ svid: string }> }) {
  const { svid } = use(params);
  return (
    <Guard roles={['thesis_mentor', 'assistant_marker']}>
      <Review svid={svid} />
    </Guard>
  );
}
