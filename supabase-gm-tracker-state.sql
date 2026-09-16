-- Heroes Heaven — the GM's initiative-tracker state, mirrored across that GM's OWN devices.
--
-- Run this ONCE in the Supabase SQL editor (order doesn't matter — it depends on nothing but auth.users).
--
-- What it is: one row per (account, localStorage key). The GM still PLAYS off localStorage — the tracker
-- writes local exactly as it always did and nothing here is on the hot path — this table is only the
-- mirror, so that opening the app on a second GM device shows the current encounter and every saved
-- encounter, and a change on one GM device reaches the other one live.
--
-- PRIVATE TO THE OWNER: unlike campaign_characters (any signed-in member may read), the initiative order
-- and monster data are the GM's. The only policy here is owner_id = auth.uid(), for select AND for write,
-- so a player can never read a GM's board. Realtime honours the same policy, so the live stream is
-- likewise owner-only.
--
-- Keys the app mirrors (see src/data/trackerSync.ts): pf2e-current-combat:<campaignId> (one per campaign),
-- pf2e-encounters, pf2e-parties, pf2e-encounter-tables, pf2e-custom-conditions, pf2e-dm-turn-average,
-- pf2e-custom-creatures. DEVICE preferences (settings, themes, disabled sources, the GM screen layout and
-- its widgets), the bare `pf2e-current-combat` standalone board and `pf2e-current-combat:local` (the
-- signed-out table, which has no online features by ruling) are deliberately NOT mirrored.
--
-- Idempotent: safe to re-run.

create table if not exists public.gm_tracker_state (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- THE SERVER STAMPS THE TIME, ALWAYS.
--
-- `default now()` only fires on an INSERT that omits the column, and an upsert's UPDATE path never
-- fires it at all — so before this trigger the clients' own wall clocks were what ordered two GM
-- devices against each other. A laptop 45 seconds slow had its edits read as older than the desktop's
-- last change, the desktop "corrected" the cloud with its own stale board, and the laptop's work was
-- destroyed every round, silently. Now updated_at is one clock (this one), whatever a client sends.
create or replace function public.gm_tracker_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gm_tracker_state_touch on public.gm_tracker_state;
create trigger gm_tracker_state_touch
  before insert or update on public.gm_tracker_state
  for each row execute function public.gm_tracker_state_touch();

alter table public.gm_tracker_state enable row level security;

-- The owner — and only the owner — reads and writes their own rows.
drop policy if exists gts_owner_all on public.gm_tracker_state;
create policy gts_owner_all on public.gm_tracker_state
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Realtime: a change on one of this account's GM devices reaches the others live instead of only on the
-- next open/focus. RLS still gates the stream (owner_id = auth.uid()), so nobody else receives these rows.
-- Idempotent: only add the table to the realtime publication if it isn't already a member.
do $$
begin
  -- SAFETY: Realtime authorizes postgres_changes through the table's RLS SELECT policy. Publishing a
  -- table with RLS off would broadcast every account's board to every client — refuse in that case.
  if not (select relrowsecurity from pg_class where oid = 'public.gm_tracker_state'::regclass) then
    raise exception 'Refusing to enable Realtime: RLS is not enabled on public.gm_tracker_state.';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gm_tracker_state'
  ) then
    alter publication supabase_realtime add table public.gm_tracker_state;
  end if;
end $$;

notify pgrst, 'reload schema';

select 'gm_tracker_state ready (owner-only, realtime on)' as status,
       (select count(*) from pg_policies where tablename = 'gm_tracker_state') as policy_count,
       exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gm_tracker_state'
       ) as realtime_enabled;
