// @vitest-environment jsdom
/*
 * REFUTE ROUND 2, REGRESSION LENS — the verified-bestiary index, walked through the PORTABLE
 * ENCOUNTER FILE (tracker/src/utils/encounterTransfer.ts importEncountersFromText → resolveCreature).
 *
 * An exported encounter keeps each combatant's creatureName and is resolved on import by an exact
 * lower-cased name lookup in its OWN map built from loadIndex() — not through dataStore
 * loadCreatureByName. The old index (base 7cfb323) offered 142 names the new one does not
 * (test/fixtures/bestiary-legacy-names-2026-10-06.json: the Bestiary dragons, golems, Troll, Ghoul…),
 * so an encounter file exported before the update that names one of them now imports it as a
 * name-only row with no stat block. D11 adds the legacy → remaster alias to loadCreatureByName only;
 * this test turns green only when the alias also reaches the encounter import.
 * Read with test/bestiary-corpus-reach.test.ts (A), which pins loadCreatureByName.
 * D15 (2026-10-07): the last two reds, "Greedspawn Soldiers" and "Trinity Initiates" (Archives pages
 * renamed in place to the singular), now resolve through scripts/bestiary-aliases.mjs RENAMED_IN_PLACE;
 * with the alias file from before D15 this test fails on exactly those two names (measured).
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../tracker/src/utils/parseCreature', () => ({
  parseCreature: (raw: unknown) => raw,
  parseHazard: (raw: unknown) => raw,
}));

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'public/data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('a portable encounter file from before the update still finds its bestiary creatures', () => {
  const fixture = readJson(join(ROOT, 'test/fixtures/bestiary-legacy-names-2026-10-06.json')) as {
    names: Array<{ name: string; source: string; level: number; hazard: boolean; remaster: string[] }>;
  };

  it('every one of the 142 legacy names resolves to a stat block on import (none listed as missing)', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const p = join(DATA, String(url).replace(/^\/data\//, ''));
      if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
      const body = readFileSync(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    });
    localStorage.clear();
    const { importEncountersFromText } = await import('../tracker/src/utils/encounterTransfer');
    const file = {
      version: 1, exportedAt: '2026-09-01T00:00:00.000Z',
      encounters: [{
        name: 'Synthetic legacy fight', savedAt: '2026-09-01T00:00:00.000Z',
        combatants: fixture.names.map((n) => ({
          name: n.name, creatureName: n.name, creatureSource: n.source, isPC: false, maxHP: 10,
          isElite: false, isWeak: false, notes: '',
        })),
      }],
    };
    const r = await importEncountersFromText(JSON.stringify(file));
    vi.unstubAllGlobals();
    expect(r.ok).toBe(true);
    expect(fixture.names.length).toBe(142);
    const missing = r.missing.map((m) => m.creature);
    expect(missing.length, `${missing.length} creatures of an old encounter file import with no stat block, e.g.\n  ${missing.slice(0, 12).join('\n  ')}`).toBe(0);
  }, 120_000);
});
