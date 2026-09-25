'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Role } from '@ideax/contracts';
import { useSession } from '@/lib/session';
import { Loading } from './ui';

/** Client-side convenience only; the API enforces every permission itself. */
export function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return <Loading what="บัญชี" />;
  if (!me)
    return (
      <div className="empty">
        กรุณาเลือกผู้ใช้ก่อน · <Link href="/">ไปหน้าแรก</Link>
      </div>
    );
  if (!roles.includes(me.user.role))
    return (
      <div className="empty">
        หน้านี้สำหรับ {roles.join(', ')} · <Link href="/">สลับผู้ใช้</Link>
      </div>
    );
  return <>{children}</>;
}
