/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The app's package.json version, injected by `define` in vite.config.ts / vitest.config.ts.
 *  Read it through src/version.ts, which guards against consumers without the define. */
declare const __APP_VERSION__: string;
/** Per rules-data file, the first 12 hex of the sha1 of its bytes (public/core.json,
 *  public/core-descriptions.json), injected by `define` in vite.config.ts. Read it through
 *  src/version.ts (DATA_VERSIONS). */
declare const __DATA_VERSIONS__: Record<string, string>;

interface ImportMetaEnv {
  /** Supabase project URL (web-build cloud sync). Absent → cloud sync stays off. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable ("anon") key — public-safe; RLS protects the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
