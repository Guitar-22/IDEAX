'use client';
import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { JOURNEY_STEPS } from '@ideax/contracts';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { ErrorBox, Loading, Steps } from '@/components/ui';
import { Booklet, Canvas, Deadline, FirstDraft, Learning, Pushback, Result, Simulator, StakeholderChat, Submit, Unlock } from '@/components/journey';

const ORDER: string[] = JOURNEY_STEPS.map((s) => s.key);
const WORK_TABS = [
  ['6', 'Case Booklet'],
  ['6c', 'Stakeholder Chat'],
  ['7', 'Strategy Canvas'],
  ['8', 'ถูกท้าทาย'],
  ['9', 'Financial Simulator'],
  ['12', 'ตรวจก่อนส่งและส่งงาน'],
] as const;

function Journey({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api<any>(`/v1/attempts/${id}`) });
  const [tab, setTab] = useState<string>('6');
  if (q.isLoading) return <Loading what="เคส" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data;
  const cur = a.journeyStep;
  const working = ['IN_PROGRESS', 'PUSHBACK', 'FINALIZING'].includes(a.state);
  return (
    <>
      <div className="page-h">
        <div>
          <span className="pill">{a.case.track === 'sme' ? 'SMEs Track' : 'Community Track'} · {a.case.subCategory}</span>
          <h1 style={{ marginTop: 6 }}>{a.case.title}</h1>
          <p className="muted fs14">ทีม: {a.team.members.map((m: any) => m.name).join(', ')}</p>
        </div>
        <Deadline a={a} />
      </div>
      <Steps items={[...JOURNEY_STEPS]} current={cur} done={(k) => ORDER.indexOf(k) < ORDER.indexOf(cur)} />
      {(a.state === 'CHOSEN' || a.state === 'FIRST_DRAFT') && <FirstDraft a={a} />}
      {a.state === 'LEARNING' && <Learning a={a} />}
      {a.state === 'READY_TO_UNLOCK' && <Unlock a={a} />}
      {working && (
        <>
          <div className="tabs" role="tablist">
            {WORK_TABS.map(([k, l]) => (
              <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`tab-${k}`}>
                {l}
              </button>
            ))}
          </div>
          {tab === '6' && <Booklet a={a} />}
          {tab === '6c' && <StakeholderChat a={a} />}
          {tab === '7' && <Canvas a={a} />}
          {tab === '8' && <Pushback a={a} />}
          {tab === '9' && <Simulator a={a} />}
          {tab === '12' && <Submit a={a} />}
        </>
      )}
      {['SUBMITTED', 'EVALUATED', 'CREDENTIALED', 'EXPIRED'].includes(a.state) && <Result a={a} />}
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Guard roles={['learner']}>
      <Journey id={id} />
    </Guard>
  );
}
