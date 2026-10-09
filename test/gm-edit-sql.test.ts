import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * F1 (2026-10-09) — THE TWO COLUMNS THE GM-EDIT CHANNEL STANDS ON, held to the SQL the owner runs.
 *
 * The player's app refuses a GM edit unless its row carries `gm_base`, and the GM's app shows "not
 * applied" from `campaign_characters.gm_refused_at`. Both exist only once supabase-campaign-characters.sql
 * has been re-run, so the file itself is guarded: drop either line and a database built from it can
 * never apply a GM edit again (every row refused, or every push refused for the missing column). No
 * server logic: the comparison is content, in the app (src/data/authored.ts) — so no trigger and no
 * function either, and none may creep back in without a test changing.
 *
 * MUTATION (run 2026-10-09): delete the `gm_base jsonb` line from supabase-campaign-characters.sql — and
 * this fails —
 *   AssertionError: the base a push carries: expected '-- Heroes Heaven — Campaign party (sh…' to contain 'add column if not exists gm_base jsonb'
 * MUTATION (run 2026-10-09): drop the `gm_base: { v: 1, … }` line from pushGmEdit's upsert in
 * src/data/party.ts — and this fails —
 *   AssertionError: every push writes its base: expected false to be true
 */
const sql = readFileSync('supabase-campaign-characters.sql', 'utf8');
const party = readFileSync('src/data/party.ts', 'utf8');

describe('supabase-campaign-characters.sql carries the F1 columns', () => {
  it('adds both columns, idempotently, and drops nothing', () => {
    expect(sql, 'the base a push carries').toContain('add column if not exists gm_base jsonb');
    expect(sql, 'the player app’s refusal receipt').toContain('add column if not exists gm_refused_at timestamptz');
    expect(sql, 'the status line shows they landed').toContain('as f1_columns');
    expect(/drop\s+column/i.test(sql), 'a re-run must never drop data').toBe(false);
    expect(/create\s+(or\s+replace\s+)?trigger|create\s+(or\s+replace\s+)?function/i.test(sql), 'no server logic: the app compares content').toBe(false);
  });

  it('the party layer writes and reads them', () => {
    expect(/gm_base:\s*\{\s*v:\s*1/.test(party), 'every push writes its base').toBe(true);
    expect(party, 'the player reads the base with the row').toContain("'campaign_id,char_id,sheet,updated_at,gm_base'");
    expect(party, 'a seeded edit is proved by its base').toContain("'gm_base',");
    expect(party, 'the GM reads the receipt').toContain("'gm_refused_at',");
    expect(party, 'the player writes the receipt').toContain('update({ gm_refused_at: rowUpdatedAt })');
  });
});
