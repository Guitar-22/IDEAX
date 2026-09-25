'use client';
import { use, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { PubCard } from '@/components/PubCard';
import { ErrorBox, Field, Loading, Modal, Rule, useToast } from '@/components/ui';

function Detail({ id }: { id: string }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['mpub', id], queryFn: () => api<any>(`/v1/market/publications/${id}`) });
  const [note, setNote] = useState<string | null>(null);
  const [contact, setContact] = useState<any>(null);
  const [buy, setBuy] = useState<any>(null);
  const save = useMutation({ mutationFn: () => api('/v1/orgs/me/shortlist', { body: { publicationId: id, note: note ?? '' } }), onSuccess: () => (toast('เก็บเข้า Shortlist แล้ว · note เห็นเฉพาะทีมของคุณ'), q.refetch()) });
  const send = useMutation({ mutationFn: () => api('/v1/contact-requests', { body: { publicationId: id, ...contact, expiresAt: new Date(contact.expiresAt).toISOString() } }), onSuccess: () => (setContact(null), toast('ส่งคำขอแล้ว — ยังไม่เห็นข้อมูลติดต่อจนกว่าเจ้าของจะตอบรับ')) });
  const order = useMutation({ mutationFn: () => api('/v1/engagements', { body: { publicationId: id, option: buy.option, amountBaht: Number(buy.amount) } }), onSuccess: () => (setBuy(null), toast('ส่งคำขอซื้อแล้ว — ยังไม่ตัดเงินจนกว่าเจ้าของอนุมัติ')) });
  if (q.isLoading) return <Loading what="ผลงาน" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <PubCard card={q.data} />
      <div className="stack">
        <div className="card">
          <h3>Shortlist ของทีม</h3>
          <Field label="note ภายในทีม (เจ้าของผลงานไม่เห็น)">
            <textarea value={note ?? q.data.note ?? ''} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button className="btn" onClick={() => save.mutate()}>{q.data.shortlisted ? 'บันทึก note' : 'เก็บเข้า Shortlist'}</button>
        </div>
        <div className="card">
          <h3>ขอติดต่อเจ้าของผลงาน</h3>
          <p className="dim fs13">ข้อมูลติดต่อเปิดหลังเจ้าของตอบรับ และชำระค่าปลดล็อกแล้วเท่านั้น</p>
          <button className="btn pri" onClick={() => setContact({ purpose: '', scope: '', expiresAt: soon })} data-testid="contact">ขอติดต่อ</button>
        </div>
        <div className="card">
          <h3>ขอซื้อไอเดีย / สิทธิ์ใช้งาน</h3>
          <p className="dim fs13">ราคาเจรจากับเจ้าของ · เจ้าของต้องอนุมัติก่อน ระบบจึงตัดเงิน · Tier C ยังไม่เปิดขายสิทธิ์เชิงพาณิชย์</p>
          <button className="btn" onClick={() => setBuy({ option: 'ขออ่านฉบับเต็ม', amount: 500 })}>ขอซื้อ</button>
        </div>
        <Rule kind="info">ไฟล์ต้นฉบับไม่ถูกส่งออกทั้งก้อน · ลิขสิทธิ์ยังเป็นของผู้เรียนและสถาบัน</Rule>
      </div>
      {contact && (
        <Modal title="ขอติดต่อเจ้าของผลงาน" onClose={() => setContact(null)}>
          <Field label="วัตถุประสงค์"><input type="text" value={contact.purpose} onChange={(e) => setContact({ ...contact, purpose: e.target.value })} data-testid="purpose" /></Field>
          <Field label="ข้อมูลที่ขอเพิ่ม"><input type="text" value={contact.scope} onChange={(e) => setContact({ ...contact, scope: e.target.value })} data-testid="scope" /></Field>
          <Field label="วันหมดอายุคำขอ"><input type="date" value={contact.expiresAt} onChange={(e) => setContact({ ...contact, expiresAt: e.target.value })} /></Field>
          <ErrorBox error={send.error} />
          <button className="btn pri" onClick={() => send.mutate()} data-testid="send-contact">ส่งคำขอ</button>
        </Modal>
      )}
      {buy && (
        <Modal title="ขอซื้อไอเดีย" onClose={() => setBuy(null)}>
          <Field label="สิ่งที่ขอ">
            <select value={buy.option} onChange={(e) => setBuy({ ...buy, option: e.target.value })}>
              <option>ขออ่านฉบับเต็ม</option>
              <option>จ้างทำต่อ</option>
              <option>สิทธิ์เชิงพาณิชย์</option>
            </select>
          </Field>
          <Field label="ราคาที่เสนอ (บาท)"><input type="number" value={buy.amount} onChange={(e) => setBuy({ ...buy, amount: e.target.value })} /></Field>
          <ErrorBox error={order.error} />
          <button className="btn pri" onClick={() => order.mutate()}>ส่งคำขอซื้อ</button>
        </Modal>
      )}
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Guard roles={['org_member']}>
      <Detail id={id} />
    </Guard>
  );
}
