'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSET_MARKINGS, BANDS } from '@ideax/contracts';
import { api } from '@/lib/api';
import { d, dt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Guard } from '@/components/Guard';
import { Chip, ErrorBox, Field, Loading, Modal, Rule, Steps, useToast } from '@/components/ui';

const PIPE = [
  { key: 'INTAKE', name: 'รับข้อมูล' },
  { key: 'ANONYMIZING', name: 'ปกปิดตัวตน' },
  { key: 'DRAFTING', name: 'ร่าง Booklet' },
  { key: 'EXPERT_REVIEW', name: 'ผู้เชี่ยวชาญตรวจ' },
  { key: 'OWNER_APPROVAL', name: 'เจ้าของอนุมัติ' },
  { key: 'PUBLISHED', name: 'เผยแพร่' },
];
const MARK_LABEL: Record<string, string> = { confidential: 'ลับ', pii: 'ข้อมูลบุคคล', no_learner: 'ห้ามแสดงผู้เรียน', time_bound: 'ใช้ได้ถึงวันที่' };

function Production({ c, agreement, assets, role, refresh }: any) {
  const toast = useToast();
  const [asset, setAsset] = useState<any>(null);
  const [mask, setMask] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const call = useMutation({
    mutationFn: (v: { path: string; body?: any }) => api<any>(`/v1/partner/cases/${c.id}/${v.path}`, { body: v.body ?? {} }),
    onSuccess: (r) => {
      toast(r.status ? `สถานะ: ${r.status}` : 'บันทึกแล้ว');
      refresh();
    },
  });
  const idx = PIPE.findIndex((p) => p.key === c.status);
  return (
    <>
      <Steps items={PIPE} current={c.status} done={(k) => idx >= 0 && PIPE.findIndex((p) => p.key === k) < idx} />
      <ErrorBox error={call.error} />
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>ข้อตกลงอนุญาตใช้ข้อมูล</h3>
          <p className="fs14">
            {agreement?.signed_at ? <Chip tone="verified">ลงนามแล้ว {d(agreement.signed_at)}</Chip> : <Chip tone="attention">ยังไม่ลงนาม</Chip>} · อายุ {agreement?.term_years} ปี · ระงับการเผยแพร่ภายใน {agreement?.takedown_days} วันทำการเมื่อขอ
          </p>
          {role === 'case_owner' && !agreement?.signed_at && (
            <button className="btn pri" onClick={() => call.mutate({ path: 'agreement/sign' })} data-testid="sign">
              ลงนามข้อตกลง
            </button>
          )}
          <h3 style={{ marginTop: 14 }}>ข้อมูลที่ส่งมา ({assets.length})</h3>
          {assets.map((a: any) => (
            <div key={a.id} className="dsec">
              <b>{a.name} · {a.kind}</b>
              {a.markings.map((m: string) => <span key={m} className="pill" style={{ marginRight: 4 }}>{MARK_LABEL[m]}</span>)}
              <div className="fs13" style={{ whiteSpace: 'pre-wrap', maxHeight: 90, overflow: 'hidden' }}>{a.anonymized_content ?? a.content}</div>
              {a.anonymized_content && <span className="dim fs13">ปกปิดแล้ว</span>}
            </div>
          ))}
          {(role === 'case_owner' || role === 'case_ops') && ['INTAKE', 'ANONYMIZING'].includes(c.status) && (
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAsset({ kind: 'brief', name: '', content: '', markings: [] })} data-testid="add-asset">
              ส่งข้อมูลเพิ่ม
            </button>
          )}
        </div>
        <div className="stack">
          {role === 'case_ops' && ['INTAKE', 'ANONYMIZING'].includes(c.status) && (
            <div className="card">
              <h3>ปกปิดข้อมูลระบุตัวบุคคล</h3>
              <p className="dim fs13">ระบบปกปิดเบอร์โทร อีเมล เลขประจำตัว และไลน์อัตโนมัติ · ใส่ชื่อบุคคลที่ต้องปกปิดเพิ่มได้</p>
              <Field label="ชื่อที่ต้องปกปิด (คั่นด้วย ,)">
                <input type="text" value={mask} onChange={(e) => setMask(e.target.value)} />
              </Field>
              <button className="btn" onClick={() => call.mutate({ path: 'anonymize', body: { maskTerms: mask.split(',').map((s) => s.trim()).filter(Boolean) } })}>
                ปกปิดตัวตน
              </button>
            </div>
          )}
          {role === 'case_ops' && ['ANONYMIZING', 'DRAFTING'].includes(c.status) && (
            <div className="card">
              <h3>ร่าง Case Booklet</h3>
              <p className="dim fs13">ข้อมูลที่ทำเครื่องหมาย “ห้ามแสดงผู้เรียน” “ข้อมูลบุคคล” หรือหมดอายุ จะไม่เข้า Booklet</p>
              <button className="btn blue" onClick={() => call.mutate({ path: 'draft' })}>
                สร้างร่าง
              </button>
            </div>
          )}
          {['EXPERT_REVIEW', 'OWNER_APPROVAL', 'PUBLISHED', 'SUSPENDED'].includes(c.status) && (
            <button className="btn" onClick={async () => setPreview(await api(`/v1/partner/cases/${c.id}/preview`))}>
              ดูฉบับที่ผู้เรียนจะเห็น
            </button>
          )}
          {role === 'case_reviewer' && c.status === 'EXPERT_REVIEW' && (
            <div className="card">
              <h3>ผลการตรวจของผู้เชี่ยวชาญ</h3>
              <Field label="ความเห็น (บังคับ)">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="row">
                <button className="btn pri" disabled={!notes.trim()} onClick={() => call.mutate({ path: 'expert-review', body: { decision: 'approve', notes } })} data-testid="expert-approve">
                  ผ่าน ส่งให้เจ้าของอนุมัติ
                </button>
                <button className="btn" disabled={!notes.trim()} onClick={() => call.mutate({ path: 'expert-review', body: { decision: 'revise', notes } })}>
                  ขอแก้
                </button>
              </div>
            </div>
          )}
          {role === 'case_owner' && c.status === 'OWNER_APPROVAL' && (
            <div className="card">
              <h3>อนุมัติก่อนเผยแพร่</h3>
              <p className="dim fs13">ตรวจโดย {c.reviewed_by_name} · {c.review_notes}</p>
              <div className="row">
                <button className="btn pri" onClick={() => call.mutate({ path: 'owner-approval', body: { approve: true } })} data-testid="owner-approve">
                  อนุมัติเผยแพร่
                </button>
                <button className="btn" onClick={() => call.mutate({ path: 'owner-approval', body: { approve: false, notes: 'ขอแก้' } })}>
                  ขอแก้
                </button>
              </div>
            </div>
          )}
          {role === 'case_owner' && c.status === 'PUBLISHED' && (
            <div className="card">
              <h3>ระงับการเผยแพร่</h3>
              <p className="dim fs13">ปิดการปลดล็อกใหม่ทันที · ทีมที่เริ่มแล้วทำต่อได้จนจบรอบ</p>
              <button className="btn warn" onClick={() => call.mutate({ path: 'takedown', body: { reason: 'เจ้าของขอระงับ' } })}>
                ขอระงับ
              </button>
            </div>
          )}
          {role === 'case_owner' && c.status === 'SUSPENDED' && (
            <button className="btn" onClick={() => call.mutate({ path: 'reinstate' })}>
              เปิดให้ปลดล็อกอีกครั้ง
            </button>
          )}
        </div>
      </div>
      {asset && (
        <Modal title="ส่งข้อมูลให้ทีมผลิตเคส" onClose={() => setAsset(null)}>
          <Field label="ประเภท">
            <select value={asset.kind} onChange={(e) => setAsset({ ...asset, kind: e.target.value })}>
              {['brief', 'audio_transcript', 'data', 'persona', 'finance', 'question', 'other'].map((k) => <option key={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="ชื่อไฟล์"><input type="text" value={asset.name} onChange={(e) => setAsset({ ...asset, name: e.target.value })} /></Field>
          <Field label="เนื้อหา" hint="data = CSV · persona / finance = JSON · question = หนึ่งบรรทัดต่อคำถาม">
            <textarea value={asset.content} onChange={(e) => setAsset({ ...asset, content: e.target.value })} />
          </Field>
          <Field label="ทำเครื่องหมาย">
            {ASSET_MARKINGS.map((m) => (
              <label key={m} className="check">
                <input type="checkbox" checked={asset.markings.includes(m)} onChange={(e) => setAsset({ ...asset, markings: e.target.checked ? [...asset.markings, m] : asset.markings.filter((x: string) => x !== m) })} />
                {MARK_LABEL[m]}
              </label>
            ))}
          </Field>
          <ErrorBox error={call.error} />
          <button className="btn pri" onClick={() => call.mutate({ path: 'assets', body: asset }, { onSuccess: () => setAsset(null) })}>
            ส่ง
          </button>
        </Modal>
      )}
      {preview && (
        <Modal title="ฉบับที่ผู้เรียนจะเห็น" onClose={() => setPreview(null)}>
          <p className="dim fs13">Teaser: {preview.teaser}</p>
          {preview.booklet.map((p: any) => (
            <div key={p.title} className="dsec">
              <b>{p.title}</b>
              {p.body}
            </div>
          ))}
          <div className="dsec"><b>คำถามของเจ้าของโจทย์</b>{preview.questions.map((q: any) => q.q).join(' · ')}</div>
        </Modal>
      )}
    </>
  );
}

function Evaluation({ c, role }: { c: any; role: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const judge = role === 'judge' || role === 'case_ops';
  const list = useQuery({ queryKey: ['evsubs', c.id, role], queryFn: () => api<any>(judge ? `/v1/partner/cases/${c.id}/submissions` : `/v1/partner/cases/${c.id}/shortlist`) });
  const [open, setOpen] = useState<any>(null);
  const [bands, setBands] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [fb, setFb] = useState('');
  const [choice, setChoice] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function openSub(id: string) {
    setErr(null);
    try {
      const s = await api<any>(`/v1/partner/submissions/${id}`);
      setOpen(s);
      setBands(Object.fromEntries((s.confirmedBands ?? s.aiBands ?? []).map((b: any) => [b.key, b.band])));
      setFb(s.judgeFeedback ?? s.ownerFeedback ?? '');
      setChoice(s.smeChoice);
      void list.refetch();
    } catch (e) {
      setErr(e);
    }
  }
  const save = useMutation({
    mutationFn: () =>
      role === 'judge'
        ? api(`/v1/partner/submissions/${open.id}/confirm`, { body: { bands: open.criteria.map((k: any) => ({ key: k.key, band: bands[k.key], reason: reasons[k.key] })), feedback: fb } })
        : api(`/v1/partner/submissions/${open.id}/owner-feedback`, { body: { feedback: fb, smeChoice: choice } }),
    onSuccess: () => {
      toast('บันทึกแล้ว');
      setOpen(null);
      void list.refetch();
    },
  });
  const release = useMutation({
    mutationFn: () => api<any>(`/v1/partner/cases/${c.id}/release`, { body: {} }),
    onSuccess: (r) => (toast(`ปล่อยผลแล้ว ${r.released.length} ทีม`), qc.invalidateQueries()),
  });
  if (!list.data) return <ErrorBox error={list.error} />;
  return (
    <div className="stack">
      {!judge && (
        <Rule kind="info" title={`อ่านได้สัปดาห์ละ ${list.data.quota.perWeek} ผลงาน · ใช้ไปแล้ว ${list.data.quota.used}`}>
          คุณเห็นเฉพาะผลงานที่ผ่านการคัดกรองแล้ว · ทุกทีมได้ Feedback จากกรรมการอยู่แล้ว
        </Rule>
      )}
      <ErrorBox error={err ?? release.error} />
      <div className="tbl">
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                <th>ทีม</th>
                <th>ส่งเมื่อ</th>
                {judge && <th>AI คัดกรอง (ข้อเสนอ)</th>}
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.submissions.map((s: any) => (
                <tr key={s.id}>
                  <td><strong>{s.team_name}</strong>{s.sme_choice && <> · <Chip tone="verified">SME’s Choice</Chip></>}</td>
                  <td>{dt(s.received_at)}</td>
                  {judge && (
                    <td>
                      {s.ai_status === 'ABANDONED' ? <Chip tone="attention">ต้องคัดกรองเอง</Chip> : s.shortlisted ? <Chip tone="proposed">ผ่านคัดกรอง</Chip> : <Chip tone="neutral">ไม่ผ่าน · ยังได้ Feedback</Chip>}
                    </td>
                  )}
                  <td>{judge ? s.status : s.opened ? 'เปิดอ่านแล้ว' : 'ยังไม่เปิด'}</td>
                  <td>
                    <button className="btn sm" onClick={() => openSub(s.id)} data-testid="open-sub">
                      เปิดอ่าน
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {role === 'judge' && (
        <button className="btn pri" onClick={() => release.mutate()} data-testid="release-case">
          ปล่อยผลทุกทีม
        </button>
      )}
      {open && (
        <Modal title={`ผลงานของ ${open.team}`} onClose={() => setOpen(null)}>
          <div className="dsec"><b>สรุป</b>{open.summary}</div>
          {open.answers.map((a: any) => (
            <div className="dsec" key={a.id}><b>{a.q}</b>{a.answer}</div>
          ))}
          <h4 style={{ marginTop: 12 }}>{role === 'judge' ? 'ยืนยันระดับรายเกณฑ์' : 'ระดับที่ AI เสนอ (ยังไม่ใช่ผล)'}</h4>
          {open.criteria.map((k: any) => {
            const ai = open.aiBands?.find((b: any) => b.key === k.key);
            return (
              <div key={k.key} className="dsec">
                <b>{k.name}</b>
                {ai && <div className="evid" style={{ cursor: 'default' }}><span className="band p">{BANDS[ai.band - 1].name}</span> {ai.why}{ai.quotes.map((q: string) => <div key={q} className="dim fs13">“{q}”</div>)}</div>}
                {role === 'judge' && (
                  <>
                    <div className="row" style={{ gap: 4 }}>
                      {BANDS.map((b) => (
                        <button key={b.k} className={`lv ${bands[k.key] === b.k ? 'on v' : ''}`} onClick={() => setBands({ ...bands, [k.key]: b.k })}>
                          {b.name}
                        </button>
                      ))}
                    </div>
                    {ai && bands[k.key] !== ai.band && <input type="text" placeholder="เหตุผลที่ต่างจาก AI (บังคับ)" value={reasons[k.key] ?? ''} onChange={(e) => setReasons({ ...reasons, [k.key]: e.target.value })} />}
                  </>
                )}
              </div>
            );
          })}
          <Field label={role === 'judge' ? 'Feedback ของกรรมการ' : 'Feedback ของเจ้าของโจทย์'}>
            <textarea value={fb} onChange={(e) => setFb(e.target.value)} data-testid="feedback" />
          </Field>
          <button className="btn sm blue" onClick={async () => setFb((await api<any>(`/v1/partner/submissions/${open.id}/feedback-draft`, { body: {} })).draft)}>
            ให้ AI ช่วยร่างตามคู่มือ (แก้ก่อนส่ง)
          </button>
          {role === 'case_owner' && (
            <label className="check">
              <input type="checkbox" checked={choice} onChange={(e) => setChoice(e.target.checked)} /> เลือกเป็น SME’s Choice
            </label>
          )}
          <ErrorBox error={save.error} />
          <button className="btn pri" style={{ marginTop: 8 }} disabled={fb.trim().length < 20} onClick={() => save.mutate()} data-testid="save-eval">
            {role === 'judge' ? 'ยืนยันผล' : 'ส่ง Feedback'}
          </button>
        </Modal>
      )}
    </div>
  );
}

function CaseDetail({ id }: { id: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pcase', id], queryFn: () => api<any>(`/v1/partner/cases/${id}`) });
  const [tab, setTab] = useState<'prod' | 'eval'>(me?.user.role === 'judge' ? 'eval' : 'prod');
  if (q.isLoading) return <Loading what="เคส" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { case: c, agreement, assets } = q.data;
  const role = me?.user.role ?? '';
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{c.title}</h1>
          <p className="muted fs14">{c.sub_category} · {c.industry} · Stage {c.stages.join(', ')}</p>
        </div>
        <Link className="btn" href="/p">กลับรายการ</Link>
      </div>
      <div className="tabs">
        <button className={tab === 'prod' ? 'on' : ''} onClick={() => setTab('prod')}>ผลิตเคส</button>
        {['PUBLISHED', 'SUSPENDED'].includes(c.status) && role !== 'case_reviewer' && (
          <button className={tab === 'eval' ? 'on' : ''} onClick={() => setTab('eval')} data-testid="tab-eval">
            {role === 'case_owner' ? 'ผลงานที่ผ่านการคัดกรอง' : 'ตัดสินผลงาน'}
          </button>
        )}
      </div>
      {tab === 'prod' ? <Production c={c} agreement={agreement} assets={assets} role={role} refresh={() => qc.invalidateQueries({ queryKey: ['pcase', id] })} /> : <Evaluation c={c} role={role} />}
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Guard roles={['case_owner', 'case_ops', 'case_reviewer', 'judge']}>
      <CaseDetail id={id} />
    </Guard>
  );
}
