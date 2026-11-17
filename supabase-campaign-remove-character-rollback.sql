-- Heroes Heaven — ROLLBACK of supabase-campaign-remove-character.sql (2026-11-17).
-- Only if the one-character Remove must be undone. It puts back the OLD rules, where a GM's Remove blocked the
-- whole player (the bug that file fixed). The removed_chars list itself is kept: no rule reads it after this,
-- so a GM on the new app who presses Remove only deletes that character's shared copy, and it comes back on the
-- player's next send.

drop trigger if exists campaigns_never_block_players on public.campaigns;
drop function if exists public.campaigns_never_block_players();
drop function if exists public.allow_character_back(uuid, text);

drop policy if exists cc_owner_write on public.campaign_characters;
create policy cc_owner_write on public.campaign_characters
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and not (auth.uid() = any (coalesce((select removed from public.campaigns c where c.id = campaign_id), '{}'::uuid[])))
  );

do $$
begin
  if to_regclass('public.campaign_homebrew') is not null then
    drop policy if exists chb_member_read on public.campaign_homebrew;
    create policy chb_member_read on public.campaign_homebrew
      for select to authenticated
      using (exists (select 1 from public.campaigns c where c.id = campaign_id
                       and not (auth.uid() = any (coalesce(c.removed, '{}'::uuid[])))));
  end if;
end $$;

notify pgrst, 'reload schema';
select 'remove-one-character rolled back' as status;
