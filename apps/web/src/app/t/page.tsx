'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { d, dt } from '@/lib/format';
import { Guard } from '@/components/Guard';
import { Chip, Empty, ErrorBox, Loading, Rule } from '@/components/ui';

const BUCKET = ['ใกล้กำหนด', 'ต้องตัดสินใจ', 'ฉบับแก้', 'ตัดสินครบแล้ว รอปล่อยผล', 'ปล่อยผลแล้ว'];

function Queue() {
  const q = useQuery({ queryKey: ['queue'], queryFn: () => api<{ queue: any[] }>('/v1/teacher/queue') });
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api<{ courses: any[] }>('/v1/teacher/courses') });
  return (
    <>
      <div className="page-h">
        <div>
          <h1>หน้าหลักอาจารย์</h1>
          <p className="muted fs14">เรียงตาม: ใกล้กำหนด → ต้องตัดสินใจ → ฉบับแก้ → ที่เหลือ · ไม่ได้เรียงตามเกรด</p>
        </div>
        {courses.data?.courses[0] && (
          <Link className="btn" href="/t/course">
            {courses.data.courses[0].code} · สรุปรายวิชาและกลุ่มผู้เรียน
          </Link>
        )}
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading what="คิวตรวจ" />}
      {q.data?.queue.length === 0 && <Empty>ยังไม่มีงานส่งเข้ามา</Empty>}
      <div className="stack">
        {q.data?.queue.map((r) => (
          <Link key={r.version_id} href={`/t/review/${r.version_id}`} className="card click" style={{ textDecoration: 'none', color: 'inherit' }} data-testid="queue-item">
            <div className="between">
              <div>
                <span className="pill">{BUCKET[r.bucket]}</span>
                <h3 style={{ marginTop: 6 }}>
                  {r.student_name} · {r.title} ฉบับที่ {r.version_no}
                </h3>
                <p className="muted fs13 mb0">
                  {r.course_name} · ส่ง {dt(r.received_at)} · กำหนด {d(r.due_at)} · {r.word_count.toLocaleString()} คำ
                </p>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
                {r.released ? (
                  <Chip tone="verified">ปล่อยผลแล้ว</Chip>
                ) : r.analysis_status === 'COMPLETED' ? (
                  <Chip tone="proposed">AI เตรียมหลักฐานแล้ว</Chip>
                ) : r.analysis_status === 'ABANDONED' ? (
                  <Chip tone="attention">ตรวจแบบไม่มีข้อเสนอ</Chip>
                ) : (
                  <Chip tone="attention">การวิเคราะห์ {r.analysis_status}</Chip>
                )}
                <span className="dim fs13">
                  ตัดสินแล้ว {r.items_decided}/{r.items_total} · ต้องให้คนดู {r.items_attention}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <Rule kind="info" title="หลักของหน้าตรวจ">
        ข้อเสนอของ AI เป็นสีฟ้าและยังไม่มีผลใด ๆ จนกว่าคุณจะยืนยัน · ข้อที่ระบบอ่านไม่ได้เป็นสีเทาเส้นประ ระบบไม่เดาเกรดให้ · ผู้เรียนเห็นเฉพาะสิ่งที่คุณปล่อย
      </Rule>
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['thesis_mentor', 'assistant_marker']}>
      <Queue />
    </Guard>
  );
}
