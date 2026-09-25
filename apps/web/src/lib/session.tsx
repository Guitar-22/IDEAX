'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Role } from '@ideax/contracts';
import { api, getToken, setToken } from './api';

export interface Me {
  user: { id: string; name: string; email: string; role: Role; orgId: string | null; institution: string | null; province: string | null; birthYear: number | null; studentCardVerified: boolean };
  consents: Record<string, boolean>;
  minor: boolean;
  guardianConfirmed: boolean;
  serverTime: string;
}

interface Session {
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Session>({ me: null, loading: true, signIn: async () => {}, signOut: () => {}, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/v1/me'));
    } catch {
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (token: string) => {
      setToken(token);
      qc.clear();
      await refresh();
    },
    [qc, refresh],
  );
  const signOut = useCallback(() => {
    setToken(null);
    qc.clear();
    setMe(null);
  }, [qc]);

  return <Ctx.Provider value={{ me, loading, signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** Which gate a role belongs to (mockup: Gate 1 อาจารย์ · Gate 2 นักศึกษา · Gate 3 บริษัท/SME). */
export function gateOf(role: Role): 1 | 2 | 3 {
  if (role === 'thesis_mentor' || role === 'assistant_marker') return 1;
  if (role === 'learner' || role === 'guardian') return 2;
  return 3;
}

export function homeOf(role: Role): string {
  if (gateOf(role) === 1) return '/t';
  if (gateOf(role) === 2) return '/s';
  if (role === 'org_member') return '/c';
  return '/p';
}
