'use client';
/** Panels of the THAItern journey (docs/APP_FLOW.md §7). Each panel maps to one step of the server state machine. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BANDS, CANVAS_SECTIONS, CERTIFICATE_LEVELS, STAGES } from '@ideax/contracts';
import { api, ApiError, streamSse } from '@/lib/api';
import { baht, dt, left } from '@/lib/format';
import { Chip, ErrorBox, Field, Loading, Rule, useToast } from './ui';

type A = any;
const useRefresh = (id: string) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['attempt', id] });
    void qc.invalidateQueries({ queryKey: ['attempts'] });
  };
};

/* ───────── step 4a ───────── */
export function FirstDraft({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const [text, setText] = useState(a.firstDraft.text ?? '');
  const start = useMutation({ mutationFn: () => api(`/v1/attempts/${a.id}/first-draft/start`, { body: {} }), onSuccess: refresh });
  const save = useMutation({ mutationFn: (done: boolean) => api(`/v1/attempts/${a.id}/first-draft`, { method: 'PUT', body: { text, done } }), onSuccess: refresh });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const started = a.firstDraft.startedAt ? new Date(a.firstDraft.startedAt).getTime() : null;
  const remain = started ? Math.max(0, started + a.firstDraft.minutes * 60000 - now) : null;
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card">
        <span className="pill">โจทย์ย่อ · ยังไม่ใช่ข้อมูลลับ</span>
        <h3 style={{ marginTop: 8 }}>{a.challengeBrief}</h3>
        <p className="muted fs14">ลองร่างคำตอบแรกก่อนเรียน ไม่ต้องถูก · งานวิจัย Productive Failure พบว่าการลองก่อนทำให้เรียนเข้าใจลึกกว่า และร่างนี้ใช้วัดพัฒนาการของคุณเอง ไม่นับคะแนน</p>
      </div>
      <div className="card">
        {!started ? (
          <button className="btn pri" onClick={() => start.mutate()} data-testid="start-draft">
            เริ่มจับเวลา 30 นาที
          </button>
        ) : (
          <>
            <div className="between">
              <b>ร่างคำตอบแรก</b>
              <span className="mono">{remain !== null ? `${Math.floor(remain / 60000)}:${String(Math.floor((remain % 60000) / 1000)).padStart(2, '0')}` : ''}</span>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 180, marginTop: 8 }} placeholder="ปัญหาจริงน่าจะเป็นอะไร เพราะอะไร จะเริ่มแก้ตรงไหน" data-testid="first-draft" />
            <ErrorBox error={save.error} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => save.mutate(false)}>
                บันทึกร่าง
              </button>
              <button className="btn pri" onClick={() => save.mutate(true)} data-testid="draft-done">
                ส่งร่างแรกแล้วไปเรียน
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────── step 4 ───────── */
export function Learning({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const q = useQuery({ queryKey: ['sessions', a.id], queryFn: () => api<any>(`/v1/attempts/${a.id}/sessions`) });
  const [open, setOpen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const complete = useMutation({
    mutationFn: (key: string) => api(`/v1/attempts/${a.id}/sessions/${key}/complete`, { body: {} }),
    onSuccess: () => {
      void q.refetch();
      refresh();
    },
  });
  const quiz = useMutation({ mutationFn: () => api<any>(`/v1/attempts/${a.id}/quiz`, { body: { answers } }), onSuccess: refresh });
  if (!q.data) return <Loading what="บทเรียน" />;
  const allDone = q.data.sessions.every((s: any) => s.done);
  return (
    <div className="stack">
      {q.data.sessions.map((s: any, i: number) => (
        <div className="card" key={s.key}>
          <div className="between" onClick={() => setOpen(open === s.key ? null : s.key)} style={{ cursor: 'pointer' }}>
            <div>
              <span className="dim fs13">เซสชัน {i + 1}</span>
              <h3>{s.title}</h3>
              <p className="dim fs13 mb0">{s.frameworks.join(' · ')}</p>
            </div>
            {s.done ? <Chip tone="verified">เรียนแล้ว</Chip> : <Chip tone="neutral">ยังไม่เรียน</Chip>}
          </div>
          {open === s.key && (
            <div style={{ marginTop: 10 }}>
              <ul>
                {s.summary.map((t: string) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              {!s.done && (
                <button className="btn sm pri" onClick={() => complete.mutate(s.key)} data-testid={`complete-${s.key}`}>
                  เรียนจบเซสชันนี้
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="card">
        <h3>แบบทดสอบ · ผ่านเมื่อได้ {q.data.passPercent}% ขึ้นไป</h3>
        {!allDone && <p className="dim fs13">เรียนให้ครบทุกเซสชันก่อน</p>}
        {q.data.quizScore !== null && <p className="fs14">คะแนนที่ดีที่สุด {q.data.quizScore}%</p>}
        {allDone &&
          q.data.quiz.map((qq: any, i: number) => (
            <fieldset key={qq.id} style={{ border: 'none', padding: 0, margin: '10px 0' }}>
              <legend className="fs14">
                {i + 1}. {qq.q}
              </legend>
              {qq.choices.map((c: string, ci: number) => (
                <label key={ci} className="check" style={{ padding: '3px 0' }}>
                  <input type="radio" name={qq.id} checked={answers[qq.id] === ci} onChange={() => setAnswers({ ...answers, [qq.id]: ci })} data-testid={`q-${qq.id}-${ci}`} />
                  {c}
                </label>
              ))}
            </fieldset>
          ))}
        {quiz.data && !quiz.data.passed && <Rule kind="warn">ได้ {quiz.data.score}% ยังไม่ถึง 80% ทบทวนแล้วลองใหม่ได้</Rule>}
        <ErrorBox error={quiz.error} />
        {allDone && (
          <button className="btn pri" disabled={Object.keys(answers).length < q.data.quiz.length} onClick={() => quiz.mutate()} data-testid="submit-quiz">
            ส่งแบบทดสอบ
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────── step 5 ───────── */
export function Unlock({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const [code, setCode] = useState('');
  const unlock = useMutation({ mutationFn: () => api(`/v1/attempts/${a.id}/unlock`, { body: { code } }), onSuccess: refresh });
  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h3>ปลดล็อก Case Booklet</h3>
      <p className="muted fs14">รหัสผ่านถูกส่งถึงอีเมลของคุณ · เมื่อปลดล็อกแล้วจะเริ่มนับเวลาส่งงาน 14 วัน · ข้อมูลในเคสได้รับความยินยอมจากเจ้าของแล้ว และห้ามเผยแพร่ต่อ</p>
      {a.unlock.devAccessCode && (
        <Rule kind="info" title="โหมดเดโม">
          รหัสในอีเมลคือ <b className="mono" data-testid="access-code">{a.unlock.devAccessCode}</b>
        </Rule>
      )}
      <div className="stack" style={{ margin: '10px 0' }}>
        {a.team.members.map((m: any) => (
          <div key={m.id} className="row fs14">
            {m.verified ? <Chip tone="verified">ยืนยันบัตรแล้ว</Chip> : <Chip tone="attention">ยังไม่ยืนยันบัตร</Chip>} {m.name}
          </div>
        ))}
      </div>
      <Field label="รหัสผ่าน">
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="TX-0000-0000" />
      </Field>
      <ErrorBox error={unlock.error} />
      <button className="btn pri" disabled={!code.trim()} onClick={() => unlock.mutate()} data-testid="unlock">
        ปลดล็อกและเริ่มนับเวลา
      </button>
    </div>
  );
}

/* ───────── step 6: booklet, data room, stakeholder chat ───────── */
export function Booklet({ a }: { a: A }) {
  const q = useQuery({ queryKey: ['booklet', a.id], queryFn: () => api<any>(`/v1/attempts/${a.id}/booklet`) });
  if (!q.data) return <Loading what="Case Booklet" />;
  return (
    <div className="stack">
      <Rule kind="warn" title="ข้อมูลลับของเจ้าของโจทย์">อ่านบนเว็บเท่านั้น ห้ามคัดลอก ถ่ายภาพหน้าจอ หรือส่งต่อ · มีลายน้ำชื่อของคุณ</Rule>
      <div className="panel watermark" data-wm={`${q.data.watermark}\n${q.data.watermark}\n${q.data.watermark}`} style={{ padding: 18, userSelect: 'none' }} onCopy={(e) => e.preventDefault()}>
        {q.data.pages.map((p: any) => (
          <section key={p.title} style={{ marginBottom: 16 }}>
            <h3>{p.title}</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p>
          </section>
        ))}
        <h3>POS Data Room</h3>
        {q.data.dataRoom.map((t: any) => (
          <div key={t.name} className="tbl" style={{ margin: '10px 0' }}>
            <div className="tbl-scroll">
              <table>
                <caption className="fs13" style={{ textAlign: 'left', padding: '8px 12px' }}>
                  <b>{t.name}</b> {t.note ? `· ${t.note}` : ''}
                </caption>
                <thead>
                  <tr>
                    {t.columns.map((c: string) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r: any[], i: number) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{typeof c === 'number' ? c.toLocaleString() : c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StakeholderChat({ a }: { a: A }) {
  const booklet = useQuery({ queryKey: ['booklet', a.id], queryFn: () => api<any>(`/v1/attempts/${a.id}/booklet`) });
  const [persona, setPersona] = useState<string | null>(null);
  const key = persona ?? booklet.data?.personas[0]?.key;
  const hist = useQuery({ enabled: !!key, queryKey: ['persona', a.id, key], queryFn: () => api<any>(`/v1/attempts/${a.id}/personas/${key}/messages`) });
  const [text, setText] = useState('');
  const [live, setLive] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function ask() {
    setErr(null);
    setLive('');
    const q = text;
    setText('');
    try {
      await streamSse(`/v1/attempts/${a.id}/personas/${key}/messages`, { text: q }, (t) => setLive((cur) => (cur ?? '') + t));
    } catch (e) {
      setErr(e);
    }
    setLive(null);
    void hist.refetch();
  }
  if (!booklet.data) return <Loading />;
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="stack">
        {booklet.data.personas.map((p: any) => (
          <button key={p.key} className={`persona ${p.key === key ? 'on' : ''}`} onClick={() => setPersona(p.key)} style={p.key === key ? { borderColor: 'var(--proposed)' } : undefined}>
            <strong>{p.name}</strong>
            <span>{p.intro}</span>
          </button>
        ))}
        <p className="dim fs13">ตัวละครเป็น AI ที่ตอบจากข้อมูลในเคสเท่านั้น ถ้าไม่มีข้อมูลจะบอกว่าไม่ทราบ</p>
      </div>
      <div className="card">
        <div className="chat" aria-live="polite">
          {hist.data?.messages.map((m: any, i: number) => (
            <div key={i} className={`bubble ${m.role === 'learner' ? 'me' : 'ai'}`}>
              {m.text}
            </div>
          ))}
          {live !== null && <div className="bubble ai">{live || '…'}</div>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="ถามเรื่องที่อยากรู้" style={{ flex: 1 }} onKeyDown={(e) => e.key === 'Enter' && text.trim() && ask()} data-testid="persona-input" />
          <button className="btn blue" disabled={!text.trim() || live !== null} onClick={ask}>
            ถาม
          </button>
        </div>
        <ErrorBox error={err} />
      </div>
    </div>
  );
}

/* ───────── step 7: Strategy Canvas ───────── */
export function Canvas({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>(a.canvas ?? {});
  const [coach, setCoach] = useState<Record<string, any>>({});
  const editable = ['IN_PROGRESS', 'PUSHBACK', 'FINALIZING'].includes(a.state);
  async function save(k: string) {
    await api(`/v1/attempts/${a.id}/canvas/${k}`, { method: 'PUT', body: { text: vals[k] ?? '' } });
    refresh();
    toast('บันทึกแล้ว');
  }
  async function ask(k: string) {
    await save(k);
    try {
      setCoach({ ...coach, [k]: await api(`/v1/attempts/${a.id}/canvas/${k}/coach`, { body: {} }) });
    } catch (e) {
      toast(e instanceof ApiError ? e.messageTh : 'ผิดพลาด');
    }
  }
  return (
    <div className="stack">
      <Rule kind="info">AI ถามกลับและชี้ส่วนที่ขาดหลักฐาน แต่ไม่เขียนแทน · การขอคำใบ้ถือเป็นตัวช่วย ขั้นนั้นจะไม่นับเป็น Solo</Rule>
      {CANVAS_SECTIONS.map((s) => {
        const lvl = a.support?.[s.stage];
        return (
          <div className="card" key={s.key}>
            <div className="between">
              <h3>
                {s.name} <span className="dim fs13">· Stage {s.stage} {STAGES[s.stage - 1].th}</span>
              </h3>
              {lvl && <span className="pill">{lvl}</span>}
            </div>
            {lvl === 'WATCH' && <p className="dim fs13">ตัวอย่าง: “ของเสียสาขา A เพิ่มจาก 5% เป็น 18% ใน 4 เดือน ขณะที่สาขา B คงที่ ต้นเหตุจึงน่าจะอยู่ที่วิธีผลิตของสาขา A ไม่ใช่ราคา”</p>}
            <textarea value={vals[s.key] ?? ''} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} disabled={!editable} data-testid={`canvas-${s.key}`} />
            {editable && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={() => save(s.key)} data-testid={`save-${s.key}`}>
                  บันทึก
                </button>
                {lvl !== 'SOLO' && (
                  <button className="btn sm blue" onClick={() => ask(s.key)}>
                    ขอคำถามจาก AI Coach
                  </button>
                )}
              </div>
            )}
            {coach[s.key] && (
              <div className="evid" style={{ marginTop: 8, cursor: 'default' }}>
                <span className="band p">{BANDS[coach[s.key].band - 1].name}</span> ระบบเสนอ
                <ul style={{ margin: '6px 0 0' }}>
                  {coach[s.key].questions.map((q: string) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────── step 8: Supervisor Pushback ───────── */
export function Pushback({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const [defense, setDefense] = useState('');
  const start = useMutation({ mutationFn: () => api(`/v1/attempts/${a.id}/pushback/start`, { body: {} }), onSuccess: refresh });
  const respond = useMutation({
    mutationFn: () => api<any>(`/v1/attempts/${a.id}/pushback/respond`, { body: { defense } }),
    onSuccess: () => {
      setDefense('');
      refresh();
    },
  });
  if (a.state === 'IN_PROGRESS')
    return (
      <div className="card" style={{ maxWidth: 680 }}>
        <h3>ถูกท้าทายก่อนไปต่อ</h3>
        <p className="muted fs14">AI สวมบท Senior Consultant โต้แย้งสมมติฐานของคุณ ต้องตอบด้วยข้อมูลจึงผ่านไปขั้นถัดไป</p>
        <ErrorBox error={start.error} />
        <button className="btn pri" onClick={() => start.mutate()} data-testid="start-pushback">
          เริ่มถูกท้าทาย
        </button>
      </div>
    );
  const last = a.pushback.last;
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="between">
        <h3>Supervisor Pushback · รอบที่ {a.pushback.round}</h3>
        {a.pushback.passedAt && <Chip tone="verified">ผ่านแล้ว</Chip>}
      </div>
      {last && (
        <>
          <div className="bubble ai" style={{ maxWidth: '100%', margin: '10px 0' }}>
            <b>Senior Consultant:</b> {last.challenge}
          </div>
          {last.defense && (
            <>
              <div className="bubble me" style={{ marginLeft: 'auto' }}>{last.defense}</div>
              {last.why && <p className={last.passed ? 'okmsg' : 'dim fs13'}>{last.why}</p>}
            </>
          )}
        </>
      )}
      {a.state === 'PUSHBACK' && (
        <>
          <textarea value={defense} onChange={(e) => setDefense(e.target.value)} placeholder="ตอบข้อโต้แย้งด้วยข้อมูลจาก Data Room หรือการสัมภาษณ์" data-testid="defense" />
          <ErrorBox error={respond.error} />
          <button className="btn pri" style={{ marginTop: 6 }} disabled={!defense.trim()} onClick={() => respond.mutate()} data-testid="send-defense">
            ตอบ
          </button>
        </>
      )}
    </div>
  );
}

/* ───────── step 9: Financial Simulator ───────── */
export function Simulator({ a }: { a: A }) {
  const booklet = useQuery({ queryKey: ['booklet', a.id], queryFn: () => api<any>(`/v1/attempts/${a.id}/booklet`) });
  const f = booklet.data?.finance;
  const [inp, setInp] = useState<{ price: number; marketing: number; headcount: number } | null>(null);
  useEffect(() => {
    if (f && !inp) setInp({ price: f.basePrice, marketing: f.baseMarketing, headcount: f.baseHeadcount });
  }, [f, inp]);
  const run = useMutation({ mutationFn: () => api<any>(`/v1/attempts/${a.id}/simulate`, { body: inp }) });
  if (!f || !inp) return <Loading />;
  const o = run.data?.outputs;
  const b = run.data?.baseline;
  return (
    <div className="stack">
      <div className="card">
        <h3>Financial Simulator</h3>
        <p className="dim fs13">คำนวณจากพารามิเตอร์ของเคส ไม่ใช้ AI · ผลเดิมทุกครั้งเมื่อใส่ค่าเดิม</p>
        <div className="sim-grid">
          <Field label={`ราคาต่อ${f.unit} (บาท)`}>
            <input type="number" value={inp.price} onChange={(e) => setInp({ ...inp, price: Number(e.target.value) })} />
          </Field>
          <Field label="งบการตลาดต่อเดือน (บาท)">
            <input type="number" value={inp.marketing} onChange={(e) => setInp({ ...inp, marketing: Number(e.target.value) })} />
          </Field>
          <Field label="จำนวนพนักงาน">
            <input type="number" value={inp.headcount} onChange={(e) => setInp({ ...inp, headcount: Number(e.target.value) })} />
          </Field>
        </div>
        <button className="btn blue" onClick={() => run.mutate()} data-testid="simulate">
          คำนวณ
        </button>
        <ErrorBox error={run.error} />
      </div>
      {o && (
        <div className="dash-grid">
          {[
            ['ขายได้', `${o.units.toLocaleString()} ${run.data.unit}`, `เดิม ${b.units.toLocaleString()}${o.capacityBound ? ' · ติดกำลังผลิต' : ''}`],
            ['รายได้', baht(o.revenue), `เดิม ${baht(b.revenue)}`],
            ['กำไร', baht(o.profit), `เดิม ${baht(b.profit)}`],
            ['จุดคุ้มทุน', o.breakEvenUnits ? `${o.breakEvenUnits.toLocaleString()} ${run.data.unit}` : '—', 'ต่อเดือน'],
          ].map(([l, v, s]) => (
            <div className="stat" key={l}>
              <div className="stat-n" style={{ fontSize: 22 }}>{v}</div>
              <div className="stat-l">{l}</div>
              <div className="stat-s">{s}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── step 12 + submit ───────── */
export function Submit({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  const pre = useMutation({ mutationFn: () => api<any>(`/v1/attempts/${a.id}/precheck`, { body: { answers } }) });
  const submit = useMutation({ mutationFn: () => api<any>(`/v1/attempts/${a.id}/submit`, { body: { answers, summary } }), onSuccess: refresh });
  if (a.state !== 'FINALIZING') return <Rule kind="info">ต้องผ่านการท้าทายในขั้นที่ 8 ก่อนจึงส่งงานได้</Rule>;
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h3>ตอบคำถามของเจ้าของโจทย์</h3>
        {a.questions.map((q: any) => (
          <Field key={q.id} label={q.q}>
            <textarea value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} data-testid={`answer-${q.id}`} />
          </Field>
        ))}
        <Field label="สรุปข้อเสนอ (Executive Summary)">
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} data-testid="summary" />
        </Field>
        <div className="row">
          <button className="btn" onClick={() => pre.mutate()} data-testid="precheck">
            AI ตรวจก่อนส่ง
          </button>
          <button className="btn pri" disabled={!summary.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="final-submit">
            ส่งงาน
          </button>
        </div>
        <ErrorBox error={submit.error} />
      </div>
      <div>
        {pre.data && (
          <>
            <h3>AI ตรวจก่อนส่ง</h3>
            <p className="dim fs13">ตรวจความครบถ้วนและเหตุผล แต่ไม่ใช่ผู้ตัดสิน</p>
            {pre.data.results.map((r: any, i: number) => (
              <div key={i} className="pc">
                <span className={`pc-ic ${r.level === 'ok' ? 'ok' : 'att'}`}>{r.level === 'ok' ? '✓' : r.level === 'question' ? '?' : '!'}</span>
                <div>
                  <strong className="fs14">{r.title}</strong>
                  {r.detail && <p>{r.detail}</p>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────── steps 13–14 ───────── */
export function Result({ a }: { a: A }) {
  const refresh = useRefresh(a.id);
  const fb = useQuery({ queryKey: ['tfeedback', a.id, a.state], queryFn: () => api<any>(`/v1/attempts/${a.id}/feedback`).catch((e) => (e instanceof ApiError && e.code === 'NOT_RELEASED' ? null : Promise.reject(e))) });
  const ver = useQuery({ queryKey: ['tver', a.id, a.state], queryFn: () => api<any>(`/v1/attempts/${a.id}/verification`) });
  const [ans, setAns] = useState<Record<number, string>>({});
  const answer = useMutation({ mutationFn: (p: number) => api(`/v1/attempts/${a.id}/verification/${p}`, { body: { answer: ans[p] } }), onSuccess: () => (ver.refetch(), refresh()) });
  if (a.state === 'SUBMITTED')
    return (
      <div className="card" style={{ maxWidth: 680 }} data-testid="t-receipt">
        <h3>ส่งงานเรียบร้อย</h3>
        <dl className="kv">
          <dt>ใบรับงาน</dt>
          <dd className="mono">{a.submission.receipt_id}</dd>
          <dt>เวลาที่ระบบรับ</dt>
          <dd>{dt(a.submission.received_at)}</dd>
          <dt>การคัดกรอง</dt>
          <dd>
            <Chip tone="proposed">AI {a.submission.ai_status}</Chip>
          </dd>
        </dl>
        <p className="dim fs13" style={{ marginTop: 10 }}>ผลคัดกรองของ AI ไม่ใช่ผลทางการ · กรรมการและเจ้าของโจทย์จะให้ Feedback ทุกทีม</p>
      </div>
    );
  if (a.state === 'EXPIRED') return <Rule kind="warn" title="หมดเวลา 14 วัน">เคสนี้ปิดแล้ว รอบหน้าเลือกโจทย์ใหม่ได้</Rule>;
  if (!fb.data) return <Loading what="ผล" />;
  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <h3>Feedback จากกรรมการและเจ้าของโจทย์</h3>
          {fb.data.smeChoice && <Chip tone="verified">SME’s Choice</Chip>}
        </div>
        <div className="row" style={{ margin: '10px 0' }}>
          {fb.data.bands.map((b: any) => (
            <span key={b.key} className="pill">
              {b.name}: <span className="band v">{BANDS[b.band - 1].name}</span>
            </span>
          ))}
        </div>
        {fb.data.judgeFeedback && <div className="dsec"><b>กรรมการ</b>{fb.data.judgeFeedback}</div>}
        {fb.data.ownerFeedback && <div className="dsec"><b>เจ้าของโจทย์</b>{fb.data.ownerFeedback}</div>}
      </div>
      <div className="card">
        <h3>ตรวจความเข้าใจก่อนออกใบรับรอง</h3>
        {ver.data?.certificate ? (
          <div className="okmsg" data-testid="certificate">
            ได้รับใบรับรองระดับ <b>{CERTIFICATE_LEVELS[ver.data.certificate.level as keyof typeof CERTIFICATE_LEVELS]}</b> · รหัสตรวจสอบ <span className="mono">{ver.data.certificate.verify_code}</span> ·{' '}
            <a href={`/verify/${ver.data.certificate.verify_code}`}>ลิงก์ตรวจสอบสาธารณะ</a>
          </div>
        ) : (
          ver.data?.questions.map((q: any) => (
            <div key={q.position} style={{ marginBottom: 10 }}>
              <p className="fs14">{q.question}</p>
              {q.answer ? (
                <Chip tone="verified">ตอบแล้ว</Chip>
              ) : (
                <>
                  <textarea value={ans[q.position] ?? ''} onChange={(e) => setAns({ ...ans, [q.position]: e.target.value })} onPaste={(e) => e.preventDefault()} data-testid={`tverify-${q.position}`} />
                  <button className="btn sm pri" style={{ marginTop: 6 }} disabled={!ans[q.position]?.trim()} onClick={() => answer.mutate(q.position)}>
                    บันทึกคำตอบ
                  </button>
                </>
              )}
            </div>
          ))
        )}
        <ErrorBox error={answer.error} />
      </div>
    </div>
  );
}

export function Deadline({ a }: { a: A }) {
  if (!a.unlock.deadlineAt) return null;
  return (
    <span className="pill" data-testid="deadline">
      ส่งภายใน {dt(a.unlock.deadlineAt)} · เหลือ {left(a.unlock.msLeft)}
    </span>
  );
}
