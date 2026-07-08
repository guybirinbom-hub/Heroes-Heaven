/**
 * Heroes Heaven — Supabase keep-alive Worker.
 *
 * Supabase free-tier projects PAUSE after ~7 days with no activity, which would silently break login and
 * cloud sync for everyone. This Cloudflare Worker runs on a daily cron trigger (in Cloudflare's cloud —
 * NOTHING runs on your PC) and makes one tiny authenticated REST query, which touches Postgres and resets
 * the idle timer. Normal weekly play already keeps the project awake; this is insurance for dry spells.
 *
 * Deploy: see cloudflare-keepalive/README.md. Set SUPABASE_URL and SUPABASE_ANON_KEY as Worker variables
 * (the anon/publishable key is public-safe — it's already in the web bundle). Cron is set in wrangler.toml
 * (or the dashboard: Settings → Triggers → Cron).
 */
export default {
  async scheduled(_event, env, _ctx) {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      console.error('keep-alive: SUPABASE_URL / SUPABASE_ANON_KEY not set');
      return;
    }
    // A trivial RLS-scoped read of an existing table. It returns no rows to an anonymous caller, but the
    // query still executes against Postgres — enough activity to keep the project from pausing.
    const url = `${env.SUPABASE_URL}/rest/v1/user_data?select=user_id&limit=1`;
    try {
      const res = await fetch(url, {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
      });
      console.log(`keep-alive: ${res.status}`);
    } catch (e) {
      console.error('keep-alive: ping failed', e);
    }
  },
};
