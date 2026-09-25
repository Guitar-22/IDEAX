'use client';
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import type { Tone } from '@ideax/contracts';
import { errText } from '@/lib/api';

/** Colour = meaning: blue = AI proposed, green = a human confirmed, grey dashed = not enough data. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls = tone === 'verified' ? 'v' : tone === 'proposed' ? 'p' : tone === 'attention' ? 'a' : 'n';
  return (
    <span className={`chip ${cls}`}>
      <span className="dot" /> {children}
    </span>
  );
}

export function Loading({ what = 'ข้อมูล' }: { what?: string }) {
  return <div className="empty" role="status">กำลังโหลด{what}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <div className="b" />
      {children}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="err" role="alert">
      {errText(error)}
    </div>
  );
}

export function Rule({ kind = 'ok', title, children }: { kind?: 'ok' | 'info' | 'warn'; title?: string; children: ReactNode }) {
  return (
    <div className={`rule ${kind === 'ok' ? '' : kind}`}>
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3 style={{ marginBottom: 12 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Label bound to its control (accessible name for screen readers and tests). */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<any>, { id: (children.props as any).id ?? id }) : children;
  return (
    <div className="field">
      <label htmlFor={isValidElement(children) ? ((children.props as any).id ?? id) : undefined}>{label}</label>
      {control}
      {hint && <div className="dim fs13" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Steps({ items, current, done }: { items: Array<{ key: string; name: string }>; current: string; done: (key: string) => boolean }) {
  return (
    <div className="steps" aria-label="ขั้นของเส้นทาง">
      {items.map((s) => (
        <span key={s.key} className={`step ${s.key === current ? 'now' : done(s.key) ? 'done' : ''}`}>
          <span className="n">{s.key}</span>
          {s.name}
        </span>
      ))}
    </div>
  );
}
