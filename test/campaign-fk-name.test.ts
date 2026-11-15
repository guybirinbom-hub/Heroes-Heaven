import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * THE CAMPAIGN KEY'S NAME IS TIED TO THE SQL (2026-10-24, the credits/campaign merge). party.ts says a
 * campaign is "gone" only when the publish error names CAMPAIGN_FK. That name is not written anywhere in
 * supabase-campaign-characters.sql: the `campaign_id … references public.campaigns` key is unnamed, so
 * Postgres gives it the default `<table>_<column>_fkey`. Rename the key (a `constraint x` clause, an
 * `add constraint`, a `rename constraint`) or the column, and every refused publish reads 'failed' forever —
 * the player is never told the campaign is gone, and nothing else would notice. This test refuses that.
 */
const ROOT = join(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

/** The campaign key's name as Postgres will create it from this SQL, or null when it can't tell. */
function campaignKeyName(sql: string): string | null {
  const table = /create table if not exists public\.(campaign_characters)\s*\(([\s\S]*?)\n\);/.exec(sql);
  if (!table) return null;
  const line = table[2].split('\n').find((l) => /references\s+public\.campaigns\s*\(id\)/.test(l));
  if (!line) return null;
  const named = /constraint\s+(\w+)/i.exec(line);
  if (named) return named[1];
  const column = /^\s*(\w+)\s/.exec(line);
  return column ? `${table[1]}_${column[1]}_fkey` : null;
}

function partyKeyName(src: string): string | null {
  return /const CAMPAIGN_FK = '([^']+)'/.exec(src)?.[1] ?? null;
}

describe('the campaign foreign key name', () => {
  it('party.ts CAMPAIGN_FK is the name Postgres gives the SQL key', () => {
    const fromSql = campaignKeyName(read('supabase-campaign-characters.sql'));
    expect(fromSql).toBe('campaign_characters_campaign_id_fkey');
    expect(partyKeyName(read('src/data/party.ts'))).toBe(fromSql);
  });

  it('no SQL file renames or re-adds a campaign_characters key', () => {
    // Every supabase*.sql at the repo root, so a new fix file can't rename the key unseen (checker, 2026-10-24).
    const files = readdirSync(ROOT).filter((f) => /^supabase.*\.sql$/.test(f));
    expect(files).toContain('supabase-campaign-characters.sql');
    for (const f of files) {
      const sql = read(f);
      expect(sql, f).not.toMatch(/rename\s+constraint/i);
      expect(sql, f).not.toMatch(/alter table[^;]*campaign_characters[^;]*add constraint[^;]*foreign key/i);
    }
  });

  it('the reader sees a planted rename (so the first test can fail)', () => {
    const sql = read('supabase-campaign-characters.sql');
    const renamed = sql.replace('campaign_id uuid not null references public.campaigns',
      'campaign_id uuid not null constraint cc_campaign references public.campaigns');
    expect(renamed).not.toBe(sql);
    expect(campaignKeyName(renamed)).toBe('cc_campaign');
    const column = sql.replace(/campaign_id uuid not null references public\.campaigns/, 'campaign uuid not null references public.campaigns');
    expect(campaignKeyName(column)).toBe('campaign_characters_campaign_fkey');
  });
});
