'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { baht, d, dt } from '@/lib/format';
import { Guard } from '@/components/Guard';
import { Chip, Empty, ErrorBox, Rule, useToast } from '@/components/ui';

function Requests() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['myrequests'], queryFn: () => api<any>('/v1/me/requests') });
  const decide = useMutation({
    mutationFn: (v: { kind: 'contact' | 'eng'; id: string; d: string }) => api<any>(v.kind === 'contact' ? `/v1/contact-requests/${v.id}/${v.d}` : `/v1/engagements/${v.id}/${v.d}`, { body: {} }),
    onSuccess: (r) => {
      toast(`บันทึกแล้ว · ${r.status}`);
      void qc.invalidateQueries({ queryKey: ['myrequests'] });
    },
  });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <>
      <h1>คำขอจากองค์กร</h1>
      <p className="muted fs14">องค์กรยังไม่เห็นข้อมูลติดต่อของคุณจนกว่าคุณจะตอบรับ · ทุกการตัดสินใจบันทึกเป็นหลักฐานความยินยอม</p>
      {!q.data.talentMatching && (
        <Rule kind="warn" title="ยังไม่ได้ให้ความยินยอม Talent Matching">
          ต้องเปิดก่อนจึงตอบรับและเปิดข้อมูลติดต่อได้ · <Link href="/s/profile">ตั้งค่าความยินยอม</Link>
        </Rule>
      )}
      <ErrorBox error={decide.error} />
      <h2 className="sec-head">ขอติดต่อ</h2>
      {q.data.contacts.length === 0 && <Empty>ยังไม่มีคำขอ</Empty>}
      <div className="stack">
        {q.data.contacts.map((c: any) => (
          <div className="card" key={c.id} data-testid="contact-request">
            <div className="between">
              <div>
                <h3>{c.org_name}</h3>
                <p className="dim fs13 mb0">{c.domain_verified ? 'ผ่านการยืนยันโดเมนแล้ว' : 'ยังไม่ยืนยันโดเมน'} · เรื่อง {c.title} · ส่งเมื่อ {dt(c.created_at)}</p>
              </div>
              <Chip tone={c.status === 'REQUESTED' ? 'proposed' : c.status === 'ACCEPTED' || c.status === 'UNLOCKED' ? 'verified' : 'attention'}>{c.status}</Chip>
            </div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>วัตถุประสงค์</dt>
              <dd>{c.purpose}</dd>
              <dt>ข้อมูลที่ขอ</dt>
              <dd>{c.scope}</dd>
              <dt>หมดอายุ</dt>
              <dd>{d(c.expires_at)}</dd>
            </dl>
            {c.status === 'REQUESTED' && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn pri" onClick={() => decide.mutate({ kind: 'contact', id: c.id, d: 'accept' })} data-testid="accept-contact">
                  ตอบรับและเปิดอีเมล
                </button>
                <button className="btn" onClick={() => decide.mutate({ kind: 'contact', id: c.id, d: 'partial' })}>
                  อนุญาตบางส่วน (ยังไม่เปิดข้อมูลติดต่อ)
                </button>
                <button className="btn warn" onClick={() => decide.mutate({ kind: 'contact', id: c.id, d: 'decline' })}>
                  ปฏิเสธ
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <h2 className="sec-head">ขอซื้อไอเดีย / สิทธิ์ใช้งาน</h2>
      {q.data.engagements.length === 0 && <Empty>ยังไม่มีคำขอ</Empty>}
      <div className="stack">
        {q.data.engagements.map((e: any) => (
          <div className="card" key={e.id}>
            <div className="between">
              <div>
                <h3>{e.org_name} · {e.option}</h3>
                <p className="dim fs13 mb0">{e.title} · {baht(Number(e.amount_satang) / 100)} · คุณได้ 40% · ระบบยังไม่ตัดเงินจนกว่าคุณอนุมัติ</p>
              </div>
              <Chip tone={e.status === 'DISCUSSION' ? 'proposed' : e.status === 'CANCELLED' ? 'attention' : 'verified'}>{e.status}</Chip>
            </div>
            {e.status === 'DISCUSSION' && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn pri" onClick={() => decide.mutate({ kind: 'eng', id: e.id, d: 'approve' })}>
                  อนุมัติ
                </button>
                <button className="btn warn" onClick={() => decide.mutate({ kind: 'eng', id: e.id, d: 'decline' })}>
                  ปฏิเสธ
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['learner']}>
      <Requests />
    </Guard>
  );
}
