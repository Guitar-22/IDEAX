'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Guard } from '@/components/Guard';
import { PubCard } from '@/components/PubCard';
import { Chip, Empty, ErrorBox, Field, Modal, Rule, useToast } from '@/components/ui';

const FIELDS = [
  ['problem', 'Problem', 'ปัญหาที่งานนี้ตอบ'],
  ['approach', 'Approach', 'วิธีที่ใช้'],
  ['evidence', 'Evidence และข้อจำกัด', 'สิ่งที่ยังไม่ได้เก็บ และสิ่งที่ยังพิสูจน์ไม่ได้'],
  ['team', 'ผู้จัดทำและบทบาท', ''],
  ['rights', 'สิทธิในผลงาน', 'สิ่งที่เปิดเผย และสิ่งที่เปิดให้เจรจา'],
] as const;

function Portfolio() {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const pubs = useQuery({ queryKey: ['mypubs'], queryFn: () => api<{ publications: any[] }>('/v1/me/publications') });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<{ tasks: any[] }>('/v1/me/tasks') });
  const attempts = useQuery({ queryKey: ['attempts'], queryFn: () => api<{ attempts: any[] }>('/v1/me/attempts') });
  const certs = useQuery({ queryKey: ['certs'], queryFn: () => api<{ certificates: any[] }>('/v1/me/certificates') });
  const [form, setForm] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mypubs'] });

  const sources = [
    ...(tasks.data?.tasks ?? []).filter((t) => t.has_feedback).map((t) => ({ kind: 'submission', id: t.submission_id, label: `รายวิชา · ${t.title}` })),
    ...(attempts.data?.attempts ?? []).filter((a) => ['EVALUATED', 'CREDENTIALED'].includes(a.state)).map((a) => ({ kind: 'attempt', id: a.id, label: `โจทย์จริง · ${a.title}` })),
  ];
  const create = useMutation({
    mutationFn: () => api<any>('/v1/publications', { body: { source: form.source, title: form.title, fields: Object.fromEntries(Object.entries(form.fields).filter(([, v]) => String(v).trim())), visibility: form.visibility, opportunities: [] } }),
    onSuccess: async (r) => {
      setForm(null);
      refresh();
      setPreview(await api(`/v1/publications/${r.id}/preview`).then((p: any) => ({ ...p, id: r.id })));
    },
  });
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'publish' | 'withdraw' | 'consent' }) => api<any>(`/v1/publications/${v.id}/${v.action}`, { body: {} }),
    onSuccess: (r) => {
      toast(r.status === 'PUBLISHED' ? 'เผยแพร่แล้ว — องค์กรค้นเจอได้ตามระดับที่เลือก' : r.status === 'WITHDRAWN' ? 'ถอนแล้ว — ลบออกจากการค้นหาและปิดลิงก์สาธารณะ' : `รอผู้ร่วมจัดทำอีก ${r.waitingFor} คน`);
      setPreview(null);
      refresh();
    },
  });

  return (
    <>
      <div className="page-h">
        <div>
          <h1>ผลงานและการเผยแพร่</h1>
          <p className="muted fs14">การส่งงานไม่ถือเป็นการยินยอมเผยแพร่ · ฉบับเผยแพร่เป็นสำเนาที่คุณเลือกฟิลด์เอง และถอนได้ทุกเมื่อ</p>
        </div>
        <button className="btn pri" disabled={!sources.length} onClick={() => setForm({ source: sources[0], title: '', fields: {}, visibility: 'public' })}>
          สร้างการ์ดผลงาน
        </button>
      </div>
      {!sources.length && <Rule kind="info">ยังไม่มีงานที่มนุษย์รับรองแล้ว · เผยแพร่ได้หลังอาจารย์หรือกรรมการปล่อยผล</Rule>}
      {certs.data?.certificates.length ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3>ใบรับรอง</h3>
          {certs.data.certificates.map((c) => (
            <div key={c.id} className="dsec">
              <b>{c.title}</b>
              ระดับ {c.level} · <a href={`/verify/${c.verify_code}`}>{c.verify_code}</a>
            </div>
          ))}
        </div>
      ) : null}
      {pubs.data?.publications.length === 0 && <Empty>ยังไม่มีการ์ดผลงาน</Empty>}
      <div className="stack">
        {pubs.data?.publications.map((p) => {
          const mine = p.owner_id === me?.user.id;
          const needMyConsent = p.authors?.some((a: any) => a.userId === me?.user.id && !a.consented);
          return (
            <div className="card" key={p.id} data-testid="pub">
              <div className="between">
                <div>
                  <h3>{p.title}</h3>
                  <p className="muted fs13 mb0">
                    {p.visibility === 'public' ? 'เปิดสาธารณะ' : p.visibility === 'link' ? 'เฉพาะผู้มีลิงก์' : 'เฉพาะองค์กรที่ยืนยันตัวตน'} · Tier {p.tier} · รับรอง {p.verified_count}/{p.total_count}
                  </p>
                </div>
                <Chip tone={p.status === 'PUBLISHED' ? 'verified' : 'neutral'}>{p.status}</Chip>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                {mine && (p.status === 'PUBLICATION_DRAFT' || p.status === 'WITHDRAWN') && (
                  <button className="btn sm" onClick={async () => setPreview({ ...(await api<any>(`/v1/publications/${p.id}/preview`)), id: p.id })}>
                    ดูตัวอย่างแล้วเผยแพร่
                  </button>
                )}
                {mine && (p.status === 'PUBLISHED' || p.status === 'PENDING_COAUTHORS') && (
                  <button className="btn sm warn" onClick={() => act.mutate({ id: p.id, action: 'withdraw' })}>
                    ถอนการเผยแพร่
                  </button>
                )}
                {needMyConsent && (
                  <button className="btn sm pri" onClick={() => act.mutate({ id: p.id, action: 'consent' })}>
                    ยืนยันในฐานะผู้ร่วมจัดทำ
                  </button>
                )}
                {p.status === 'PUBLISHED' && p.visibility !== 'org' && <a className="btn sm" href={`/pub/${p.id}`}>ลิงก์สาธารณะ</a>}
              </div>
            </div>
          );
        })}
      </div>

      {form && (
        <Modal title="สร้างการ์ดผลงาน" onClose={() => setForm(null)}>
          <Field label="จากงาน">
            <select value={`${form.source.kind}:${form.source.id}`} onChange={(e) => setForm({ ...form, source: sources.find((s) => `${s.kind}:${s.id}` === e.target.value) })}>
              {sources.map((s) => (
                <option key={s.id} value={`${s.kind}:${s.id}`}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="ชื่อผลงาน">
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="pub-title" />
          </Field>
          {FIELDS.map(([k, l, hint]) => (
            <Field key={k} label={l} hint={hint || undefined}>
              <textarea value={form.fields[k] ?? ''} onChange={(e) => setForm({ ...form, fields: { ...form.fields, [k]: e.target.value } })} data-testid={`pub-${k}`} />
            </Field>
          ))}
          <Field label="ระดับการเผยแพร่">
            <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="public">เปิดสาธารณะ · ค้นเจอได้</option>
              <option value="link">เฉพาะผู้มีลิงก์ · ไม่เข้าระบบค้นหา</option>
              <option value="org">เฉพาะองค์กรที่ยืนยันตัวตน</option>
            </select>
          </Field>
          <Rule kind="warn">ระบบไม่ยอมให้เปิด: เกรดรายข้อ รหัส U/D/J Feedback ภายใน ข้อเสนอของ AI และข้อมูลลับของเจ้าของโจทย์ · ขอบเขตการตรวจติดการ์ดเสมอ</Rule>
          <ErrorBox error={create.error} />
          <button className="btn pri" disabled={!form.title.trim()} onClick={() => create.mutate()} data-testid="pub-create">
            บันทึกร่างและดูตัวอย่าง
          </button>
        </Modal>
      )}
      {preview && (
        <Modal title="ตัวอย่างฉบับที่องค์กรจะเห็น" onClose={() => setPreview(null)}>
          <PubCard card={preview.card} />
          <p className="dim fs13" style={{ marginTop: 10 }}>ไม่อยู่บนการ์ด: {preview.notOnCard.join(' · ')}</p>
          <ErrorBox error={act.error} />
          <button className="btn pri" onClick={() => act.mutate({ id: preview.id, action: 'publish' })} data-testid="pub-publish">
            ยืนยันเผยแพร่
          </button>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['learner']}>
      <Portfolio />
    </Guard>
  );
}
