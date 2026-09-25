'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dt } from '@/lib/format';

/** Mockup "บันทึกระบบ": every transition with actor, role, before → after, reason, correlation id. */
export function AuditDrawer({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api<{ rows: any[] }>('/v1/audit?limit=80') });
  return (
    <>
      <div className="veil" onClick={onClose} />
      <aside className="drawer" aria-label="บันทึกระบบ">
        <div className="drawer-h">
          <div>
            <strong>บันทึกระบบ</strong>
            <div className="dim fs13">ทุก transition เก็บผู้กระทำ บทบาท สถานะก่อน–หลัง เหตุผล และ correlation id · แก้หรือลบไม่ได้</div>
          </div>
          <button className="btn sm" onClick={onClose}>
            ปิด
          </button>
        </div>
        <div className="drawer-b">
          {q.data?.rows.length === 0 && <div className="empty">ยังไม่มีรายการ</div>}
          {q.data?.rows.map((a) => (
            <div className="log" key={a.id}>
              <b>{dt(a.at)}</b> · {a.object}
              <br />
              {a.actor_name ?? 'system'} ({a.role}) · {a.prev} → <b>{a.next}</b>
              <br />
              reason: {a.reason} · <span style={{ opacity: 0.7 }}>{a.correlation_id}</span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
