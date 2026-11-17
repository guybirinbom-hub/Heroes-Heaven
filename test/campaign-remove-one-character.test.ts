import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedChar } from '../src/data/storage';
import type { PartySummary } from '../src/sheet/partySummary';

/*
 * THE GM'S REMOVE TAKES OUT ONE CHARACTER, NEVER THE PLAYER (Guy, 2026-11-17): "when i remvoe a character it
 * removes all taht playerc characters. when he tries to enter with a new character he can kind of enters but i
 * dont see his character in the campign and he gets a error messege ... i removed a character it shouldnt ban the
 * same character or the player in any way."
 *
 * Before: kickFromParty put the PLAYER's account on `campaigns.removed` and deleted every row of that owner; the
 * row rule then refused every character of theirs, a new one included. Now removeCharacterFromCampaign puts only
 * the character id on `removed_chars` and deletes only that row; a refused publish of that character answers
 * 'char-removed' (only its own sends stop); Leave lets it back (allow_character_back).
 */
const server = vi.hoisted(() => ({
  campaign: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  updateError: null as { code?: string; message?: string } | null,
  deletes: [] as [string, string][][],
  upsertError: null as { code?: string; message?: string } | null,
  rpcs: [] as [string, Record<string, unknown>][],
  rpcAnswer: { data: true, error: null } as { data: unknown; error: { message: string } | null },
}));

vi.mock('../src/data/supabase', () => {
  function from(table: string) {
    if (table === 'campaigns') {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => Promise.resolve({ data: server.campaign, error: null }),
        update: (row: Record<string, unknown>) => {
          server.updates.push(row);
          return { eq: () => Promise.resolve({ error: server.updateError }) };
        },
      };
      return q;
    }
    // campaign_characters
    return {
      upsert: () => Promise.resolve({ error: server.upsertError }),
      delete: () => {
        const filters: [string, string][] = [];
        server.deletes.push(filters);
        const d = {
          eq: (col: string, val: string) => {
            filters.push([col, val]);
            return Object.assign(Promise.resolve({ error: null }), d);
          },
        };
        return d;
      },
    };
  }
  return {
    supabase: {
      from,
      rpc: (name: string, args: Record<string, unknown>) => {
        server.rpcs.push([name, args]);
        return Promise.resolve(server.rpcAnswer);
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: 'player-1' } } } }) },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { removeCharacterFromCampaign, allowCharacterBack, publishCharacter, REMOVE_CHARACTER_SCHEMA_MESSAGE } = await import('../src/data/party');
const gone = await import('../src/data/campaignGone');

const RLS = { code: '42501', message: 'new row violates row-level security policy for table "campaign_characters"' };
const publish = (charId: string) => publishCharacter('camp-1', charId, 'TEST Hero', {} as PartySummary, { id: charId } as unknown as SavedChar);

afterEach(() => {
  server.campaign = null;
  server.updates = [];
  server.updateError = null;
  server.deletes = [];
  server.upsertError = null;
  server.rpcs = [];
  server.rpcAnswer = { data: true, error: null };
  gone.clearAllCampaignGone();
});

describe('the GM removes one character', () => {
  it('blocks only that character id and deletes only its row — the player is never put on a list', async () => {
    server.campaign = { id: 'camp-1', removed: [], removed_chars: ['player-9|old-char'] };
    const res = await removeCharacterFromCampaign('camp-1', 'pc-2', 'player-1');
    expect(res.ok).toBe(true);
    // keyed by owner AND character, so only that character's own player can take it off (allow_character_back)
    expect(server.updates).toEqual([{ removed_chars: ['player-9|old-char', 'player-1|pc-2'] }]);
    expect(server.updates.some((u) => 'removed' in u), 'never writes the player-wide list').toBe(false);
    expect(server.deletes).toEqual([[['campaign_id', 'camp-1'], ['char_id', 'pc-2']]]);
    expect(server.deletes.flat().some(([col]) => col === 'owner_id'), 'never deletes by player').toBe(false);
  });

  it('a database without the new column: nothing is changed, and the GM is told which file to run', async () => {
    server.campaign = { id: 'camp-1', removed: [] };
    const res = await removeCharacterFromCampaign('camp-1', 'pc-2', 'player-1');
    expect(res).toEqual({ ok: false, error: REMOVE_CHARACTER_SCHEMA_MESSAGE });
    expect(server.updates).toEqual([]);
    expect(server.deletes).toEqual([]);
  });
});

describe('the player\'s app after a Remove', () => {
  it('the removed character is refused as char-removed; another character of the same player is not', async () => {
    server.upsertError = RLS;
    server.campaign = { id: 'camp-1', removed: [], removed_chars: ['player-1|pc-2', 'player-9|pc-3'] };
    expect(await publish('pc-2')).toBe('char-removed');
    // another player's removed character with the same id is not this player's
    // A refusal that names neither this character nor this player stays unknown and is retried.
    expect(await publish('pc-3')).toBe('failed');
  });

  it('a character mark stops only that character, and goes once it leaves the campaign', () => {
    gone.markCampaignGone(gone.charMarkKey('camp-1', 'pc-2'), 'char-removed');
    expect(gone.campaignGoneReason('camp-1'), 'the campaign itself is not marked').toBeUndefined();
    expect(gone.campaignGoneReason('camp-1|pc-2')).toBe('char-removed');
    // pc-3 still holds the campaign; pc-2 left it.
    gone.keepCampaignGoneFor(new Set(['camp-1', 'camp-1|pc-3']));
    expect(gone.campaignGoneReason('camp-1|pc-2')).toBeUndefined();
  });

  it('Leave lets the character back through the database function, and the app is told to send it again', async () => {
    gone.markCampaignGone(gone.charMarkKey('camp-1', 'pc-2'), 'char-removed');
    const heard: string[] = [];
    const stop = gone.onCharacterLetBack((cid, charId) => heard.push(`${cid}|${charId}`));
    try {
      expect(await allowCharacterBack('camp-1', 'pc-2')).toBe('back');
    } finally {
      stop();
    }
    expect(server.rpcs).toEqual([['allow_character_back', { p_campaign: 'camp-1', p_char: 'pc-2' }]]);
    expect(heard, 'App resends it now, even if unchanged since the Remove').toEqual(['camp-1|pc-2']);
    expect(gone.campaignGoneReason('camp-1|pc-2'), 'its own mark is gone').toBeUndefined();
  });

  it('the database decides: removed but never refused here comes back; never removed changes nothing; a failure is said', async () => {
    const heard: string[] = [];
    const stop = gone.onCharacterLetBack((cid, charId) => heard.push(`${cid}|${charId}`));
    try {
      // The GM removed it while this app was open and the player never edited it: no mark here, the database says true.
      server.rpcAnswer = { data: true, error: null };
      expect(await allowCharacterBack('camp-1', 'pc-2')).toBe('back');
      // Not on the list: nothing happens, nothing is sent again.
      server.rpcAnswer = { data: false, error: null };
      expect(await allowCharacterBack('camp-1', 'pc-3')).toBe('not-removed');
      // Offline, or the database file was not run: 'failed', so the join can say so.
      server.rpcAnswer = { data: null, error: { message: 'Could not find the function' } };
      expect(await allowCharacterBack('camp-1', 'pc-4')).toBe('failed');
    } finally {
      stop();
    }
    expect(heard).toEqual(['camp-1|pc-2']);
  });
});

describe('the wiring and the database rules', () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

  it('the row rules block one character, and nothing checks the player-wide list any more', () => {
    const remove = src('supabase-campaign-remove-character.sql');
    expect(remove).toMatch(/\(owner_id::text \|\| '\|' \|\| char_id\) = any \(coalesce\(\(select removed_chars from public\.campaigns/);
    // only the caller's own "<id>|<character>" entry can be taken off
    expect(remove).toMatch(/array_remove\(removed_chars, auth\.uid\(\)::text \|\| '\|' \|\| p_char\)/);
    expect(remove).toMatch(/drop function if exists public\.allow_character_back\(uuid, text\);\s+create function public\.allow_character_back\(p_campaign uuid, p_char text\)\s+returns boolean/);
    // the column (the app's "was the file run?" test) comes ONLY from the remove-character file
    expect(src('supabase-campaign-characters.sql')).not.toMatch(/add column if not exists removed_chars/);
    expect(remove).toMatch(/add column if not exists removed_chars/);
    // an older app's player-wide Remove is REFUSED (it deletes every character only after that write succeeds)
    expect(remove).toMatch(/if coalesce\(array_length\(new\.removed, 1\), 0\) > 0 then\s+raise exception/);
    expect(remove).not.toMatch(/new\.removed := /);
    // No rule in ANY database file blocks a player by the old kick list (the homebrew read rule did, a checker
    // found 2026-11-17): a player-wide test is `auth.uid() = any (... removed ...)` in any form.
    const sqlFiles = readdirSync(new URL('../', import.meta.url)).filter((f) => /^supabase-.*\.sql$/.test(f) && !f.endsWith('-rollback.sql'));
    expect(sqlFiles.length).toBeGreaterThan(5);
    for (const file of sqlFiles) {
      const text = src(file).replace(/--.*$/gm, '');
      expect(text, file).not.toMatch(/auth\.uid\(\)\s*=\s*any\s*\([^;]*\bremoved\b(?!_chars)/);
    }
    // Every file that sets the owner's write rule sets the one-character block too, so a re-run never drops it.
    for (const file of sqlFiles) {
      const text = src(file);
      if (/create policy cc_owner_write/.test(text)) expect(text, file).toMatch(/\(owner_id::text \|\| '\|' \|\| char_id\) = any \(coalesce\(\(select removed_chars/);
    }
    // The old list is emptied, and the homebrew read rule is reset.
    expect(remove).toMatch(/update public\.campaigns set removed = '\{\}'::uuid\[\]/);
    expect(remove).toMatch(/create policy chb_member_read/);
    expect(remove).toMatch(/revoke execute on function public\.allow_character_back\(uuid, text\) from anon/);
  });

  it('entering the campaign code lets a removed character back', () => {
    const shared = src('src/builder/shared.tsx');
    expect(shared).toMatch(/return allowCharacterBack\(cid, charId\)/);
    expect(shared).toMatch(/void letBack\(c\.id\)/);
    // asked ONCE; when it came back, no "already in" error
    // asked even when the code lookup failed (offline → 'failed' → the connection error, never "already in")
    expect(shared).toMatch(/const back = await letBack\(id\);\s+if \(back === 'failed'/);
    expect(shared).not.toMatch(/res\.ok \? await letBack/);
    expect(shared.match(/letBack\(id\)/g)?.length, 'one call in the already-holds-it branch').toBe(1);
    // 'back' returns only AFTER the account's membership is put back, and BEFORE the "already in" error
    const branch = shared.slice(shared.indexOf('const back = await letBack(id)'), shared.indexOf('is already in “'));
    expect(branch.indexOf("if (back === 'back')")).toBeGreaterThan(branch.indexOf('!list.some((m) => m.id === id)'));
    expect(src('src/sheet/PartyMembers.tsx')).toMatch(/newest version of the app/);
  });

  it('App stops only the removed character, prunes by pair, and lets it back on Leave', () => {
    const app = src('src/App.tsx');
    expect(app).toMatch(/campaignGoneReason\(cid\) \|\| campaignGoneReason\(key\)/);
    expect(app).toMatch(/markCampaignGone\(key, 'char-removed'\)/);
    expect(app).toMatch(/flatMap\(\(cid\) => \[cid, cid \+ '\|' \+ sc\.id\]\)/);
    expect(app).toMatch(/void allowCharacterBack\(campaignId, charId\)/);
    expect(src('src/sheet/PartyMembers.tsx')).toMatch(/removeCharacterFromCampaign\(campaignId, m\.charId, m\.ownerId\)/);
    expect(app).toMatch(/onCharacterLetBack\(\(cid, charId\) => \{\s+sentJsonRef\.current\.delete\(cid \+ '\|' \+ charId\);\s+setPublishNonce/);
    expect(src('src/data/party.ts')).not.toMatch(/export async function kickFromParty/);
  });
});
