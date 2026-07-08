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

-- Owner publishes / updates / removes their own attached characters.
drop policy if exists cc_owner_write on public.campaign_characters;
create policy cc_owner_write on public.campaign_characters
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Any signed-in user can READ (the party view; the campaign id — shared only with members — is the gate,
-- same model as the campaigns table).
drop policy if exists cc_read on public.campaign_characters;
create policy cc_read on public.campaign_characters
  for select to authenticated
  using (true);

notify pgrst, 'reload schema';

select 'campaign_characters table ready' as status,
       (select count(*) from pg_policies where tablename = 'campaign_characters') as policy_count;
