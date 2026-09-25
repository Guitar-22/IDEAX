'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SME_GROUPS } from '@ideax/contracts';
import { api } from '@/lib/api';
import { d } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Guard } from '@/components/Guard';
import { Chip, Empty, ErrorBox, Field, Modal } from '@/components/ui';

const HINT: Record<string, string> = {
  case_owner: 'เคสของกิจการคุณ · ลงนามข้อตกลง ส่งข้อมูล อนุมัติก่อนเผยแพร่ อ่านผลงานที่ผ่านการคัดกรอง',
  case_ops: 'ผลิตเคสจากข้อมูลจริง: ปกปิดตัวตน → ร่าง → ส่งผู้เชี่ยวชาญ → เจ้าของอนุมัติ',
  case_reviewer: 'ตรวจความสมจริงและความชัดเจนของทุกเคสก่อนเผยแพร่ · ชื่อของคุณจะแสดงบนเคส',
  judge: 'ยืนยันผลคัดกรองของ AI ทีละทีม แล้วปล่อยผลเมื่อยืนยันครบทุกทีม',
};

function Cases() {
  const { me } = useSession();
  const router = useRouter();
  const q = useQuery({ queryKey: ['pcases'], queryFn: () => api<{ cases: any[] }>('/v1/partner/cases') });
  const [form, setForm] = useState<any>(null);
  const create = useMutation({ mutationFn: () => api<any>('/v1/partner/cases', { body: { ...form, stages: form.stages.split(',').map(Number) } }), onSuccess: (r) => router.push(`/p/c/${r.id}`) });
  const role = me?.user.role ?? '';
  return (
    <>
      <div className="page-h">
        <div>
          <h1>เคส</h1>
          <p className="muted fs14">{HINT[role]}</p>
        </div>
        {role === 'case_ops' && (
          <button className="btn pri" onClick={() => setForm({ orgId: 'org_yogurt', track: 'sme', smeGroup: 'fnb', subCategory: '', industry: '', title: '', teaser: '', challengeBrief: '', stages: '1,3,6' })}>
            เปิดเคสใหม่
          </button>
        )}
      </div>
      <ErrorBox error={q.error} />
      {q.data?.cases.length === 0 && <Empty>ยังไม่มีเคส</Empty>}
      <div className="tbl">
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                <th>เคส</th>
                <th>เจ้าของโจทย์</th>
                <th>สถานะ</th>
                <th>ผู้ตรวจเคส</th>
                <th>ทีม / ผลงาน</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/p/c/${c.id}`}><strong>{c.title}</strong></Link>
                    <div className="dim fs13">{c.sub_category}</div>
                  </td>
                  <td>{c.org_name}</td>
                  <td>
                    <Chip tone={c.status === 'PUBLISHED' ? 'verified' : c.status === 'SUSPENDED' || c.status === 'RETIRED' ? 'attention' : 'proposed'}>{c.status}</Chip>
                    {c.published_at && <div className="dim fs13">เผยแพร่ {d(c.published_at)}</div>}
                  </td>
                  <td>{c.reviewed_by_name ?? '—'}</td>
                  <td>{c.attempts} / {c.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {form && (
        <Modal title="เปิดเคสใหม่" onClose={() => setForm(null)}>
          <Field label="องค์กรเจ้าของโจทย์ (id)"><input type="text" value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })} /></Field>
          <Field label="Track">
            <select value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value, smeGroup: e.target.value === 'sme' ? 'fnb' : null })}>
              <option value="sme">SMEs Track</option>
              <option value="community">Community Track</option>
            </select>
          </Field>
          {form.track === 'sme' && (
            <Field label="กลุ่ม SME">
              <select value={form.smeGroup} onChange={(e) => setForm({ ...form, smeGroup: e.target.value })}>
                {Object.entries(SME_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          )}
          {(['subCategory', 'industry', 'title', 'teaser', 'challengeBrief', 'stages'] as const).map((k) => (
            <Field key={k} label={{ subCategory: 'หมวดย่อย', industry: 'อุตสาหกรรม (ใช้กับกฎ Solo 2 อุตสาหกรรม)', title: 'ชื่อเคส', teaser: 'Teaser (ไม่บอกปัญหา)', challengeBrief: 'โจทย์ย่อ (ไม่ลับ)', stages: 'Stage ที่ฝึก เช่น 1,3,6' }[k]}>
              <input type="text" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
          <ErrorBox error={create.error} />
          <button className="btn pri" onClick={() => create.mutate()}>เปิดเคส</button>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Guard roles={['case_owner', 'case_ops', 'case_reviewer', 'judge']}>
      <Cases />
    </Guard>
  );
}
