// Supabase client for the WEB build's cloud sync (accounts + character backup).
//
// Scope for v1: cloud sync activates ONLY in the browser build, and ONLY when the project URL +
// publishable key are configured. The desktop/Android (Tauri) apps deliberately stay local-only
// with no login — so we gate on `!isTauri` even if the keys are present in the bundle. This keeps
// the installed apps behaving exactly as they do today; the hosted web version is the one that
// logs friends in and mirrors their roster to the cloud.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isTauri } from '../platform';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Both the Supabase URL and publishable key were provided at build time. */
export const isCloudConfigured = !!(url && anonKey);

/** Cloud sync is live: configured AND running as the web build (not the Tauri desktop/mobile shell). */
export const isCloudSyncEnabled = isCloudConfigured && !isTauri;

/** The shared Supabase client, or `null` when cloud sync isn't active (desktop, or unconfigured).
 *  Callers must handle null — treat it as "local-only, no accounts". */
export const supabase: SupabaseClient | null = isCloudSyncEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        // Keep the session across reloads so friends log in once, then it's open-and-go.
        persistSession: true,
        autoRefreshToken: true,
        // Complete the magic-link redirect automatically when the app loads with the token.
        detectSessionInUrl: true,
        // Implicit flow: the magic link is self-contained (token in the URL), so it completes even
        // when the email opens it in a different browser than the one that requested it — which is
        // the norm on iPhone (link taps open Safari, not the installed PWA). PKCE would fail there.
        flowType: 'implicit',
        // Namespaced so it never collides with the app's own localStorage keys.
        storageKey: 'heroes-heaven.auth',
      },
    })
  : null;
