'use client';
import { dt } from '@/lib/format';
import { Chip } from './ui';

/** The learner-facing result. Used for the teacher's preview and the learner's feedback page, so both see the same thing. */
export function Snapshot({ s }: { s: any }) {
  const under = s.average !== null && s.average < s.passMark;
  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <div>
            <h3>ผลที่อาจารย์ยืนยัน</h3>
            <p className="muted fs13 mb0">
              {s.releasedBy} {s.mode === 'preview' ? '· ตัวอย่างก่อนปล่อย' : `ปล่อยผลเมื่อ ${dt(s.releasedAt)}`} · เกณฑ์ {s.rubricId} · ฉบับที่ {s.versionNo}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="stat-n">{s.average !== null ? s.average.toFixed(2) : '—'}</div>
            <div className="dim fs13">เส้นผ่าน {Number(s.passMark).toFixed(1)} · ถ่วงน้ำหนักเท่ากันทุกข้อ</div>
          </div>
        </div>
        <div className={`bar3 ${under ? 'under' : ''}`}>
          <span style={{ width: `${((s.average ?? 0) / 4) * 100}%` }} />
          <i style={{ left: `${(s.passMark / 4) * 100}%` }} />
        </div>
        {s.note && <div className="rule info"><b>ข้อความจากอาจารย์</b>{s.note}</div>}
      </div>
      {s.criteria.map((c: any) => (
        <div className="crigrp" key={c.id}>
          <div className="crigrp-h">
            <h4>
              <span className="no">{c.no}</span> {c.name} <span className="dim fs13">· เฉลี่ย {c.average !== null ? c.average.toFixed(2) : '—'}</span>
            </h4>
          </div>
          <div className="crigrp-b">
            {c.items.map((it: any) => (
              <div className="it" key={it.no}>
                <div className="it-h">
                  <span className="no">{it.no}</span>
                  <p>{it.text}</p>
                </div>
                <div className="it-row">
                  {it.status === 'VERIFIED' ? <Chip tone="verified">อาจารย์ยืนยัน</Chip> : <Chip tone="attention">ส่งกลับให้แก้ · ไม่มีเกรด</Chip>}
                  {it.grade && <span className="band v">{it.grade}</span>}
                  {it.annotations?.map((a: string) => (
                    <span key={a} className="ann on">{a}</span>
                  ))}
                </div>
                <div className="it-body">
                  {it.feedback && <p className="fs14" style={{ margin: '6px 0 0' }}>{it.feedback}</p>}
                  {it.teacherNote && <div className="trail">อาจารย์: {it.teacherNote}</div>}
                  {it.evidence?.map((e: any, i: number) => (
                    <div key={i} className="evid isv" style={{ marginTop: 6, cursor: 'default' }}>
                      {e.loc} “{e.text}”
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
