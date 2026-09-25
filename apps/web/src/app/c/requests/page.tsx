'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PRICES } from '@ideax/contracts';
import { api } from '@/lib/api';
import { baht, d } from '@/lib/format';
import { Guard } from '@/components/Guard';
import { Chip, Empty, ErrorBox, useToast } from '@/components/ui';

function OrgRequests() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['orgreq'], queryFn: () => api<any>('/v1/orgs/me/requests') });
  const pay = useMutation({ mutationFn: (path: string) => api<any>(path, { body: {} }), onSuccess: (r) => (toast(`ชำระแล้ว · ${r.status}`), q.refetch()) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <>
      <h1>คำขอขององค์กร</h1>
      <ErrorBox error={pay.error} />
      <h2 className="sec-head">ขอติดต่อ</h2>
      {q.data.contacts.length === 0 && <Empty>ยังไม่มีคำขอ</Empty>}
      <div className="stack">
        {q.data.contacts.map((c: any) => (
          <div className="card" key={c.id} data-testid="org-contact">
            <div className="between">
              <div>
                <h3>{c.title}</h3>
                <p className="dim fs13 mb0">เจ้าของ {c.owner_name} · หมดอายุ {d(c.expires_at)}</p>
              </div>
              <Chip tone={c.status === 'UNLOCKED' ? 'verified' : c.status === 'REQUESTED' ? 'proposed' : 'attention'}>{c.status}</Chip>
            </div>
            {c.contact ? (
              <p className="okmsg">ข้อมูลติดต่อที่เจ้าของเลือกเปิด: {Object.values(c.contact).join(', ')}</p>
            ) : (
              <p className="dim fs13">ยังไม่เห็นข้อมูลติดต่อ</p>
            )}
            {c.status === 'ACCEPTED' && (
              <button className="btn pri" onClick={() => pay.mutate(`/v1/contact-requests/${c.id}/pay`)} data-testid="pay-contact">
                ชำระค่าปลดล็อก {baht(PRICES.contactUnlock)}
              </button>
            )}
          </div>
        ))}
      </div>
      <h2 className="sec-head">ขอซื้อไอเดีย</h2>
      {q.data.engagements.length === 0 && <Empty>ยังไม่มีคำขอ</Empty>}
      <div className="stack">
        {q.data.engagements.map((e: any) => (
          <div className="card between" key={e.id}>
            <div>
              <h3>{e.title} · {e.option}</h3>
              <p className="dim fs13 mb0">{baht(Number(e.amount_satang) / 100)}</p>
            </div>
            <div className="row">
              <Chip tone={e.status === 'PAID' ? 'verified' : e.status === 'CANCELLED' ? 'attention' : 'proposed'}>{e.status}</Chip>
              {e.status === 'AGREED' && <button className="btn pri" onClick={() => pay.mutate(`/v1/engagements/${e.id}/pay`)}>ชำระ</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['org_member']}>
      <OrgRequests />
    </Guard>
  );
}
