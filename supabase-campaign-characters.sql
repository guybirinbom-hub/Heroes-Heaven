-- Heroes Heaven — Campaign party (shared characters).
-- Run this ONCE in the Supabase SQL editor, AFTER supabase-campaigns.sql.
-- Lets party members see each other's attached characters (a summary for the cards + the full sheet
-- for the read-only view). A character is "attached" to a campaign when its owner publishes a row here.

create table if not exists public.campaign_characters (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  char_id     text not null,
  name        text not null default '',
  summary     jsonb not null default '{}'::jsonb,
  sheet       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, char_id)
);

create index if not exists campaign_characters_campaign_idx on public.campaign_characters (campaign_id);

alter table public.campaign_characters enable row level security;

-- GM "kick": a list of members the campaign owner has removed. Kicked users can't re-publish.
alter table public.campaigns add column if not exists removed uuid[] not null default '{}'::uuid[];

-- Owner publishes / updates / removes their own attached characters — UNLESS the GM has kicked them.
drop policy if exists cc_owner_write on public.campaign_characters;
create policy cc_owner_write on public.campaign_characters
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and not (auth.uid() = any (coalesce((select removed from public.campaigns c where c.id = campaign_id), '{}'::uuid[])))
  );

-- The campaign owner (GM) can DELETE any member's rows for their campaign (the kick action).
drop policy if exists cc_gm_delete on public.campaign_characters;
create policy cc_gm_delete on public.campaign_characters
  for delete to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));

-- Any signed-in user can READ (the party view; the campaign id — shared only with members — is the gate,
-- same model as the campaigns table).
drop policy if exists cc_read on public.campaign_characters;
create policy cc_read on public.campaign_characters
  for select to authenticated
  using (true);

-- GM edits: a GM's edited copy of a member's character, which that player's app applies on its next
-- sync (silently — no notification). One pending edit per (campaign, character); the player deletes it
-- after applying. Lets a GM secretly influence a player's character for in-game surprises.
create table if not exists public.gm_character_edits (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  char_id     text not null,
  owner_id    uuid not null references auth.users (id) on delete cascade,  -- the PLAYER
  editor_id   uuid not null references auth.users (id) on delete cascade,  -- the GM
  sheet       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, char_id)
);
create index if not exists gm_character_edits_owner_idx on public.gm_character_edits (owner_id);

alter table public.gm_character_edits enable row level security;

-- The campaign owner (GM) can write edits for their campaign.
drop policy if exists gce_gm_write on public.gm_character_edits;
create policy gce_gm_write on public.gm_character_edits
  for all to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.owner_id = auth.uid()));

-- The player (owner) can read their pending edits and delete them once applied.
drop policy if exists gce_owner_read on public.gm_character_edits;
create policy gce_owner_read on public.gm_character_edits for select to authenticated using (owner_id = auth.uid());
drop policy if exists gce_owner_delete on public.gm_character_edits;
create policy gce_owner_delete on public.gm_character_edits for delete to authenticated using (owner_id = auth.uid());

notify pgrst, 'reload schema';

select 'campaign_characters + gm_character_edits ready' as status,
       (select count(*) from pg_policies where tablename in ('campaign_characters', 'gm_character_edits')) as policy_count;
