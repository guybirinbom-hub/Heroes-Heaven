-- Heroes Heaven — Remove ONE character from a campaign, never the player (2026-11-17).
-- Run this ONCE in the Supabase SQL editor, AFTER supabase-campaign-characters.sql. Safe to run again.
--
-- Before: the GM's "Remove" put the PLAYER's account on the campaign's `removed` list and deleted every
-- character that player shared; the player could then share no character at all (a new one was refused too).
-- Now: "Remove" takes out only the character the GM picked. "<owner id>|<character id>" goes on
-- `removed_chars`, so the player's app cannot quietly send it back; the player's other characters and any new
-- one are not touched. When the player joins that character again with the campaign code (or presses Leave on
-- it), their app takes it off the list (allow_character_back: only the character's own player can).

alter table public.campaigns add column if not exists removed_chars text[] not null default '{}'::text[];

-- Owner publishes / updates / removes their own characters — unless the GM removed THAT character.
-- The old player-wide block (`removed`) is no longer checked: a GM's Remove never blocks a player.
drop policy if exists cc_owner_write on public.campaign_characters;
create policy cc_owner_write on public.campaign_characters
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and not ((owner_id::text || '|' || char_id) = any (coalesce((select removed_chars from public.campaigns c where c.id = campaign_id), '{}'::text[])))
  );

-- Lift every old player-wide block: empty the old list now. Then REFUSE any write that puts a player on it:
-- an older app (v0.1.46 or earlier) writes that list first and, only when that succeeds, deletes EVERY
-- character of the player — refusing the write stops that old Remove before it deletes anything, and its GM is
-- told to update (a checker's finding, 2026-11-17: quietly emptying the list let the old delete run).
update public.campaigns set removed = '{}'::uuid[] where removed <> '{}'::uuid[];
create or replace function public.campaigns_never_block_players()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(array_length(new.removed, 1), 0) > 0 then
    raise exception 'Update Heroes Heaven to remove one character (this version removed every character of the player).';
  end if;
  return new;
end;
$$;
drop trigger if exists campaigns_never_block_players on public.campaigns;
create trigger campaigns_never_block_players
  before insert or update on public.campaigns
  for each row execute function public.campaigns_never_block_players();

-- Shared homebrew: every signed-in account may read it again (the old rule hid it from a blocked player).
do $$
begin
  if to_regclass('public.campaign_homebrew') is not null then
    drop policy if exists chb_member_read on public.campaign_homebrew;
    create policy chb_member_read on public.campaign_homebrew
      for select to authenticated
      using (exists (select 1 from public.campaigns c where c.id = campaign_id));
  end if;
end $$;

-- A player takes their own character off a campaign's removed list when they join it again with the code.
-- Only the GM may write the campaign row, so this one narrow change runs as a function. It removes only
-- "<caller's own id>|<character>", so no player can bring back someone else's character.
-- Answers true when it took the entry off (the app then sends the character to the party again at once).
drop function if exists public.allow_character_back(uuid, text);
create function public.allow_character_back(p_campaign uuid, p_char text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with back as (
    update public.campaigns
       set removed_chars = array_remove(removed_chars, auth.uid()::text || '|' || p_char)
     where id = p_campaign and auth.uid() is not null and (auth.uid()::text || '|' || p_char) = any (removed_chars)
    returning 1
  )
  select exists (select 1 from back);
$$;
revoke all on function public.allow_character_back(uuid, text) from public;
revoke execute on function public.allow_character_back(uuid, text) from anon;
grant execute on function public.allow_character_back(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- Self-confirming: expect removed_chars_column = 1, allow_back_function = 1, blocked_players = 0.
select 'remove-one-character ready' as status,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'campaigns' and column_name = 'removed_chars') as removed_chars_column,
       (select count(*) from pg_proc where proname = 'allow_character_back') as allow_back_function,
       (select count(*) from public.campaigns where removed <> '{}'::uuid[]) as blocked_players;
