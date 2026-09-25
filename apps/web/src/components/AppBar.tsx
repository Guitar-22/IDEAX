'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABEL } from '@ideax/contracts';
import { gateOf, useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { Logo } from './Logo';
import { AuditDrawer } from './AuditDrawer';
import { useToast } from './ui';

const NAV: Record<number, Array<[string, string]>> = {
  1: [
    ['/t', 'หน้าหลัก'],
    ['/t/course', 'รายวิชาและกลุ่มผู้เรียน'],
  ],
  2: [
    ['/s', 'วันนี้'],
    ['/l/explore', 'โจทย์จริง'],
    ['/s/portfolio', 'ผลงาน'],
    ['/s/requests', 'คำขอติดต่อ'],
    ['/s/profile', 'โปรไฟล์'],
  ],
  3: [],
};
const NAV3: Record<string, Array<[string, string]>> = {
  org_member: [
    ['/c', 'ค้นหา'],
    ['/c/shortlist', 'Shortlist'],
    ['/c/requests', 'คำขอของเรา'],
  ],
  default: [['/p', 'เคส']],
};

export function AppBar() {
  const { me, signOut } = useSession();
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [log, setLog] = useState(false);
  const [aiDown, setAiDown] = useState(false);
  const gate = me ? gateOf(me.user.role) : null;
  const nav = gate === 3 ? (NAV3[me!.user.role] ?? NAV3.default) : gate ? NAV[gate] : [];

  async function toggleAi() {
    const r = await api<{ aiDown: boolean }>('/v1/dev/ai-down', { body: { down: !aiDown } }).catch(() => null);
    if (r) {
      setAiDown(r.aiDown);
      toast(r.aiDown ? 'จำลอง AI ล่ม: เปิด — ลองส่งงาน ระบบยังต้องออกใบรับงาน' : 'จำลอง AI ล่ม: ปิด');
    }
  }

  return (
    <header className="appbar">
      <div className="appbar-in">
        <Link className="brand" href="/" aria-label="IDEAX หน้าแรก">
          <Logo />
          <span className="logo-word">
            <b>IDEA</b>
            <i>X</i>
          </span>
          <small className="logo-tag">Student Ideas. Real Impact.</small>
        </Link>
        {gate && <span className={`gate-tag g${gate}`}>Gate {gate}</span>}
        <nav className="appbar-nav" aria-label="เมนูหลัก">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className={path === href || (href !== '/s' && href !== '/t' && href !== '/c' && path.startsWith(href)) ? 'on' : ''}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="bar-tools">
          {me && (
            <>
              <button className={`tgl warn ${aiDown ? 'on' : ''}`} onClick={toggleAi} title="เครื่องมือเดโม">
                <span className="sw" />
                จำลอง AI ล่ม
              </button>
              <button className="btn sm" onClick={() => setLog(true)}>
                บันทึกระบบ
              </button>
              <span className="who">
                <span className="ava" aria-hidden="true">{me.user.name.slice(0, 1)}</span>
                <span>
                  {me.user.name}
                  <br />
                  <span className="dim fs13">{ROLE_LABEL[me.user.role]}</span>
                </span>
              </span>
              <button
                className="btn sm"
                onClick={() => {
                  signOut();
                  router.push('/');
                }}
              >
                สลับผู้ใช้
              </button>
            </>
          )}
        </div>
      </div>
      {log && <AuditDrawer onClose={() => setLog(false)} />}
    </header>
  );
}
