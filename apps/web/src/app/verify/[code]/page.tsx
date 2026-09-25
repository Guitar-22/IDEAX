'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CERTIFICATE_LEVELS } from '@ideax/contracts';
import { api } from '@/lib/api';
import { d } from '@/lib/format';
import { ErrorBox, Loading } from '@/components/ui';

export default function Verify({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const q = useQuery({ queryKey: ['cert', code], queryFn: () => api<any>(`/v1/public/certificates/${code}`) });
  if (q.isLoading) return <Loading what="ใบรับรอง" />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <div className="panel" style={{ maxWidth: 560, padding: 24, margin: '20px auto', textAlign: 'center' }}>
      <p className="dim fs13">ตรวจสอบใบรับรอง · {code}</p>
      <h1>{q.data.name}</h1>
      <p className="fs15">ได้รับใบรับรองระดับ <b>{CERTIFICATE_LEVELS[q.data.level as keyof typeof CERTIFICATE_LEVELS]}</b></p>
      <p className="muted">จากโจทย์ “{q.data.title}” · ออกเมื่อ {d(q.data.issued_at)}</p>
      <span className="chip v"><span className="dot" /> ใบรับรองนี้มีอยู่จริงในระบบ</span>
    </div>
  );
}
