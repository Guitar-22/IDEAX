/** In-memory router for the demo page (the artifact cannot change its own URL). */
import { createContext, useContext } from 'react';

export interface Router {
  path: string;
  push(p: string): void;
  replace(p: string): void;
  back(): void;
  refresh(): void;
  prefetch(): void;
  forward(): void;
}
export const RouterCtx = createContext<Router | null>(null);
export function useDemoRouter(): Router {
  const r = useContext(RouterCtx);
  if (!r) throw new Error('RouterCtx missing');
  return r;
}
