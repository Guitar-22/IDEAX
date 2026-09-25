'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { PubCard } from '@/components/PubCard';
import { Empty, Rule } from '@/components/ui';

function Shortlist() {
  const q = useQuery({ queryKey: ['shortlist'], queryFn: () => api<any>('/v1/orgs/me/shortlist') });
  return (
    <>
      <h1>Shortlist</h1>
      <p className="muted fs14">note ของทีมเห็นเฉพาะสมาชิกองค์กร เจ้าของผลงานไม่เห็น</p>
      {q.data?.items.length === 0 && <Empty>ยังไม่มีผลงานใน Shortlist</Empty>}
      <div className="c-grid">
        {q.data?.items.map((i: any) =>
          i.withdrawn ? (
            <Rule key={i.publicationId} kind="warn" title="ผลงานนี้ถูกถอนแล้ว">note ของทีม: {i.note || '—'}</Rule>
          ) : (
            <PubCard key={i.publicationId} card={i.card} footer={<><span className="dim fs13" style={{ flex: 1 }}>note: {i.note || '—'}</span><Link className="btn sm" href={`/c/p/${i.publicationId}`}>เปิด</Link></>} />
          ),
        )}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['org_member']}>
      <Shortlist />
    </Guard>
  );
}
