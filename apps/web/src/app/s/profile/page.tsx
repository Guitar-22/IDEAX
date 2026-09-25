'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CONSENTS } from '@ideax/contracts';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Guard } from '@/components/Guard';
import { StageMeter } from '@/components/StageMeter';
import { Chip, ErrorBox, Field, Rule, useToast } from '@/components/ui';

function Profile() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const payouts = useQuery({ queryKey: ['payouts'], queryFn: () => api<any>('/v1/me/payouts') });
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const card = useMutation({ mutationFn: () => api('/v1/identity/student-card', { body: { fileName: 'student-card.jpg' } }), onSuccess: () => (toast('ยืนยันบัตรนักศึกษาแล้ว'), refresh()) });
  const consent = useMutation({ mutationFn: (v: { code: string; action: 'give' | 'withdraw' }) => api(`/v1/consents/${v.code}/${v.action}`, { body: {} }), onSuccess: () => refresh() });
  const resend = useMutation({ mutationFn: () => api<any>('/v1/consents/guardian/resend', { body: {} }), onSuccess: (r) => setDevOtp(r.devOtp ?? null) });
  const confirm = useMutation({ mutationFn: () => api('/v1/consents/guardian/confirm', { body: { code: otp } }), onSuccess: () => (toast('ผู้ปกครองยืนยันแล้ว'), refresh()) });
  if (!me) return null;
  return (
    <>
      <h1>โปรไฟล์ · {me.user.name}</h1>
      <p className="muted fs14">{me.user.institution} · {me.user.province}</p>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>ตัวตน</h3>
          <div className="row" style={{ margin: '8px 0' }}>
            {me.user.studentCardVerified ? <Chip tone="verified">ยืนยันบัตรนักศึกษาแล้ว</Chip> : <Chip tone="attention">ยังไม่ยืนยันบัตร</Chip>}
            {!me.user.studentCardVerified && (
              <button className="btn sm pri" onClick={() => card.mutate()} data-testid="verify-card">
                อัปโหลดบัตรนักศึกษา
              </button>
            )}
          </div>
          {me.minor && (
            <>
              <div className="row" style={{ margin: '8px 0' }}>
                {me.guardianConfirmed ? <Chip tone="verified">ผู้ปกครองยินยอมแล้ว</Chip> : <Chip tone="attention">รอผู้ปกครองยืนยัน</Chip>}
              </div>
              {!me.guardianConfirmed && (
                <>
                  <button className="btn sm" onClick={() => resend.mutate()}>
                    ส่งรหัสถึงผู้ปกครองอีกครั้ง
                  </button>
                  {devOtp && <Rule kind="info" title="โหมดเดโม">รหัสที่ผู้ปกครองได้รับ <b data-testid="dev-otp">{devOtp}</b></Rule>}
                  <Field label="รหัส OTP">
                    <input type="text" value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} />
                  </Field>
                  <button className="btn sm pri" disabled={otp.length !== 6} onClick={() => confirm.mutate()}>
                    ยืนยัน
                  </button>
                  <ErrorBox error={confirm.error} />
                </>
              )}
            </>
          )}
        </div>
        <div className="card">
          <h3>ความยินยอม</h3>
          <p className="dim fs13">แยกตามวัตถุประสงค์ · ถอนได้ · ทุกการเปลี่ยนแปลงเก็บเป็นประวัติ</p>
          {(['tos', 'confidentiality', 'pdpa_ai', 'talent_matching'] as const).map((c) => (
            <div className="between" key={c} style={{ padding: '6px 0', borderBottom: '1px solid var(--hairline-2)' }}>
              <span className="fs14">
                {CONSENTS[c].label} {CONSENTS[c].required ? <span className="dim">(บังคับ)</span> : <span className="dim">(ทางเลือก)</span>}
              </span>
              <button
                className={`tgl ${me.consents[c] ? 'on' : ''}`}
                onClick={() => consent.mutate({ code: c, action: me.consents[c] ? 'withdraw' : 'give' })}
                data-testid={`consent-${c}`}
              >
                <span className="sw" />
                {me.consents[c] ? 'ให้แล้ว' : 'ยังไม่ให้'}
              </button>
            </div>
          ))}
          <ErrorBox error={consent.error} />
        </div>
      </div>
      <h2 className="sec-head">7 ขั้นของทักษะ</h2>
      <StageMeter />
      <h2 className="sec-head">รายได้จากผลงาน</h2>
      <div className="stat" style={{ maxWidth: 320 }}>
        <div className="stat-n">{payouts.data ? payouts.data.totalBaht.toLocaleString() : '—'} บาท</div>
        <div className="stat-l">ส่วนแบ่ง 40% จากการขายไอเดีย</div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['learner']}>
      <Profile />
    </Guard>
  );
}
