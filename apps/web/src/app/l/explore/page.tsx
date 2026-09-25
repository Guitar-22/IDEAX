'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SME_GROUPS, STAGES } from '@ideax/contracts';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { ErrorBox, Loading, Modal, Rule } from '@/components/ui';

function Explore() {
  const router = useRouter();
  const [track, setTrack] = useState<'sme' | 'community'>('sme');
  const [group, setGroup] = useState<string>('');
  const [confirm, setConfirm] = useState<any>(null);
  const q = useQuery({ queryKey: ['catalog', track, group], queryFn: () => api<{ cases: any[] }>(`/v1/catalog?track=${track}${group ? `&group=${group}` : ''}`) });
  const round = useQuery({ queryKey: ['round'], queryFn: () => api<any>('/v1/rounds/current') });
  const choose = useMutation({ mutationFn: (caseId: string) => api<any>('/v1/attempts', { body: { caseId } }), onSuccess: (r) => router.push(`/l/a/${r.id}`) });
  return (
    <>
      <div className="page-h">
        <div>
          <h1>เลือกสิ่งที่อยากช่วย</h1>
          <p className="muted fs14">ขั้นที่ 2–3 · {round.data?.name} · เลือกได้เพียงหนึ่งแห่งต่อรอบ และยังไม่เห็นปัญหาจริงจนกว่าจะเลือก</p>
        </div>
      </div>
      <div className="c-tabs">
        <button className={`c-tab ${track === 'sme' ? 'on' : ''}`} onClick={() => (setTrack('sme'), setGroup(''))}>
          SMEs Track · Hard Skills
        </button>
        <button className={`c-tab ${track === 'community' ? 'on' : ''}`} onClick={() => (setTrack('community'), setGroup(''))}>
          Community Track · Soft Skills
        </button>
      </div>
      {track === 'sme' && (
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={`btn sm ${group === '' ? 'blue' : ''}`} onClick={() => setGroup('')}>
            ทุกประเภท
          </button>
          {Object.entries(SME_GROUPS).map(([k, v]) => (
            <button key={k} className={`btn sm ${group === k ? 'blue' : ''}`} onClick={() => setGroup(k)}>
              {v}
            </button>
          ))}
        </div>
      )}
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading what="โจทย์" />}
      <div className="c-grid">
        {q.data?.cases.map((c) => (
          <article key={c.id} className="c-card" data-testid={`case-${c.id}`}>
            <div className="c-card-h">
              <span className="c-ava">{c.title.slice(0, 1)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="c-own">{c.org_name}</div>
                <div className="dim fs13">{c.sub_category} · {c.province}</div>
              </div>
            </div>
            <div className="c-card-b">
              <h3>{c.title}</h3>
              <p className="muted fs14">{c.teaser}</p>
              <div className="row fs13">
                {c.stages.map((s: number) => (
                  <span key={s} className="pill">Stage {s} · {STAGES[s - 1].th}</span>
                ))}
              </div>
              <p className="dim fs13" style={{ marginTop: 8 }}>ตรวจเคสโดย {c.reviewed_by}</p>
            </div>
            <div className="c-card-f">
              <button className="btn pri" onClick={() => setConfirm(c)}>
                เลือกช่วยที่นี่
              </button>
            </div>
          </article>
        ))}
      </div>
      {confirm && (
        <Modal title={`เลือก ${confirm.title}?`} onClose={() => setConfirm(null)}>
          <p>เลือกได้แห่งเดียวในรอบนี้ เพื่อให้เลือกจากความสนใจจริง ไม่ใช่เลือกโจทย์ที่คิดว่าง่าย</p>
          <Rule kind="info">หลังเลือก คุณจะเห็นโจทย์ย่อและร่างคำตอบแรก 30 นาทีก่อนเรียน (Productive Failure)</Rule>
          <ErrorBox error={choose.error} />
          <div className="row">
            <button className="btn pri" disabled={choose.isPending} onClick={() => choose.mutate(confirm.id)}>
              ยืนยันเลือก
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              ยกเลิก
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['learner']}>
      <Explore />
    </Guard>
  );
}
