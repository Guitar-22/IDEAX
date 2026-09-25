'use client';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { d, dt } from '@/lib/format';
import { Guard } from '@/components/Guard';
import { Snapshot } from '@/components/Snapshot';
import { Chip, ErrorBox, Field, Loading, Rule, useToast } from '@/components/ui';

const ICON = { ok: '✓', attention: '!', question: '?' } as const;

function Assignment({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['assignment', id], queryFn: () => api<any>(`/v1/assignments/${id}`) });
  const [tab, setTab] = useState<'brief' | 'work' | 'result' | 'verify' | 'ai'>('work');
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [pre, setPre] = useState<any>(null);
  const [disc, setDisc] = useState({ tool: '', part: '', confirmed: false });
  const [receipt, setReceipt] = useState<any>(null);
  const a = q.data;
  const sub = a?.submission;
  useEffect(() => {
    if (a?.lastContent && !content) setContent(a.lastContent);
    if (a?.disclosure && !disc.tool) setDisc({ tool: a.disclosure.tool, part: a.disclosure.part, confirmed: true });
    if (a?.precheck && !pre) setPre({ results: a.precheck.result, at: a.precheck.at });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  const feedback = useQuery({
    enabled: !!sub,
    queryKey: ['feedback', sub?.id],
    queryFn: () => api<any>(`/v1/submissions/${sub.id}/feedback`).catch((e) => (e instanceof ApiError && e.code === 'NOT_RELEASED' ? null : Promise.reject(e))),
  });
  const verification = useQuery({ enabled: !!sub && a?.assignment.verification, queryKey: ['verification', id], queryFn: () => api<any>(`/v1/assignments/${id}/verification`) });
  const chat = useQuery({ enabled: tab === 'ai', queryKey: ['aichat', id], queryFn: () => api<any>(`/v1/assignments/${id}/ai-chat`) });

  const precheck = useMutation({ mutationFn: () => api(`/v1/assignments/${id}/precheck`, { body: { content } }), onSuccess: (r) => setPre(r) });
  const saveDisc = useMutation({
    mutationFn: () => api(`/v1/assignments/${id}/disclosure`, { method: 'PUT', body: disc }),
    onSuccess: () => {
      toast('บันทึกคำชี้แจงการใช้ AI แล้ว');
      void qc.invalidateQueries({ queryKey: ['assignment', id] });
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      sub ? api<any>(`/v1/submissions/${sub.id}/versions`, { body: { content, revisionNote: note || undefined } }) : api<any>(`/v1/assignments/${id}/submissions`, { body: { content } }),
    onSuccess: (r) => {
      setReceipt(r);
      setPre(null);
      void qc.invalidateQueries();
    },
  });

  if (q.isLoading) return <Loading what="งาน" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const last = sub?.versions?.[sub.versions.length - 1];
  const precheckDone = !!pre;
  const canSend = a.canSubmit && precheckDone && (!a.assignment.requiresDisclosure || a.disclosure);

  return (
    <>
      <div className="page-h">
        <div>
          <h1>{a.assignment.title}</h1>
          <p className="muted fs14">
            {a.course.name} · กำหนดส่ง {d(a.assignment.dueAt)} · {a.assignment.minWords.toLocaleString()}–{a.assignment.maxWords.toLocaleString()} คำ
          </p>
        </div>
        {sub && <Chip tone={sub.status === 'FINALIZED' ? 'verified' : 'neutral'}>{sub.status}</Chip>}
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['brief', 'โจทย์และเกณฑ์'],
            ['work', sub ? 'ส่งฉบับใหม่ / ใบรับงาน' : 'ตรวจความพร้อมและส่ง'],
            ['result', 'ผลตรวจ'],
            ...(a.assignment.verification ? [['verify', 'ตรวจความเข้าใจ']] : []),
            ['ai', 'ผู้ช่วย AI'],
          ] as Array<[typeof tab, string]>
        ).map(([k, l]) => (
          <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'brief' && (
        <>
          <p>{a.assignment.brief}</p>
          <Rule kind="info" title={a.rubric.name}>
            เส้นผ่าน {a.rubric.passMark.toFixed(1)} · {a.rubric.weighting === 'equal' ? 'ต้นฉบับไม่ระบุน้ำหนัก ระบบจึงถ่วงเท่ากันทุกข้อ' : 'ถ่วงน้ำหนักตามที่กำหนด'}
          </Rule>
          {a.rubric.criteria.map((c: any) => (
            <div className="crigrp" key={c.id}>
              <div className="crigrp-h">
                <h4>
                  <span className="no">{c.no}</span> {c.name}
                </h4>
                <p className="th">{c.th}</p>
              </div>
              <div className="crigrp-b">
                {c.items.map((it: any) => (
                  <div className="it" key={it.no}>
                    <div className="it-h">
                      <span className="no">{it.no}</span>
                      <p>{it.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'work' && (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="stack">
            {receipt && (
              <div className="card" data-testid="receipt">
                <h3>ส่งงานเรียบร้อย · ใบรับงาน</h3>
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>รหัสใบรับงาน</dt>
                  <dd className="mono">{receipt.receipt.id}</dd>
                  <dt>เวลาที่ระบบรับ</dt>
                  <dd>{dt(receipt.receipt.receivedAt)} (เวลาเซิร์ฟเวอร์)</dd>
                  <dt>ฉบับที่</dt>
                  <dd>
                    {receipt.receipt.versionNo} · {receipt.receipt.words.toLocaleString()} คำ
                  </dd>
                  <dt>ลายนิ้วมือไฟล์</dt>
                  <dd className="mono">{receipt.receipt.sha256}</dd>
                  <dt>สถานะการวิเคราะห์</dt>
                  <dd>
                    <Chip tone="proposed">{receipt.analysis} · แยกจากการส่งงาน</Chip>
                  </dd>
                </dl>
              </div>
            )}
            {last && !receipt && (
              <div className="card">
                <h3>ฉบับล่าสุดที่ส่ง</h3>
                <p className="muted fs14 mb0">
                  ฉบับที่ {last.version_no} · {last.receipt_id} · {dt(last.received_at)} · การวิเคราะห์ {last.analysis}
                </p>
                {last.analysis === 'ABANDONED' && <p className="dim fs13">AI ไม่พร้อม แต่งานส่งแล้วและอาจารย์ตรวจได้ตามปกติ</p>}
              </div>
            )}
            {!a.canSubmit ? (
              <Rule kind="info" title="ยังส่งฉบับใหม่ไม่ได้">
                {sub?.status === 'FINALIZED' ? 'อาจารย์ปิดรอบงานนี้แล้ว' : 'รออาจารย์ปล่อยผลก่อน จึงส่งฉบับแก้ได้ · ฉบับเดิมยังอยู่ครบ'}
              </Rule>
            ) : (
              <>
                <Field label={sub ? 'ฉบับแก้ (วางเนื้อหาทั้งบท)' : 'เนื้อหาบทที่จะส่ง'}>
                  <textarea value={content} onChange={(e) => setContent(e.target.value)} style={{ minHeight: 260 }} data-testid="content" />
                </Field>
                {sub && (
                  <Field label="แก้อะไรไปบ้าง">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เพิ่มประโยค gap ท้าย §2.4 และแปลง Figure 2.1 เป็นตาราง" />
                  </Field>
                )}
                <div className="row">
                  <button className="btn" disabled={!content.trim() || precheck.isPending} onClick={() => precheck.mutate()}>
                    ตรวจความพร้อม (ยังไม่ส่ง)
                  </button>
                  <button className="btn pri" disabled={!canSend || submit.isPending} onClick={() => submit.mutate()} data-testid="submit">
                    {sub ? 'ส่งฉบับใหม่' : 'ส่งงาน'}
                  </button>
                </div>
                {!canSend && <p className="dim fs13">ต้องตรวจความพร้อมและบันทึกคำชี้แจงการใช้ AI ก่อน</p>}
                <ErrorBox error={submit.error ?? precheck.error} />
              </>
            )}
          </div>
          <div className="stack">
            {pre && (
              <div>
                <h3>ผลตรวจความพร้อม</h3>
                <p className="dim fs13">เป็นคำแนะนำเท่านั้น ไม่แก้ไฟล์ และไม่มีผลทางการ · ไม่มีเปอร์เซ็นต์ความพร้อม เพราะยัง calibrate ไม่ได้</p>
                {pre.results.map((r: any, i: number) => (
                  <div key={i} className="pc">
                    <span className={`pc-ic ${r.level === 'ok' ? 'ok' : 'att'}`}>{ICON[r.level as keyof typeof ICON]}</span>
                    <div>
                      <strong className="fs14">{r.title}</strong>
                      {r.detail && <p>{r.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {a.assignment.requiresDisclosure && (
              <div className="card">
                <h3>คำชี้แจงการใช้ AI</h3>
                <p className="dim fs13">แยกจากผลประเมินคุณภาพ</p>
                <Field label="เครื่องมือที่ใช้">
                  <input type="text" value={disc.tool} onChange={(e) => setDisc({ ...disc, tool: e.target.value })} placeholder="เช่น ผู้ช่วย AI สำหรับเรียบเรียงภาษาอังกฤษ หรือ ไม่ได้ใช้" />
                </Field>
                <Field label="ใช้กับส่วนไหน และคุณตรวจทานอะไรเอง">
                  <textarea value={disc.part} onChange={(e) => setDisc({ ...disc, part: e.target.value })} />
                </Field>
                <label className="check">
                  <input type="checkbox" checked={disc.confirmed} onChange={(e) => setDisc({ ...disc, confirmed: e.target.checked })} />
                  ข้าพเจ้ายืนยันว่าข้อความข้างต้นตรงกับสิ่งที่ทำจริง และรับผิดชอบเนื้อหาที่ส่ง
                </label>
                <ErrorBox error={saveDisc.error} />
                <button className="btn sm" disabled={!disc.tool.trim() || !disc.confirmed} onClick={() => saveDisc.mutate()}>
                  {a.disclosure ? 'บันทึกแล้ว · บันทึกใหม่' : 'บันทึกคำชี้แจง'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'result' &&
        (feedback.isLoading ? (
          <Loading what="ผลตรวจ" />
        ) : feedback.data ? (
          <Snapshot s={feedback.data} />
        ) : (
          <Rule kind="warn" title="ยังไม่มีผลที่อาจารย์ปล่อย">
            ข้อเสนอของ AI จะไม่แสดงให้ผู้เรียนเห็นก่อนอาจารย์ยืนยัน
          </Rule>
        ))}

      {tab === 'verify' && <Verification id={id} data={verification.data} refetch={() => verification.refetch()} />}

      {tab === 'ai' && <AiChat id={id} messages={chat.data?.messages ?? []} refetch={() => chat.refetch()} />}
    </>
  );
}

/** Verification mode: pasting is blocked and focus changes are recorded, never penalised automatically. */
function Verification({ id, data, refetch }: { id: string; data: any; refetch: () => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    const onBlur = () => void api(`/v1/assignments/${id}/integrity-events`, { body: { type: 'focus.lost' } }).catch(() => {});
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [id]);
  if (!data) return <Loading what="คำถาม" />;
  if (!data.questions.length) return <Rule kind="info">คำถามจะถูกสร้างจากงานของคุณหลังระบบวิเคราะห์ฉบับที่ส่งเสร็จ</Rule>;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <Rule kind="info" title="โหมด Verification">
        คำถามสร้างจากงานของคุณเอง ตอบด้วยคำพูดของคุณ · ปิดการวางข้อความในช่องนี้ เพื่อให้กลับมาคิด ไม่ใช่เพื่อจับผิด
      </Rule>
      {data.questions.map((q: any) => (
        <div className="card" key={q.position}>
          <p>{q.question}</p>
          {q.answer ? (
            <Chip tone="verified">ตอบแล้ว · {dt(q.answered_at)}</Chip>
          ) : (
            <>
              <textarea
                value={answers[q.position] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.position]: e.target.value })}
                onPaste={(e) => {
                  e.preventDefault();
                  void api(`/v1/assignments/${id}/integrity-events`, { body: { type: 'paste.blocked' } }).catch(() => {});
                }}
                data-testid={`verify-${q.position}`}
              />
              <button
                className="btn sm pri"
                style={{ marginTop: 6 }}
                disabled={!answers[q.position]?.trim()}
                onClick={async () => {
                  try {
                    await api(`/v1/assignments/${id}/verification/${q.position}`, { body: { answer: answers[q.position] } });
                    refetch();
                  } catch (e) {
                    setErr(e);
                  }
                }}
              >
                บันทึกคำตอบ
              </button>
            </>
          )}
        </div>
      ))}
      <ErrorBox error={err} />
    </div>
  );
}

function AiChat({ id, messages, refetch }: { id: string; messages: any[]; refetch: () => void }) {
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api(`/v1/assignments/${id}/ai-chat`, { body: { text } }),
    onSuccess: () => {
      setText('');
      refetch();
    },
  });
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h3>ผู้ช่วย AI ในแพลตฟอร์ม</h3>
      <p className="dim fs13">AI ถามกลับเพื่อช่วยคิด ไม่เขียนงานแทน · บทสนทนาเก็บไว้ให้อาจารย์เห็นกระบวนการ</p>
      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'student' ? 'me' : 'ai'}`} style={{ whiteSpace: 'pre-wrap' }}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="ถามหรือเล่าสิ่งที่กำลังคิด" style={{ flex: 1 }} />
        <button className="btn blue" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()}>
          ส่ง
        </button>
      </div>
      <ErrorBox error={send.error} />
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Guard roles={['learner']}>
      <Assignment id={id} />
    </Guard>
  );
}
