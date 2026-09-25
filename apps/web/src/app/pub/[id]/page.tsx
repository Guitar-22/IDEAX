'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { PubCard } from '@/components/PubCard';
import { ErrorBox, Loading, Rule } from '@/components/ui';

export default function PublicPub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['pubpublic', id], queryFn: () => api<any>(`/v1/public/publications/${id}`) });
  if (q.isLoading) return <Loading what="ผลงาน" />;
  if (q.error instanceof ApiError && q.error.status === 410) return <Rule kind="warn" title="ผลงานนี้ถูกถอนแล้ว">เจ้าของถอนการเผยแพร่แล้ว</Rule>;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <PubCard card={q.data} />
    </div>
  );
}
