'use client';

// Minimal auth context — probes /api/auth/me once and exposes { user, loading }.
// The 401 on /auth/me is the ONLY thing that should bounce to /login
// (handled in lib/api.ts). feedback_proxy_401_cascade.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  isSuperuser?: boolean;
  appRoles?: Record<string, unknown>;
  theme?: string | null;
  locale?: string | null;
}

interface AuthState { user: AuthUser | null; loading: boolean; }
const Ctx = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    let alive = true;
    api<AuthUser>('/api/auth/me')
      .then((user) => { if (alive) setState({ user, loading: false }); })
      .catch(() => { if (alive) setState({ user: null, loading: false }); });
    return () => { alive = false; };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }
