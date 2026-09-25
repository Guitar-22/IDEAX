'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { Snapshot } from '@/components/Snapshot';
import { ErrorBox, Field, Loading, Rule, useToast } from '@/components/ui';

function Release({ svid }: { svid: string }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const review = useQuery({ queryKey: ['review', svid], queryFn: () => api<any>(`/v1/reviews/${svid}`) });
  const pv = useQuery({ queryKey: ['preview', svid], queryFn: () => api<any>(`/v1/reviews/${svid}/release-preview`) });
  const [note, setNote] = useState('');
  const release = useMutation({
    mutationFn: (mode: 'revise' | 'finalize') => api(`/v1/reviews/${svid}/release`, { body: { mode, note } }),
    onSuccess: () => {
      toast('ปล่อยผลแล้ว — ผู้เรียนเห็นเฉพาะสิ่งที่คุณเลือกปล่อย');
      void qc.invalidateQueries();
      router.push('/t');
    },
  });
  if (pv.isLoading || review.isLoading) return <Loading />;
  if (pv.error) return <ErrorBox error={pv.error} />;
  const released = review.data?.release;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>ส่ง Feedback · {review.data?.student.name}</h1>
          <p className="muted fs14">นี่คือสิ่งที่ผู้เรียนจะเห็นทุกอย่าง · ข้อเสนอของ AI ที่คุณไม่ได้ยืนยันจะไม่ถูกส่งออก</p>
        </div>
        <Link className="btn" href={`/t/review/${svid}`}>
          กลับหน้าตรวจ
        </Link>
      </div>
      {released ? (
        <Rule title="ปล่อยผลแล้ว">ฉบับนี้ปล่อยผลแบบ {released.mode === 'revise' ? 'ให้แก้และส่งใหม่' : 'ปิดรอบ'} แล้ว ผลที่ปล่อยแก้ไม่ได้</Rule>
      ) : pv.data.pending.length > 0 ? (
        <Rule kind="warn" title={`ยังมี ${pv.data.pending.length} ข้อที่ยังไม่ได้ตัดสิน`}>ข้อ {pv.data.pending.join(', ')} · ต้องตัดสินครบก่อนปล่อยผล</Rule>
      ) : (
        <div className="card" style={{ marginBottom: 14 }}>
          <Field label="ข้อความถึงผู้เรียน (ไม่บังคับ)">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น แก้ข้อ 1.3 และ 1.4 แล้วส่งใหม่" />
          </Field>
          <ErrorBox error={release.error} />
          <div className="row">
            <button className="btn pri" disabled={release.isPending} onClick={() => release.mutate('revise')}>
              ปล่อยผล · ให้แก้และส่งใหม่
            </button>
            <button className="btn" disabled={release.isPending} onClick={() => release.mutate('finalize')}>
              ปล่อยผล · ปิดรอบ
            </button>
            {!review.data?.canRelease && <span className="dim fs13">เฉพาะอาจารย์ผู้สอนเท่านั้นที่ปล่อยผลได้</span>}
          </div>
        </div>
      )}
      <Snapshot s={pv.data.snapshot} />
    </>
  );
}

export default function Page({ params }: { params: Promise<{ svid: string }> }) {
  const { svid } = use(params);
  return (
    <Guard roles={['thesis_mentor', 'assistant_marker']}>
      <Release svid={svid} />
    </Guard>
  );
}
