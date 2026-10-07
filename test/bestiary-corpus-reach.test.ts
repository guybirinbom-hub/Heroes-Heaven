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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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

/*
 * D11 (2026-10-07): an OLD name resolves to the remaster the index serves through
 * public/data/bestiary-aliases.json (scripts/bestiary-aliases.mjs, from the Archives' own remaster_id
 * links), never through a legacy index row. A name the mirror links to nothing stays red here, listed
 * with its Archives id, for the owner. Two such names were measured on 2026-10-07: the old index's
 * "Greedspawn Soldiers" and "Trinity Initiates" are the base commit's records creature-4266 and
 * creature-4267 (their _aon.id at 7cfb323), which the Archives have since RENAMED in place to "Greedspawn
 * Soldier" / "Trinity Initiate" — the same documents, carrying no remaster link. The mirror no longer
 * holds the old names, so their ids are pinned here for the failure message.
 * D15 (owner ruling 2026-10-07, "keep a legacy entry for them"): the live pages ?ID=4266 / ?ID=4267 were
 * checked that day — live, no 404, no redirect, printing the singular names — so the old names keep an
 * entry as aliases resolved through the Archives id (scripts/bestiary-aliases.mjs RENAMED_IN_PLACE), not
 * as legacy rows: a legacy row would put the same document in Add Combatants twice, once at the base
 * record's wrong level 0 for Trinity Initiate. (A3) below pins that route.
 */
const MIRROR_FOR_IDS = process.env.HH_AON_MIRROR ?? 'C:/wonderers guide/aon-2e-archive/data';
const PINNED_IDS: Record<string, string> = { 'greedspawn soldiers': 'creature-4266', 'trinity initiates': 'creature-4267' };
let mirrorIds: Map<string, string> | null = null;
function archivesIdOf(name: string): string {
  if (!mirrorIds) {
    mirrorIds = new Map();
    for (const cat of ['creature', 'hazard']) {
      const p = join(MIRROR_FOR_IDS, 'by-category', cat, '_index.json');
      if (!existsSync(p)) continue;
      for (const d of readJson(p) as Array<{ id: string; name: string }>) if (!mirrorIds.has(d.name.toLowerCase())) mirrorIds.set(d.name.toLowerCase(), d.id);
    }
  }
  const k = name.toLowerCase();
  return mirrorIds.get(k) ?? PINNED_IDS[k] ?? 'id unknown';
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
      if (!c) lost.push(`${n.name} (${n.source} L${n.level}, Archives ${archivesIdOf(n.name)})${n.remaster.length ? ` — remastered as ${n.remaster.join(', ')}` : ' — no remaster link in the mirror: an owner finding (D11), never an alias guessed from the name'}`);
    }
    vi.unstubAllGlobals();
    expect(fixture.names.length).toBe(142);
    expect(lost.length, `${lost.length} names a saved encounter table could hold no longer load, e.g.\n  ${lost.slice(0, 12).join('\n  ')}`).toBe(0);
  }, 120_000);
});

describe('(A2) the legacy → remaster alias file (D11)', () => {
  const aliases = readJson(join(DATA, 'bestiary-aliases.json')) as Record<string, string>;
  const rowNames = new Set(index.map((r) => r.name.toLowerCase()));
  it('every alias names an index row, and no alias shadows a name the index holds itself', () => {
    const entries = Object.entries(aliases);
    expect(entries.length).toBeGreaterThan(100);
    expect(entries.filter(([, v]) => !rowNames.has(v.toLowerCase())).map(([k, v]) => `${k} → ${v}`)).toEqual([]);
    expect(entries.filter(([k]) => rowNames.has(k.toLowerCase())).map(([k]) => k)).toEqual([]);
  });
  it('an old name opens its remaster, and a name with no alias still opens nothing', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const p = join(DATA, String(url).replace(/^\/data\//, ''));
      if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
      const body = readFileSync(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    });
    const { findBestiaryEntry } = await import('../tracker/src/data/dataStore');
    expect((await findBestiaryEntry('Troll'))?.name).toBe(aliases.Troll);
    expect((await findBestiaryEntry('troll'))?.name).toBe(aliases.Troll);
    expect(await findBestiaryEntry('Synthetic Name Nobody Printed')).toBeNull();
    vi.unstubAllGlobals();
  });
  it.skipIf(!existsSync(join(process.env.HH_AON_MIRROR ?? 'C:/wonderers guide/aon-2e-archive/data', 'by-category/creature/_index.json')))(
    'the shipped file is what scripts/bestiary-aliases.mjs builds from the mirror (--check)', () => {
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts/bestiary-aliases.mjs'), '--check'], { encoding: 'utf8' });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    }, 120_000);
});

/*
 * (A3) D15: pages the Archives renamed in place. Each test below fails without the fix:
 *   - the first: without the RENAMED_IN_PLACE aliases, findBestiaryEntry('Greedspawn Soldiers') is null;
 *   - the second: the alias must open the record that carries the SAME Archives id the base record had
 *     (creature-4266 / creature-4267), so an alias picked by name similarity to another record fails it;
 *   - the third and fourth: a fixture data dir / mirror missing the id makes the script STOP naming it,
 *     where a script that dropped an unresolvable declared alias silently would exit 0.
 */
const MIRROR_DIR = process.env.HH_AON_MIRROR ?? 'C:/wonderers guide/aon-2e-archive/data';
const HAS_MIRROR = existsSync(join(MIRROR_DIR, 'by-category/creature/_index.json'));
const RENAMED = [
  { old: 'Greedspawn Soldiers', id: 'creature-4266' },
  { old: 'Trinity Initiates', id: 'creature-4267' },
];
const SHARD_219 = 'creatures-pathfinder-219-lord-of-the-trinity-star.json';

describe('(A3) pages renamed in place keep their old name as an entry (D15)', () => {
  it('the old name opens the index row serving the same Archives document', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const p = join(DATA, String(url).replace(/^\/data\//, ''));
      if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
      const body = readFileSync(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    });
    const { findBestiaryEntry, loadCreatureByName } = await import('../tracker/src/data/dataStore');
    for (const { old, id } of RENAMED) {
      const row = await findBestiaryEntry(old);
      expect(row, `${old} opens no index row`).not.toBeNull();
      const rec = records.find(({ file, r }) => file === row!.file && r.name === row!.name && r.level === row!.level);
      expect(rec?.r._aon?.id, `${old} → ${row!.name}`).toBe(id);
      expect((await loadCreatureByName(old.toUpperCase()))?.name).toBe(row!.name);
    }
    vi.unstubAllGlobals();
  });

  it('no legacy-kept shard or legacy row ships for them (the alias route, not D15\'s dropped-page branch)', () => {
    expect(existsSync(join(DATA, 'bestiary/creatures-legacy-kept.json'))).toBe(false);
    expect(existsSync(join(DATA, 'bestiary-legacy-rows.json'))).toBe(false);
    for (const { old } of RENAMED) expect(index.some((r) => r.name.toLowerCase() === old.toLowerCase())).toBe(false);
  });

  /** A data dir holding only the #219 shard, its index rows minus `dropRow`, and an empty hazard file. */
  function fixtureData(dropRow?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'hh-aliases-'));
    mkdirSync(join(dir, 'bestiary'));
    copyFileSync(join(DATA, 'bestiary', SHARD_219), join(dir, 'bestiary', SHARD_219));
    writeFileSync(join(dir, 'hazards.json'), JSON.stringify({ hazard: [] }));
    writeFileSync(join(dir, 'index.json'), JSON.stringify(index.filter((r) => r.file === SHARD_219 && r.name !== dropRow)));
    return dir;
  }
  const run = (extra: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts/bestiary-aliases.mjs'), ...extra], { encoding: 'utf8' });

  it.skipIf(!HAS_MIRROR)('the script resolves them through the id, and STOPS when no row serves that id', () => {
    const ok = fixtureData();
    try {
      const r = run(['--data', ok]);
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      const written = readJson(join(ok, 'bestiary-aliases.json')) as Record<string, string>;
      expect(written['Greedspawn Soldiers']).toBe('Greedspawn Soldier');
      expect(written['Trinity Initiates']).toBe('Trinity Initiate');
    } finally { rmSync(ok, { recursive: true, force: true }); }
    const bad = fixtureData('Greedspawn Soldier');
    try {
      const r = run(['--data', bad]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('creature-4266');
      expect(existsSync(join(bad, 'bestiary-aliases.json'))).toBe(false);
    } finally { rmSync(bad, { recursive: true, force: true }); }
  }, 120_000);

  it.skipIf(!HAS_MIRROR)('the script STOPS when the mirror no longer holds a declared id (a dropped page is D15\'s legacy-kept branch)', () => {
    const mirror = mkdtempSync(join(tmpdir(), 'hh-mirror-'));
    const data = fixtureData();
    try {
      for (const cat of ['creature', 'hazard']) {
        mkdirSync(join(mirror, 'by-category', cat), { recursive: true });
        const list = readJson(join(MIRROR_DIR, 'by-category', cat, '_index.json')) as Array<{ id: string }>;
        writeFileSync(join(mirror, 'by-category', cat, '_index.json'), JSON.stringify(list.filter((d) => d.id !== 'creature-4267')));
      }
      const r = run(['--data', data, '--mirror', mirror]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('creature-4267');
      expect(r.stderr).toContain('legacy-kept');
    } finally {
      rmSync(mirror, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
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
