'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, type Role } from '@ideax/contracts';
import { api } from '@/lib/api';
import { gateOf, homeOf, useSession } from '@/lib/session';
import { ErrorBox, Loading } from '@/components/ui';

interface Persona {
  id: string;
  name: string;
  role: Role;
  institution: string | null;
  province: string | null;
  orgName: string | null;
}

const GATES = [
  { n: 1, title: 'Gate 1 · อาจารย์', sub: 'ตรวจงานตาม Rubric โดย AI เตรียมหลักฐาน อาจารย์เป็นผู้ตัดสิน', door: 'ประตูมหาวิทยาลัย · IDEAX' },
  { n: 2, title: 'Gate 2 · ผู้เรียน', sub: 'ส่งงานในรายวิชา และทำโจทย์จริงของ SME / ชุมชน 14 ขั้น', door: 'ทั้งสองประตู' },
  { n: 3, title: 'Gate 3 · SME / องค์กร', sub: 'ผลิตเคสจากข้อมูลจริง ตัดสินผลงาน และค้นหาผลงานที่เผยแพร่', door: 'ประตูเปิด · THAItern' },
];

export default function Home() {
  const { me, signIn } = useSession();
  const router = useRouter();
  const q = useQuery({ queryKey: ['personas'], queryFn: () => api<{ personas: Persona[] }>('/v1/dev/personas') });

  async function pick(p: Persona) {
    const r = await api<{ token: string }>('/v1/dev/login', { body: { userId: p.id } });
    await signIn(r.token);
    router.push(homeOf(p.role));
  }

  return (
    <>
      <section className="c-hero" style={{ marginBottom: 22 }}>
        <p className="dim fs13 mb0">Atikarn Startup Project 2026</p>
        <h1 style={{ marginTop: 4 }}>หนึ่งเครื่องยนต์ สองประตู</h1>
        <p className="muted fs15" style={{ maxWidth: '68ch' }}>
          THAItern ให้ผู้เรียนทั่วประเทศฝึกคิดกับโจทย์จริงของ SMEs และชุมชน · IDEAX ให้อาจารย์เห็นกระบวนการคิดกับ AI ของนักศึกษา ทั้งสองใช้คลังโจทย์ Decision Trace และหลักฐานทักษะชุดเดียวกัน
        </p>
        <div className="row fs13">
          <span className="chip p">
            <span className="dot" /> ฟ้า = AI เสนอ
          </span>
          <span className="chip v">
            <span className="dot" /> เขียว = มนุษย์ยืนยัน
          </span>
          <span className="chip a">
            <span className="dot" /> เทาเส้นประ = ข้อมูลไม่พอ
          </span>
        </div>
        {me && (
          <p style={{ marginTop: 14 }}>
            เข้าสู่ระบบเป็น <b>{me.user.name}</b> · <Link href={homeOf(me.user.role)}>ไปหน้าของฉัน →</Link>
          </p>
        )}
      </section>

      <div className="page-h">
        <div>
          <h2>เลือกผู้ใช้เพื่อเข้าแต่ละ Gate</h2>
          <p className="muted fs14">บัญชีเดโมทั้งหมดเป็นบุคคลและกิจการสมมติ · ผู้เรียนใหม่สมัครเองได้</p>
        </div>
        <Link className="btn pri" href="/signup">
          สมัครผู้เรียนใหม่
        </Link>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading what="ผู้ใช้เดโม" />}
      {GATES.map((g) => {
        const list = (q.data?.personas ?? []).filter((p) => p.role !== 'platform_admin' && gateOf(p.role) === g.n);
        return (
          <section key={g.n} className="sec-head">
            <div className="between" style={{ marginBottom: 10 }}>
              <div>
                <h3>
                  <span className={`gate-tag g${g.n}`}>{g.door}</span> {g.title}
                </h3>
                <p className="muted fs14 mb0">{g.sub}</p>
              </div>
            </div>
            <div className="persona-grid">
              {list.map((p) => (
                <button key={p.id} className="persona" onClick={() => pick(p)} data-testid={`persona-${p.id}`}>
                  <strong>{p.name}</strong>
                  <span>{ROLE_LABEL[p.role]}{p.orgName ? ` · ${p.orgName}` : ''}</span>
                  {p.institution && <span className="dim">{p.institution} · {p.province}</span>}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
