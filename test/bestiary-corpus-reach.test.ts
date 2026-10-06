/*
 * Second refute pass on the bestiary corpus import (2026-10-06): what the GM can still REACH.
 * Read with test/bestiary-corpus-import.test.ts (the builder's proof) and test/bestiary-corpus-refute.test.ts
 * (the first refute pass: the printing each row loads, check() mutations, byte equality, row fields).
 *
 * (A) EVERY NAME THE OLD INDEX OFFERED STILL LOADS BY NAME. Saved encounter tables keep only a creature's
 *     NAME and load it at roll time (tracker/src/store/encounterTablesStore.ts -> RandomEncounterWidget ->
 *     dataStore loadCreatureByName); portable encounter files resolve combatants by name
 *     (utils/encounterTransfer.ts resolveCreature); prose "creature" links open by name. The corpus index
 *     keeps one row per name and DROPS a legacy page whenever the Archives link a remaster to it, even when
 *     the remaster is a different creature with a different name. The old index (HEAD 7cfb323) offered
 *     142 names the new one does not (case-insensitive): every Bestiary chromatic and metallic dragon,
 *     the golems, mephits, Ghoul, Troll, Minotaur, Gelatinous Cube, Unseen Servant… Measured through the
 *     real loader: all 142 now return null ("Couldn't load a stat block for …" on a saved table), and the
 *     classic creatures are gone from Add Combatants. The frozen list, with the indexed remaster each
 *     page links to, is test/fixtures/bestiary-legacy-names-2026-10-06.json.
 *     Ruling R12 desk #158 (docs/gold-set-answers.md): a reprint that ships as its own record is NOT
 *     merged — keep both, mark the old one legacy so "hide legacy" hides it, "never an always-hide".
 *     Goes green by either fix (legacy rows back in the index, marked; or a name alias to the remaster).
 * (B) EVERY SHIPPED RECORD HAS A ROUTE: its own index row, a row of the same name, or a remaster link
 *     (the Archives' own legacy-remaster index) to an indexed record. Measured: 0 without one. Needs the
 *     owner's Archives mirror; skipped where it is not on this machine.
 * (C) SAME NAME, DIFFERENT CREATURE. A record whose name another row holds at a DIFFERENT level is a
 *     different stat block that has no route at all (the loader finds by name, first match): Gurglegut
 *     level 12 sits in the same Season of Ghosts shard as the indexed level-3 Gurglegut. Same as at HEAD
 *     (the old index was one row per name too), so this pins the known set and fails if it grows.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../tracker/src/utils/parseCreature', () => ({
  parseCreature: (raw: unknown) => raw,
  parseHazard: (raw: unknown) => raw,
}));

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'public/data');
const HAZARD_FILE = '../hazards.json';
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
type Rec = { name: string; level: number; source?: string; _aon?: { id?: string } };
type Row = { name: string; level: number; source: string; file: string; isHazard?: boolean };
const index: Row[] = readJson(join(DATA, 'index.json'));
const records: Array<{ file: string; r: Rec }> = [];
for (const f of readdirSync(join(DATA, 'bestiary')).filter((x) => x.endsWith('.json'))) {
  for (const r of readJson(join(DATA, 'bestiary', f)).creature as Rec[]) records.push({ file: f, r });
}
for (const r of readJson(join(DATA, 'hazards.json')).hazard as Rec[]) records.push({ file: HAZARD_FILE, r });
const noPage = (s: unknown) => String(s ?? '').replace(/\s*pg\.\s*\d+.*$/, '').trim();
/** The record each index row names: same file, name, level and book. */
const indexedIds = new Set<string>();
for (const row of index) {
  const hit = records.find(({ file, r }) => file === row.file && r.name === row.name && r.level === row.level && noPage(r.source) === noPage(row.source));
  if (hit?.r._aon?.id) indexedIds.add(hit.r._aon.id);
}

describe('(A) every name the old index offered still loads by name', () => {
  const fixture = readJson(join(ROOT, 'test/fixtures/bestiary-legacy-names-2026-10-06.json')) as {
    names: Array<{ name: string; source: string; level: number; hazard: boolean; remaster: string[] }>;
  };
  it('loadCreatureByName (saved encounter tables, encounter files, prose links) finds a stat block for each', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const p = join(DATA, String(url).replace(/^\/data\//, ''));
      if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
      const body = readFileSync(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    });
    const { loadCreatureByName } = await import('../tracker/src/data/dataStore');
    const lost: string[] = [];
    for (const n of fixture.names) {
      const c = await loadCreatureByName(n.name);
      if (!c) lost.push(`${n.name} (${n.source} L${n.level})${n.remaster.length ? ` — remastered as ${n.remaster.join(', ')}` : ''}`);
    }
    vi.unstubAllGlobals();
    expect(fixture.names.length).toBe(142);
    expect(lost.length, `${lost.length} names a saved encounter table could hold no longer load, e.g.\n  ${lost.slice(0, 12).join('\n  ')}`).toBe(0);
  }, 120_000);
});

const MIRROR = process.env.HH_AON_MIRROR ?? 'C:/wonderers guide/aon-2e-archive/data';
const LR_PATH = join(MIRROR, 'index/legacy-remaster.json');

describe('(B) every shipped record has a route from Add Combatants', () => {
  it.skipIf(!existsSync(LR_PATH))('own row, a same-name row, or a remaster link to an indexed record', () => {
    const lr = readJson(LR_PATH) as Record<string, { remaster_id?: string[] | null }>;
    const rowNames = new Set(index.map((r) => r.name));
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      if (indexedIds.has(id)) return true;
      return (lr[id]?.remaster_id ?? []).some((x) => reaches(x, seen));
    };
    const noRoute: string[] = [];
    for (const { file, r } of records) {
      const id = r._aon?.id ?? '';
      if (indexedIds.has(id) || rowNames.has(r.name)) continue;
      if ((lr[id]?.remaster_id ?? []).some((x) => reaches(x))) continue;
      noRoute.push(`${file}: ${r.name} (${r.source} L${r.level}, ${id})`);
    }
    expect(noRoute).toEqual([]);
  }, 120_000);
});

describe('(C) same name, different creature: the known unreachable set does not grow', () => {
  /* Measured 2026-10-06 on corpus f617090: an unindexed record whose name an index row holds at another
   * level. Pre-existing (the old index was one row per name too); listed so a new one is a decision. */
  const KNOWN = new Set([
    'Vrolikai|Bestiary 2|19', 'Adlet|Bestiary 3|10', 'Worm Prophet|Night of the Gray Death|18',
    'Almiraj|Pathfinder #157: Devil at the Dreaming Palace|1', 'Gurglegut|Season of Ghosts (Hardcover)|12',
    "Vidileth|The Dead God's Hand|6", 'Summoning Rune|Pathfinder #181: Zombie Feast|3',
    'Glyph of Warding|Pathfinder #184: The Ghouls Hunger|14', 'Collapsing Bridge|Pathfinder #184: The Ghouls Hunger|15',
    'Collapsing Bridge|Kingmaker Companion Guide|6', 'Summoning Rune|Pathfinder #157: Devil at the Dreaming Palace|5',
    'Cave-In|Pathfinder #195: Heavy is the Crown|8',
  ]);
  it('no record outside the known list is shadowed by a same-name row at another level', () => {
    const rowByName = new Map(index.map((r) => [r.name, r]));
    const shadowed = new Set<string>();
    for (const { r } of records) {
      if (indexedIds.has(r._aon?.id ?? '')) continue;
      const row = rowByName.get(r.name);
      if (row && row.level !== r.level) shadowed.add(`${r.name}|${noPage(r.source)}|${r.level}`);
    }
    expect([...shadowed].filter((k) => !KNOWN.has(k)).sort()).toEqual([]);
  });
});
