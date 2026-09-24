-- Heroes Heaven — Campaign homebrew: a GM's own homebrew, shared read-only with a campaign's players.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run),
-- AFTER supabase-campaigns.sql and supabase-campaign-characters.sql. Idempotent: safe to re-run.
--
-- One row per shared record: the source itself (kind = 'source') and each entry in it (kind = its
-- homebrew bucket: items, feats, spells, ancestries, heritages, backgrounds, actions, deities, …).
-- `id` is the GM's OWN id, unchanged, so a player's sheet and the GM's view of it resolve the same
-- record. Per-entry rows, so an edit uploads only what was edited and two of the GM's devices never
-- overwrite each other's whole copy.
--
-- The GM's own homebrew (his synced account data) stays the original; these rows are the published copy.
-- Only the campaign's GM writes. Reading follows the campaign-system convention (MEMBERS READ below):
-- any signed-in account the GM hasn't kicked can read, because membership lives in each player's synced
-- data, not on the server — server-side membership is a separate task. Players keep the last copy they
-- pulled on their device. Deleting the campaign deletes its rows (the players' apps then keep what they
-- had as their own homebrew).

create table if not exists public.campaign_homebrew (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  kind        text not null check (kind ~ '^[a-z]+$'),   -- 'source' or a homebrew bucket; the app validates the list
  id          text not null,
  source_id   text not null,
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, kind, id)
);
create index if not exists campaign_homebrew_source_idx on public.campaign_homebrew (campaign_id, source_id);

-- The GM's kick list, read by the member policy below. Also added by supabase-campaign-characters.sql;
-- repeated so the order these files are run in doesn't matter.
alter table public.campaigns add column if not exists removed uuid[] not null default '{}'::uuid[];

-- THE SERVER STAMPS THE TIME (same rule as gm_tracker_state): no client clock ever orders anything.
create or replace function public.campaign_homebrew_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists campaign_homebrew_touch on public.campaign_homebrew;
create trigger campaign_homebrew_touch
  before insert or update on public.campaign_homebrew
  for each row execute function public.campaign_homebrew_touch();

alter table public.campaign_homebrew enable row level security;

-- GM WRITES: only the campaign's owner creates, edits and deletes its homebrew (and reads it back).
drop policy if exists chb_gm_all on public.campaign_homebrew;
create policy chb_gm_all on public.campaign_homebrew
  for all to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));

-- MEMBERS READ — the campaign-system convention, the same gate campaign_characters' cc_read uses. The
-- server keeps no member list (membership lives in each player's own synced data), so ANY signed-in
-- account that isn't on this campaign's kick list can read these rows; the app only asks for the
-- campaigns the player holds. What it really allows: an unfiltered `select * from campaign_homebrew`
-- returns every campaign's shared homebrew (campaign ids are readable through
-- campaigns_read_authenticated), so treat shared homebrew as visible to every signed-in user of the app.
-- server-side membership is a separate task: a member table that joins and kicks write to, which would
-- tighten this policy and every other campaign table's at once.
-- A kicked player's read comes back empty, and their app keeps what it had as their own homebrew.
drop policy if exists chb_member_read on public.campaign_homebrew;
create policy chb_member_read on public.campaign_homebrew
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and not (auth.uid() = any (coalesce(c.removed, '{}'::uuid[])))
    )
  );

-- Realtime: a GM's edit reaches players' open apps live. RLS gates the stream (a kicked player gets nothing).
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.campaign_homebrew'::regclass) then
    raise exception 'Refusing to enable Realtime: RLS is not enabled on public.campaign_homebrew.';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_homebrew'
  ) then
    alter publication supabase_realtime add table public.campaign_homebrew;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Self-confirming: policy_count = 2 and realtime_enabled = true means players can now receive shared homebrew.
select 'campaign_homebrew ready (GM writes, signed-in accounts read, realtime on)' as status,
       (select count(*) from pg_policies where tablename = 'campaign_homebrew') as policy_count,
       exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_homebrew'
       ) as realtime_enabled;
