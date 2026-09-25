'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const LEVEL: Record<string, string> = { WATCH: 'Watch · ดูตัวอย่าง', GUIDED: 'Guided · มีคำใบ้', SOLO: 'Solo · ทำเอง' };

/** 7-Stage progress with Sawtooth support level per stage. */
export function StageMeter() {
  const q = useQuery({ queryKey: ['stages'], queryFn: () => api<{ stages: any[] }>('/v1/me/stages') });
  if (!q.data) return null;
  return (
    <div>
      <div className="meter" aria-label="7 ขั้นของทักษะ">
        {q.data.stages.map((s) => (
          <div key={s.n} className={`st ${s.mastered ? 'm' : ''} ${s.open ? '' : 'lock'}`} data-testid={`stage-${s.n}`}>
            <span className="dim">Stage {s.n}</span>
            <b>{s.th}</b>
            <span className="dim">{s.mastered ? 'ผ่านแล้ว ✓' : LEVEL[s.supportLevel]}</span>
            {!s.mastered && s.consecutiveSolo > 0 && <div className="dim">Solo ติดกัน {s.consecutiveSolo}/2</div>}
          </div>
        ))}
      </div>
      <p className="dim fs13" style={{ marginTop: 8 }}>
        ผ่านแต่ละขั้นเมื่อทำเองโดยไม่ใช้ตัวช่วย (Solo) 2 ครั้งติดกันใน 2 อุตสาหกรรมที่ต่างกัน · ขั้นใหม่เริ่มที่ Watch อีกครั้งแบบฟันปลา
      </p>
    </div>
  );
}
