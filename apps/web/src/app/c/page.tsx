'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { PubCard } from '@/components/PubCard';
import { Empty, ErrorBox, Loading } from '@/components/ui';

function Search() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [tier, setTier] = useState('');
  const [sort, setSort] = useState('recent');
  const r = useQuery({ queryKey: ['search', term, tier, sort], queryFn: () => api<any>(`/v1/market/search?q=${encodeURIComponent(term)}&sort=${sort}${tier ? `&tier=${tier}` : ''}`) });
  const trends = useQuery({ queryKey: ['trends'], queryFn: () => api<any>('/v1/market/trends') });
  return (
    <>
      <section className="c-hero" style={{ marginBottom: 18 }}>
        <h1 style={{ textAlign: 'center' }}>หาไอเดียและคนรุ่นใหม่จากโจทย์ธุรกิจจริง</h1>
        <p className="muted" style={{ textAlign: 'center' }}>ค้นได้เฉพาะผลงานที่เจ้าของเลือกเผยแพร่ · ทุกการ์ดบอกว่าใครตรวจอะไร</p>
        <form
          className="c-search"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q);
          }}
        >
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ปัญหาที่ธุรกิจกำลังเจอ เช่น ของเสีย ผู้สืบทอด" aria-label="ค้นหา" data-testid="search" />
          <button className="btn pri" type="submit">ค้นหา</button>
        </form>
      </section>
      {trends.data && (
        <div className="dash-grid" style={{ marginBottom: 18 }}>
          <div className="stat"><div className="stat-n">{trends.data.counts.published}</div><div className="stat-l">ผลงานที่เผยแพร่</div></div>
          <div className="stat"><div className="stat-n">{trends.data.counts.searches}</div><div className="stat-l">การค้นหา</div></div>
          <div className="stat"><div className="stat-n">{trends.data.counts.contact_requests}</div><div className="stat-l">คำขอติดต่อ</div></div>
          <div className="stat"><div className="stat-n">{trends.data.counts.engagements}</div><div className="stat-l">คำขอซื้อไอเดีย</div><div className="stat-s">{trends.data.source}</div></div>
        </div>
      )}
      <div className="c-bar">
        <span className="c-sort">
          Tier
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </span>
        <span className="c-sort">
          เรียงตาม
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">เผยแพร่ล่าสุด</option>
            <option value="tier">Tier สูงสุดก่อน</option>
            <option value="verified">จำนวนเกณฑ์ที่มนุษย์รับรอง</option>
          </select>
        </span>
        <span className="dim fs13">ค้นจาก {r.data?.index ?? 'publication_projection'} เท่านั้น</span>
      </div>
      <ErrorBox error={r.error} />
      {r.isLoading && <Loading what="ผลค้น" />}
      {r.data?.results.length === 0 && <Empty>ไม่พบผลงานที่เผยแพร่ซึ่งตรงกับคำค้น</Empty>}
      <div className="c-grid">
        {r.data?.results.map((card: any) => (
          <PubCard key={card.id} card={card} footer={<Link className="btn pri" href={`/c/p/${card.id}`}>ดูรายละเอียด</Link>} />
        ))}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['org_member']}>
      <Search />
    </Guard>
  );
}
