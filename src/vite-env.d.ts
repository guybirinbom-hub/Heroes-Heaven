/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The app's package.json version, injected by `define` in vite.config.ts / vitest.config.ts.
 *  Read it through src/version.ts, which guards against consumers without the define. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Supabase project URL (web-build cloud sync). Absent → cloud sync stays off. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable ("anon") key — public-safe; RLS protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
