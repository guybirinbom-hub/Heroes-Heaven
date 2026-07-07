// Supabase client for cloud sync (accounts + character backup).
//
// Cloud sync activates whenever the project URL + publishable key are configured at build time. It
// runs on BOTH the hosted web build and the installed desktop/Android (Tauri) apps, so a player can
// sign in on their laptop's browser and their PC's installed app and have the same characters follow
// them. The difference is the login *policy*, enforced in App.tsx: the web build requires a login
// (friends-only), while the installed app offers an optional login with a "use offline" skip.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Both the Supabase URL and publishable key were provided at build time. */
export const isCloudConfigured = !!(url && anonKey);

/** Cloud sync is available (configured). Whether login is *required* is a per-platform policy in App. */
export const isCloudSyncEnabled = isCloudConfigured;

/** The shared Supabase client, or `null` when cloud sync isn't configured.
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
