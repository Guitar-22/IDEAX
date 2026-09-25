/**
 * Demo entry: boots the real API inside the page, then renders the real Next.js pages
 * through an in-memory router. Everything is fictional demo data; reload = fresh demo.
 */
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import '../src/app/globals.css';
import './demo.css';
import { Providers } from '@/components/Providers';
import { AppBar } from '@/components/AppBar';
import { RouterCtx, type Router } from './router/router';
import { startBackend } from './backend';

import Home from '../src/app/page';
import Signup from '../src/app/signup/page';
import TQueue from '../src/app/t/page';
import TReview from '../src/app/t/review/[svid]/page';
import TRelease from '../src/app/t/release/[svid]/page';
import TCourse from '../src/app/t/course/page';
import SHome from '../src/app/s/page';
import SAssignment from '../src/app/s/a/[id]/page';
import SPortfolio from '../src/app/s/portfolio/page';
import SRequests from '../src/app/s/requests/page';
import SProfile from '../src/app/s/profile/page';
import LExplore from '../src/app/l/explore/page';
import LAttempt from '../src/app/l/a/[id]/page';
import PHome from '../src/app/p/page';
import PCase from '../src/app/p/c/[id]/page';
import CSearch from '../src/app/c/page';
import CPub from '../src/app/c/p/[id]/page';
import CShortlist from '../src/app/c/shortlist/page';
import CRequests from '../src/app/c/requests/page';
import Verify from '../src/app/verify/[code]/page';
import Pub from '../src/app/pub/[id]/page';

const ROUTES: [string, ComponentType<any>][] = [
  ['/', Home],
  ['/signup', Signup],
  ['/t', TQueue],
  ['/t/review/:svid', TReview],
  ['/t/release/:svid', TRelease],
  ['/t/course', TCourse],
  ['/s', SHome],
  ['/s/a/:id', SAssignment],
  ['/s/portfolio', SPortfolio],
  ['/s/requests', SRequests],
  ['/s/profile', SProfile],
  ['/l/explore', LExplore],
  ['/l/a/:id', LAttempt],
  ['/p', PHome],
  ['/p/c/:id', PCase],
  ['/c', CSearch],
  ['/c/p/:id', CPub],
  ['/c/shortlist', CShortlist],
  ['/c/requests', CRequests],
  ['/verify/:code', Verify],
  ['/pub/:id', Pub],
];

/** A promise React's `use()` can read synchronously, like Next.js hands pages their params. */
function resolved<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status: string; value: T };
  p.status = 'fulfilled';
  p.value = value;
  return p;
}

function match(path: string): { Page: ComponentType<any>; params: Record<string, string> } | null {
  const segs = path.split('?')[0].split('/').filter(Boolean);
  for (const [pattern, Page] of ROUTES) {
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    if (parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(segs[i])), true) : p === segs[i]))) return { Page, params };
  }
  return null;
}

function App() {
  const [stack, setStack] = useState<string[]>(['/']);
  const path = stack[stack.length - 1];
  const router = useMemo<Router>(
    () => ({
      path,
      push: (p) => setStack((s) => [...s, p]),
      replace: (p) => setStack((s) => [...s.slice(0, -1), p]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      refresh: () => {},
      prefetch: () => {},
      forward: () => {},
    }),
    [path],
  );
  useEffect(() => window.scrollTo(0, 0), [path]);
  const m = match(path);
  const params = useMemo(() => resolved(m?.params ?? {}), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <RouterCtx.Provider value={router}>
      <Providers>
        <div className="demo-bar" role="note">
          <span>
            <b>เดโม</b> · ระบบทั้งหมดรันในเบราว์เซอร์นี้ · ข้อมูลสมมติ · AI จำลอง · รีเฟรชหน้า = เริ่มใหม่
          </span>
          <span className="demo-path" data-testid="demo-path">{path}</span>
          {stack.length > 1 && (
            <button className="btn sm" onClick={router.back}>
              ← ย้อนกลับ
            </button>
          )}
        </div>
        <AppBar />
        <main>
          <div className="wrap" key={path}>
            {m ? (
              <m.Page params={params} />
            ) : (
              <div className="card">
                ไม่พบหน้า {path} ·{' '}
                <a href="/" onClick={(e) => (e.preventDefault(), router.push('/'))}>
                  หน้าแรก
                </a>
              </div>
            )}
          </div>
        </main>
      </Providers>
    </RouterCtx.Provider>
  );
}

function Boot() {
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  const step = useCallback((s: string) => setSteps((x) => [...x, s]), []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startBackend(step)
      .then((handler) => {
        (globalThis as any).__IDEAX_LOCAL__ = handler;
        setReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [step]);
  if (ready) return <App />;
  return (
    <div className="boot" data-testid="boot">
      <div className="boot-card">
        <div className="boot-brand">
          IDEAX <span>×</span> THAItern
        </div>
        <p className="dim">หนึ่งเครื่องยนต์ สองประตู · เดโมที่รันระบบจริงทั้งชุดในเบราว์เซอร์</p>
        <ol>
          {steps.map((s, i) => (
            <li key={i} className={i === steps.length - 1 && !error ? 'now' : 'done'}>
              {s}
            </li>
          ))}
        </ol>
        {error ? (
          <div className="boot-err" role="alert">
            <b>เปิดเดโมไม่สำเร็จ</b>
            <p>{error}</p>
            <p className="dim fs13">เบราว์เซอร์นี้อาจไม่อนุญาต WebAssembly · ลองเปิดด้วย Chrome / Edge / Safari รุ่นล่าสุด หรือรันในเครื่องด้วย npm run dev:api และ npm run dev:web</p>
          </div>
        ) : (
          <p className="dim fs13">ครั้งแรกใช้เวลาประมาณ 5–15 วินาที</p>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Boot />);
