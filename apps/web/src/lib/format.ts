const TZ = 'Asia/Bangkok';

export function dt(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(v));
}
export function d(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: TZ }).format(new Date(v));
}
export function baht(n: number): string {
  return `${n.toLocaleString('th-TH')} บาท`;
}
export function left(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms <= 0) return 'หมดเวลาแล้ว';
  const days = Math.floor(ms / 86400000);
  const hrs = Math.floor((ms % 86400000) / 3600000);
  return `${days} วัน ${hrs} ชั่วโมง`;
}
