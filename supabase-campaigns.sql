-- Heroes Heaven — Campaigns.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Creates the shared `campaigns` table so a GM can create a campaign and share its code with players.
--
-- Access model (friends-only app): a GM owns their campaigns; any signed-in user can READ a campaign
-- (they need its code to find it) so they can join. The code is the practical access key.

create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  description text not null default '',
  defaults    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.campaigns enable row level security;

-- The GM can create / read / edit / delete their OWN campaigns.
drop policy if exists campaigns_owner_all on public.campaigns;
create policy campaigns_owner_all on public.campaigns
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Any signed-in user can READ a campaign (needed to join by code). Permissive policies are OR'd, so
-- this adds read access on top of the owner policy without granting write.
drop policy if exists campaigns_read_authenticated on public.campaigns;
create policy campaigns_read_authenticated on public.campaigns
  for select to authenticated
  using (true);

notify pgrst, 'reload schema';

-- Self-confirming: if this returns a row, the table + policies are ready.
select 'campaigns table ready' as status,
       (select count(*) from pg_policies where tablename = 'campaigns') as policy_count;
