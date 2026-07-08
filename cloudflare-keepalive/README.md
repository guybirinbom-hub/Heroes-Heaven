# Supabase keep-alive Worker

Keeps the Supabase project from pausing (free tier pauses after ~7 days idle, which would break login +
cloud sync). Runs a daily cron ping entirely in Cloudflare's cloud — nothing runs on your PC.

## Option A — Cloudflare dashboard (no local tooling)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**. Name it
   `heroes-heaven-keepalive`, Deploy (the default hello-world is fine for now).
2. **Edit code** → paste the contents of [`worker.js`](./worker.js) → **Deploy**.
3. Worker → **Settings → Variables and Secrets** → add two variables:
   - `SUPABASE_URL` = `https://<your-project>.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon / publishable key (the same public one in the web app)
4. Worker → **Settings → Triggers → Cron Triggers** → **Add** → `0 6 * * *` (daily at 06:00 UTC).
5. (Optional) Trigger it once now to confirm: **Deployments → … → Run** (or wait for the first cron). The
   log should show `keep-alive: 200`.

## Option B — Wrangler CLI

```bash
cd cloudflare-keepalive
npx wrangler deploy
npx wrangler secret put SUPABASE_URL       # paste https://<project>.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY  # paste the anon/publishable key
```

The cron is already declared in [`wrangler.toml`](./wrangler.toml).

## Notes

- The ping is one RLS-scoped REST read of `user_data` — returns no rows to an anonymous caller, but the
  query still hits Postgres, which is enough to reset the idle timer.
- Never put the Supabase **service_role**/secret key here — only the public anon key.
- Normal weekly play already keeps the project awake; this is just insurance for quiet stretches.
