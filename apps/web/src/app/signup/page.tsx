'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GUARDIAN_AGE_LIMIT } from '@ideax/contracts';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ErrorBox, Field, Rule } from '@/components/ui';

/** Consent texts summarised from the plan, appendix B (clickwrap). */
const CONSENTS = [
  { code: 'tos', required: true, text: 'ข้อกำหนดการใช้งาน: ตกลงตามข้อกำหนดของแพลตฟอร์ม รวมถึงการส่งผลงานอย่างสุจริต และการระงับหรือเพิกถอนใบรับรองหากฝ่าฝืน' },
  { code: 'confidentiality', required: true, text: 'การรักษาความลับ: จะไม่เปิดเผย คัดลอก ดาวน์โหลด ถ่ายภาพหน้าจอ หรือส่งต่อข้อมูลของ SME / ชุมชนและ Case Booklet' },
  { code: 'pdpa_ai', required: true, text: 'ข้อมูลส่วนบุคคลและการใช้ AI: รับทราบการประมวลผล Decision Trace ด้วย AI เพื่อประเมินทักษะ ออกหลักฐานทักษะ และทำสถิติ · ผลจาก AI อาจผิดพลาดและไม่ใช่ผลทางการจนมนุษย์ยืนยัน' },
  { code: 'talent_matching', required: false, text: '(ทางเลือก) Talent Matching: ยินยอมให้ใช้ข้อมูลเพื่อจับคู่โอกาสฝึกงานหรือทำงานกับองค์กร ถอนได้ทุกเมื่อ' },
] as const;

export default function Signup() {
  const router = useRouter();
  const { signIn, refresh } = useSession();
  const [f, setF] = useState({ name: '', email: '', birthYear: 2005, institution: '', province: '', faculty: '', phone: '', guardianPhone: '' });
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<unknown>(null);
  const [otpStep, setOtpStep] = useState<{ devOtp?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const year = new Date().getFullYear();
  const minor = year - f.birthYear < GUARDIAN_AGE_LIMIT;
  const requiredOk = CONSENTS.filter((c) => c.required).every((c) => consents[c.code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ token: string; guardianRequired: boolean; devOtp?: string }>('/v1/auth/signup', {
        body: { ...f, guardianPhone: minor ? f.guardianPhone : undefined, faculty: f.faculty || undefined, consents: Object.keys(consents).filter((k) => consents[k]) },
      });
      await signIn(r.token);
      if (r.guardianRequired) setOtpStep({ devOtp: r.devOtp });
      else router.push('/s');
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  }

  async function confirmOtp() {
    setErr(null);
    try {
      await api('/v1/consents/guardian/confirm', { body: { code: otp } });
      await refresh();
      router.push('/s');
    } catch (e) {
      setErr(e);
    }
  }

  if (otpStep)
    return (
      <div className="panel" style={{ maxWidth: 560, padding: 22 }}>
        <h1>รอความยินยอมจากผู้ปกครอง</h1>
        <p className="muted">ส่งรหัส OTP ไปที่เบอร์ผู้ปกครองแล้ว ระหว่างนี้เรียนพื้นฐานได้ แต่ยังเปิด Case Booklet ไม่ได้จนกว่าผู้ปกครองยืนยัน</p>
        {otpStep.devOtp && <Rule kind="info" title="โหมดเดโม">รหัสที่ส่งถึงผู้ปกครองคือ <b data-testid="dev-otp">{otpStep.devOtp}</b></Rule>}
        <Field label="รหัส OTP 6 หลักที่ผู้ปกครองได้รับ">
          <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} />
        </Field>
        <ErrorBox error={err} />
        <div className="row">
          <button className="btn pri" onClick={confirmOtp} disabled={otp.length !== 6}>
            ยืนยันความยินยอม
          </button>
          <button className="btn" onClick={() => router.push('/s')}>
            ข้ามไปก่อน
          </button>
        </div>
      </div>
    );

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === 'birthYear' ? Number(e.target.value) : e.target.value });
  return (
    <form className="panel" style={{ maxWidth: 720, padding: 22 }} onSubmit={submit}>
      <h1>สมัครผู้เรียน</h1>
      <p className="muted fs14">ขั้นที่ 1 ของเส้นทาง · ใช้เวลาไม่ถึงหนึ่งนาที ยืนยันบัตรนักศึกษาทีหลังได้ก่อนเปิดข้อมูลของเจ้าของโจทย์</p>
      <div className="grid2">
        <Field label="ชื่อ-นามสกุล"><input type="text" required value={f.name} onChange={set('name')} /></Field>
        <Field label="อีเมล"><input type="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label="ปีเกิด (ค.ศ.)"><input type="number" required value={f.birthYear} onChange={set('birthYear')} /></Field>
        <Field label="เบอร์มือถือ (ยืนยันด้วย OTP)"><input type="text" required value={f.phone} onChange={set('phone')} /></Field>
        <Field label="สถานศึกษา"><input type="text" required value={f.institution} onChange={set('institution')} /></Field>
        <Field label="จังหวัด"><input type="text" required value={f.province} onChange={set('province')} /></Field>
        <Field label="คณะ / สาขา (ถ้ามี)"><input type="text" value={f.faculty} onChange={set('faculty')} /></Field>
        {minor && (
          <Field label="เบอร์ผู้ปกครอง" hint={`อายุต่ำกว่า ${GUARDIAN_AGE_LIMIT} ปี ต้องได้รับความยินยอมจากผู้ปกครองผ่าน OTP`}>
            <input type="text" required value={f.guardianPhone} onChange={set('guardianPhone')} />
          </Field>
        )}
      </div>
      <h3 style={{ margin: '14px 0 6px' }}>ความยินยอม</h3>
      <p className="dim fs13">แยกตามวัตถุประสงค์ · ข้อบังคับ 3 ข้อ และทางเลือก 1 ข้อ</p>
      {CONSENTS.map((c) => (
        <label key={c.code} className="check">
          <input type="checkbox" checked={!!consents[c.code]} onChange={(e) => setConsents({ ...consents, [c.code]: e.target.checked })} />
          <span>
            {c.required && <b>(บังคับ) </b>}
            {c.text}
          </span>
        </label>
      ))}
      <ErrorBox error={err} />
      <button className="btn pri" type="submit" disabled={!requiredOk || busy} style={{ marginTop: 10 }}>
        สมัครและเริ่มต้น
      </button>
      {!requiredOk && <span className="dim fs13" style={{ marginLeft: 10 }}>ติ๊กข้อบังคับให้ครบก่อน</span>}
    </form>
  );
}
