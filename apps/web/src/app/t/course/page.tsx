'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Guard } from '@/components/Guard';
import { Chip, Empty, ErrorBox, Loading, Rule } from '@/components/ui';

const TONE: Record<string, 'verified' | 'proposed' | 'attention'> = { understood: 'verified', cannot_explain: 'proposed', needs_feedback: 'attention', insufficient: 'attention' };

function Course() {
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api<{ courses: any[] }>('/v1/teacher/courses') });
  const course = courses.data?.courses[0];
  const summary = useQuery({ enabled: !!course, queryKey: ['summary', course?.id], queryFn: () => api<any>(`/v1/courses/${course.id}/summary`) });
  const insights = useQuery({ enabled: !!course, queryKey: ['insights', course?.id], queryFn: () => api<any>(`/v1/courses/${course.id}/insights`) });
  if (courses.isLoading) return <Loading />;
  if (!course) return <Empty>ยังไม่มีรายวิชา</Empty>;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{course.code} · {course.name}</h1>
          <p className="muted fs14">ผู้เรียน {course.students} คน</p>
        </div>
      </div>
      <h2 className="sec-head">กลุ่มผู้เรียนจากหลักฐาน</h2>
      <p className="muted fs14">ทุกคนอยู่หนึ่งกลุ่ม พร้อมหลักฐานที่ใช้จัด · ถ้าหลักฐานไม่พอ ระบบไม่เดา</p>
      <ErrorBox error={insights.error} />
      <div className="grid2">
        {insights.data?.groups.map((g: any) => (
          <div className="card" key={g.key} data-testid={`group-${g.key}`}>
            <div className="between">
              <h3>{g.label}</h3>
              <Chip tone={TONE[g.key]}>{g.students.length} คน</Chip>
            </div>
            {g.students.length === 0 && <p className="dim fs13">—</p>}
            {g.students.map((s: any) => (
              <div key={s.student.id} className="dsec">
                <b>{s.student.name}</b>
                {s.evidence.join(' · ')}
                <div className="dim fs13" style={{ marginTop: 4 }}>
                  To-do อาจารย์: {s.todo.teacher} · ผู้เรียน: {s.todo.student}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <h2 className="sec-head">ปิดรอบและสรุปผล</h2>
      {summary.data && (
        <>
          <p className="muted fs14">จากผลที่ปล่อยแล้ว {summary.data.released} คน · ถ่วงน้ำหนักเท่ากันทุกข้อ</p>
          <div className="dash-grid">
            {summary.data.criteria.map((c: any) => (
              <div className="stat" key={c.id}>
                <div className="stat-n">{c.average !== null ? c.average.toFixed(2) : '—'}</div>
                <div className="stat-l">{c.name}</div>
              </div>
            ))}
          </div>
          {summary.data.sharedGaps.length > 0 && (
            <Rule kind="info" title="ช่องว่างที่พบซ้ำตั้งแต่ครึ่งหนึ่งของรุ่นขึ้นไป">
              {summary.data.sharedGaps.map((g: any) => `ข้อ ${g.no} (${g.count} คน)`).join(' · ')} · เหมาะทำคาบติวทั้งรุ่น
            </Rule>
          )}
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['thesis_mentor', 'assistant_marker']}>
      <Course />
    </Guard>
  );
}
