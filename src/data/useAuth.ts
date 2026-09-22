import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isCloudSyncEnabled } from './supabase';
import { setGmPendingAccount } from '../sheet/gmSync';

export type AuthStatus = 'disabled' | 'loading' | 'signed-out' | 'signed-in';

export interface AuthState {
  /** 'disabled' when cloud sync is off (desktop / unconfigured) — the app runs local-only with no login. */
  status: AuthStatus;
  session: Session | null;
  email: string | null;
}

/**
 * Tracks the Supabase auth session. Runs on both the web and installed builds whenever cloud sync is
 * configured. When it isn't configured this immediately reports 'disabled' and never touches Supabase,
 * so an unconfigured build runs purely local with no login.
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
      // Whose GM overlay this device may show. It is a private view of an edit the PLAYER has not
      // been told about, so it belongs to one account: see gmSync.setGmPendingAccount.
      setGmPendingAccount(data.session?.user.id ?? null);
      setSession(data.session);
      setLoading(false);
    });
    // React to sign-in / sign-out / token-refresh for the life of the app. This is also the one
    // place a SIGN-OUT is heard app-wide, and the pending overlay has to leave with the account.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setGmPendingAccount(s?.user.id ?? null);
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
  // Straight away, not on the auth event: a GM's pending edits are their private view of a change
  // the player has not been told about, and the next person to sign in on this browser profile must
  // never inherit them. (The listener above says the same thing again — this is the half that does
  // not depend on a component being mounted.)
  setGmPendingAccount(null);
  if (supabase) await supabase.auth.signOut();
}
