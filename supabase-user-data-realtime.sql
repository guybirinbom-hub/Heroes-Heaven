-- Heroes Heaven — enable Realtime on the per-user cloud-sync row (user_data).
--
-- Run this ONCE in the Supabase SQL editor. It lets a change you make on one signed-in device reach your
-- OTHER open devices LIVE: each device subscribes to its own user_data row and pulls the moment it
-- changes, instead of only on the next open/focus. Row-Level Security still applies — an account only
-- receives Realtime events for its OWN row (user_id = auth.uid()), never anyone else's.
--
-- Idempotent: only adds user_data to the realtime publication if it isn't already a member. (The
-- user_data table itself is created by the base cloud-sync setup; this only turns Realtime on for it.)

do $$
begin
  -- SAFETY: Realtime authorizes postgres_changes via the table's RLS SELECT policy. If RLS is NOT enabled
  -- on user_data, adding it to the publication would broadcast EVERY user's row to every client. Refuse
  -- to proceed in that case. (The base cloud-sync setup already enables RLS with a user_id = auth.uid()
  -- policy; this only turns Realtime on for that already-protected table.)
  if not (select relrowsecurity from pg_class where oid = 'public.user_data'::regclass) then
    raise exception 'Refusing to enable Realtime: RLS is not enabled on public.user_data. Enable RLS with a user_id = auth.uid() policy first.';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_data'
  ) then
    alter publication supabase_realtime add table public.user_data;
  end if;
end $$;

notify pgrst, 'reload schema';

select 'user_data realtime ready' as status,
       exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_data'
       ) as realtime_enabled;
