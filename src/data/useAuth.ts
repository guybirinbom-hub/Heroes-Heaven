import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isCloudSyncEnabled } from './supabase';

export type AuthStatus = 'disabled' | 'loading' | 'signed-out' | 'signed-in';

export interface AuthState {
  /** 'disabled' when cloud sync is off (desktop / unconfigured) — the app runs local-only with no login. */
  status: AuthStatus;
  session: Session | null;
  email: string | null;
}

/**
 * Tracks the Supabase auth session for the web build. When cloud sync is disabled (desktop app, or
 * no Supabase config) this immediately reports 'disabled' and never touches Supabase, so the
 * installed apps behave exactly as before.
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  // Start in loading only when we actually have a client to ask; otherwise we're 'disabled'.
  const [loading, setLoading] = useState(isCloudSyncEnabled);

  useEffect(() => {
    if (!isCloudSyncEnabled || !supabase) return;
    let mounted = true;
    // Read any persisted session (and complete a magic-link redirect if one is in the URL).
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    // React to sign-in / sign-out / token-refresh for the life of the app.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!isCloudSyncEnabled) return { status: 'disabled', session: null, email: null };
  if (loading) return { status: 'loading', session: null, email: null };
  if (!session) return { status: 'signed-out', session: null, email: null };
  return { status: 'signed-in', session, email: session.user.email ?? null };
}

/** Sign the current user out (web build only; no-op when cloud sync is disabled). */
export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}
