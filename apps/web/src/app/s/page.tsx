'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { d, dt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Guard } from '@/components/Guard';
import { StageMeter } from '@/components/StageMeter';
import { Chip, Empty, Rule } from '@/components/ui';

const STATE_LABEL: Record<string, string> = {
  CHOSEN: 'ร่างคำตอบแรก', FIRST_DRAFT: 'ร่างคำตอบแรก', LEARNING: 'เตรียมความรู้', READY_TO_UNLOCK: 'ปลดล็อก Booklet', IN_PROGRESS: 'วิเคราะห์เคส',
  PUSHBACK: 'ถูกท้าทาย', FINALIZING: 'เตรียมส่ง', SUBMITTED: 'ส่งแล้ว รอผล', EVALUATED: 'ได้รับ Feedback', CREDENTIALED: 'ได้ใบรับรองแล้ว', EXPIRED: 'หมดเวลา',
};

function Today() {
  const { me } = useSession();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<{ tasks: any[]; serverTime: string }>('/v1/me/tasks') });
  const attempts = useQuery({ queryKey: ['attempts'], queryFn: () => api<{ attempts: any[] }>('/v1/me/attempts') });
  return (
    <>
      <div className="page-h">
        <div>
          <h1>วันนี้</h1>
          <p className="muted fs14">เรียงตามกำหนดส่ง · เวลาจากเซิร์ฟเวอร์ {tasks.data ? dt(tasks.data.serverTime) : ''}</p>
        </div>
        <Link className="btn pri" href="/l/explore">
          หาโจทย์จริงจาก SME / ชุมชน
        </Link>
      </div>
      {me && !me.user.studentCardVerified && (
        <Rule kind="warn" title="ยังไม่ได้ยืนยันบัตรนักศึกษา">
          ทำขั้นแรก ๆ ได้ แต่ต้องยืนยันก่อนเปิดข้อมูลของเจ้าของโจทย์ · <Link href="/s/profile">ยืนยันตอนนี้</Link>
        </Rule>
      )}
      {me && !me.guardianConfirmed && (
        <Rule kind="warn" title="รอความยินยอมจากผู้ปกครอง">
          อายุต่ำกว่า 20 ปี ต้องให้ผู้ปกครองยืนยันผ่าน OTP ก่อนเปิด Case Booklet · <Link href="/s/profile">ขอรหัสใหม่</Link>
        </Rule>
      )}
      <h2 className="sec-head">งานในรายวิชา · IDEAX</h2>
      {tasks.data?.tasks.length === 0 && <Empty>ยังไม่มีงานในรายวิชา</Empty>}
      <div className="stack">
        {tasks.data?.tasks.map((t) => (
          <Link key={t.id} href={`/s/a/${t.id}`} className="card click" style={{ textDecoration: 'none', color: 'inherit' }} data-testid="task">
            <div className="between">
              <div>
                <h3>{t.title}</h3>
                <p className="muted fs13 mb0">
                  {t.course_name} · กำหนดส่ง {d(t.due_at)} {t.verification && '· โหมด Verification'}
                </p>
              </div>
              {t.has_feedback ? <Chip tone="verified">มีผลตรวจแล้ว</Chip> : t.submission_id ? <Chip tone="neutral">ส่งแล้ว {t.versions} ฉบับ · {t.status}</Chip> : <Chip tone="attention">ยังไม่ส่ง</Chip>}
            </div>
          </Link>
        ))}
      </div>
      <h2 className="sec-head">โจทย์จริง · THAItern</h2>
      {attempts.data?.attempts.length === 0 && <Empty>ยังไม่ได้เลือกโจทย์ในรอบนี้ · เลือกได้ 1 แห่งต่อรอบ</Empty>}
      <div className="stack">
        {attempts.data?.attempts.map((a) => (
          <Link key={a.id} href={`/l/a/${a.id}`} className="card click" style={{ textDecoration: 'none', color: 'inherit' }} data-testid="attempt">
            <div className="between">
              <div>
                <h3>{a.title}</h3>
                <p className="muted fs13 mb0">{a.deadline_at ? `ส่งภายใน ${dt(a.deadline_at)}` : 'ยังไม่เริ่มนับเวลา 14 วัน'}</p>
              </div>
              <Chip tone={a.state === 'CREDENTIALED' || a.state === 'EVALUATED' ? 'verified' : a.state === 'EXPIRED' ? 'attention' : 'proposed'}>{STATE_LABEL[a.state]}</Chip>
            </div>
          </Link>
        ))}
      </div>
      <h2 className="sec-head">7 ขั้นของทักษะ</h2>
      <StageMeter />
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['learner']}>
      <Today />
    </Guard>
  );
}
