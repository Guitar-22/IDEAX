'use client';
import type { ReactNode } from 'react';
import { baht, d } from '@/lib/format';

const LABEL: Record<string, string> = { problem: 'Problem', approach: 'Approach', evidence: 'Evidence และข้อจำกัด', team: 'ผู้จัดทำ', rights: 'สิทธิในผลงาน' };

export function TierTag({ t }: { t: string }) {
  return <span className={`tier ${t.toLowerCase()}`}>Tier {t}</span>;
}

/** The public projection of a work: exactly what organisations see. */
export function PubCard({ card, footer }: { card: any; footer?: ReactNode }) {
  return (
    <article className="c-card" data-testid="pub-card">
      <div className="c-card-h">
        <span className="c-ava">{card.owner.slice(0, 1)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="c-own">{card.owner}</div>
          <div className="dim fs13">{card.maturity}{card.publishedAt ? ` · เผยแพร่ ${d(card.publishedAt)}` : ''}</div>
        </div>
        <TierTag t={card.tier} />
      </div>
      <div className="c-card-b">
        <h3>{card.title}</h3>
        {Object.entries(card.fields).map(([k, v]) => (
          <div className="dsec" key={k}>
            <b>{LABEL[k] ?? k}</b>
            {String(v)}
          </div>
        ))}
        <div className="c-verify" style={{ marginTop: 10 }}>
          <b>Verification</b> {card.verification}
        </div>
        <div className="c-price">
          <div>
            <span>ขอข้อมูลติดต่อ (หลังเจ้าของตอบรับ)</span>
            <b>{baht(card.prices.contactUnlock)}</b>
          </div>
          <div>
            <span>ขอซื้อไอเดีย (เจ้าของได้ 40%)</span>
            <b>เริ่ม {baht(card.prices.ideaPurchase)}</b>
          </div>
        </div>
      </div>
      {footer && <div className="c-card-f">{footer}</div>}
    </article>
  );
}
