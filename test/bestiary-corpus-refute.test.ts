/*
 * Refute pass on the bestiary corpus import (2026-10-06). Each block is a finding that held, kept as a
 * guard so it cannot come back. Read with test/bestiary-corpus-import.test.ts (the builder's own proof).
 *
 * (1) THE LOADER SERVES THE PRINTING THE INDEX NAMES. The index picks one printing per name (remaster
 *     link first, then source priority — ruling R12), but tracker/src/data/dataStore.ts loadCreature
 *     finds a hazard by NAME ALONE (`data.hazard.find(h => h.name === entry.name)`) in the one
 *     hazards.json that keeps every printing. Where two printings share a name the first in the file
 *     loads, whatever the row said. Measured: 94 hazard rows share a name with another hazard; at HEAD
 *     (old builder) 34 of them loaded the wrong printing, after the corpus import 90 do (the corpus
 *     orders hazards by Archives id, legacy first): "Armageddon Orb" (GM Core) opens the Core Rulebook
 *     page, "Collapsing Bridge" (Claws of the Tyrant, level 16) opens a level-15 hazard from #184.
 *     This block runs the REAL loader over every index row, so it goes green by either fix (the loader
 *     matching the printing, or the data ordered so the indexed printing comes first) and red again if
 *     either regresses.
 * (2) bestiary-fields-check mutations the builder's test did not cover: a missing file, flavor and
 *     records below floor, the loader-shape rules added in this pass (isHazard <-> file, the row's name
 *     in its file, index.json an array, a shard without a `creature` array), a family whose entry has
 *     no text (the tracker drops it), a pin with a wrong hazard count.
 * (3) The shipped files equal the corpus at the pinned commit, byte for byte (run when the corpus
 *     checkout is beside the lane at that commit; skipped otherwise).
 * (4) Index rows carry every field the loader and Add Combatants read, with the right types.
 * (5) Nothing in scripts/, test/ or package.json runs the three retired builder files.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check } from '../scripts/bestiary-fields-check.mjs';

/* The loader is under test, not the parser (another lane is rewriting parseCreature.ts): the parse is
 * the identity, so loadCreature hands back the raw record it picked. */
vi.mock('../tracker/src/utils/parseCreature', () => ({
  parseCreature: (raw: unknown) => raw,
  parseHazard: (raw: unknown) => raw,
}));

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'public/data');
const HAZARD_FILE = '../hazards.json';
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
type Row = { name: string; level: number; source: string; file: string; isHazard?: boolean } & Record<string, unknown>;
const index: Row[] = readJson(join(DATA, 'index.json'));
const noPage = (s: unknown) => String(s ?? '').replace(/\s*pg\.\s*\d+.*$/, '').trim();

describe('(1) every index row loads the printing it names, through the real tracker loader', () => {
  it('loadCreature returns the record whose level and source are the row\'s', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const rel = String(url).replace(/^\/data\//, '');
      const p = join(DATA, rel);
      if (!existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
      const body = readFileSync(p, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    });
    const { loadCreature } = await import('../tracker/src/data/dataStore');
    const wrong: string[] = [];
    const failed: string[] = [];
    for (const r of index) {
      let got: { level?: number; source?: string } | null = null;
      try { got = (await loadCreature(r as never)) as unknown as { level?: number; source?: string }; } catch (e) { failed.push(`${r.file}: ${r.name}: ${(e as Error).message}`); continue; }
      if (got?.level !== r.level || noPage(got?.source) !== noPage(r.source)) {
        wrong.push(`${r.isHazard ? 'hazard' : r.file}: ${r.name} — row L${r.level} ${noPage(r.source)}, loaded L${got?.level} ${noPage(got?.source)}`);
      }
    }
    vi.unstubAllGlobals();
    expect(failed).toEqual([]);
    expect(wrong.length, `${wrong.length} index rows open a different printing than the one the row names, e.g.\n  ${wrong.slice(0, 8).join('\n  ')}`).toBe(0);
  }, 120_000);
});

/* ---- (2) check() mutation fixtures ---- */
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const put = (dir: string, file: string, v: unknown) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), typeof v === 'string' ? v : JSON.stringify(v));
};
const TINY = { records: 1, flavor: 1, family: 1, rituals: 1, families: 1 };
const creature = (name: string, extra: Record<string, unknown> = {}) => ({
  name, level: 1, source: 'Fixture', family: 'Demon', flavor: 'A fixture creature.', rituals: [{ name: 'r' }],
  abilities: { top: [], mid: [], bot: [] }, defenses: { hp: [{ hp: 10 }] }, ...extra,
});
type Mut = {
  shard?: unknown; index?: unknown; families?: unknown; hazards?: unknown; pinHazards?: number;
};
function fixture(m: Mut = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hh-bestiary-refute-'));
  roots.push(dir);
  put(dir, 'public/data/bestiary/creatures-a.json', m.shard ?? { creature: [creature('Alpha')] });
  put(dir, 'public/data/hazards.json', m.hazards ?? { hazard: [{ name: 'Pit', level: 0, description: ['A pit.'] }] });
  const rows = (m.index as unknown[]) ?? [
    { name: 'Alpha', level: 1, file: 'creatures-a.json' },
    { name: 'Pit', level: 0, file: HAZARD_FILE, isHazard: true },
  ];
  put(dir, 'public/data/index.json', rows);
  put(dir, 'public/data/creature-families.json', m.families ?? { demon: { name: 'Demon', text: 'Demons.' } });
  const arr = Array.isArray(rows) ? rows as Row[] : [];
  put(dir, 'scripts/data/bestiary-corpus-pin.json', {
    repo: 'https://github.com/guybirinbom-hub/hh-bestiary-corpus', commit: '0'.repeat(40), fetchedAt: 'fixture',
    counts: {
      creatures: 1, hazards: m.pinHazards ?? 1, shards: 1,
      indexRows: arr.length, indexHazardRows: arr.filter((r) => r.file === HAZARD_FILE).length,
    },
    skippedShards: [],
  });
  return dir;
}
const errs = (r: { lines: Array<{ err: boolean; text: string }> }) => r.lines.filter((l) => l.err).map((l) => l.text).join('\n');
const all = (r: { lines: Array<{ text: string }> }) => r.lines.map((l) => l.text).join('\n');

/* Each case writes a temp dir; under the vt lock's neighbours one took >5 s and failed with no finding. */
describe('(2) bestiary-fields-check goes red on each mutation', { timeout: 60_000 }, () => {
  it('the clean fixture is green (so each red below is the mutation, not the fixture)', () => {
    const r = check(fixture(), { floors: TINY });
    expect(errs(r)).toBe('');
    expect(r.bad).toBe(0);
  });

  it('an index row naming a shard that does not exist', () => {
    const r = check(fixture({ index: [
      { name: 'Alpha', level: 1, file: 'creatures-a.json' },
      { name: 'Ghost', level: 1, file: 'creatures-gone.json' },
      { name: 'Pit', level: 0, file: HAZARD_FILE, isHazard: true },
    ] }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/index names 1 file\(s\) that do not exist: creatures-gone\.json/);
  });

  it('flavor below its floor', () => {
    const r = check(fixture({ shard: { creature: [creature('Alpha', { flavor: undefined })] } }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(all(r)).toMatch(/flavor\s+0\s+floor\s+1\s+BELOW FLOOR/);
  });

  it('records below their floor (the real floors on a one-creature dir)', () => {
    const r = check(fixture());
    expect(r.bad).toBeGreaterThan(0);
    expect(all(r)).toMatch(/records\s+1\s+floor\s+4600\s+BELOW FLOOR/);
  });

  it('a hazard row without isHazard (the loader would fetch bestiary/../hazards.json and read .creature)', () => {
    const r = check(fixture({ index: [
      { name: 'Alpha', level: 1, file: 'creatures-a.json' },
      { name: 'Pit', level: 0, file: HAZARD_FILE },
    ] }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/1 index row\(s\) whose isHazard does not match their file: Pit/);
  });

  it('isHazard on a creature row (the loader would look it up in hazards.json)', () => {
    const r = check(fixture({ index: [
      { name: 'Alpha', level: 1, file: 'creatures-a.json', isHazard: true },
      { name: 'Pit', level: 0, file: HAZARD_FILE, isHazard: true },
    ] }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/whose isHazard does not match their file: Alpha/);
  });

  it('a creature row whose name is not in its shard', () => {
    const r = check(fixture({ index: [
      { name: 'Alpha', level: 1, file: 'creatures-a.json' },
      { name: 'Beta', level: 1, file: 'creatures-a.json' },
      { name: 'Pit', level: 0, file: HAZARD_FILE, isHazard: true },
    ] }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/1 index row\(s\) name a record their file does not hold: creatures-a\.json: Beta/);
  });

  it('a hazard row whose name is not in hazards.json', () => {
    const r = check(fixture({ index: [
      { name: 'Alpha', level: 1, file: 'creatures-a.json' },
      { name: 'Pit', level: 0, file: HAZARD_FILE, isHazard: true },
      { name: 'Spike', level: 0, file: HAZARD_FILE, isHazard: true },
    ] }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/name a record their file does not hold: hazards\.json: Spike/);
  });

  it('index.json that is an object wrapping the rows (the tracker reads the array itself)', () => {
    const r = check(fixture({ index: { rows: [
      { name: 'Alpha', level: 1, file: 'creatures-a.json' },
      { name: 'Pit', level: 0, file: HAZARD_FILE, isHazard: true },
    ] } }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/index\.json is not an array/);
  });

  it('a shard with no "creature" array', () => {
    const r = check(fixture({ shard: { creatures: [creature('Alpha')] } }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/creatures-a\.json has no "creature" array/);
  });

  it('a family whose creature-families entry has no text joins nothing (loadFamilies drops it)', () => {
    const r = check(fixture({ families: { demon: { name: 'Demon' }, other: { name: 'Other', text: 'x' } } }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(all(r)).toMatch(/family join rate\s+0\.0000.*BELOW FLOOR/);
  });

  it('a pin whose hazard count is off', () => {
    const r = check(fixture({ pinHazards: 2 }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(errs(r)).toMatch(/hazards: pin 2, shipped 1/);
  });
});

/* ---- (3) byte equality with the corpus at the pinned commit ---- */
const CORPUS = join(ROOT, '..', 'hh-bestiary-corpus');
const pin = readJson(join(ROOT, 'scripts/data/bestiary-corpus-pin.json'));
const corpusHead = (() => {
  try { return execFileSync('git', ['-C', CORPUS, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
})();

describe('(3) the shipped files are the corpus at the pinned commit', () => {
  it.skipIf(corpusHead !== pin.commit)('every shipped shard, hazards.json and index.json equal the corpus bytes; the skipped shards are exactly coverage.orphanShards', () => {
    const shipped = readdirSync(join(DATA, 'bestiary')).filter((f) => f.endsWith('.json'));
    const differ = shipped.filter((f) => !readFileSync(join(DATA, 'bestiary', f)).equals(readFileSync(join(CORPUS, 'data/bestiary', f))));
    expect(differ).toEqual([]);
    expect(readFileSync(join(DATA, 'hazards.json')).equals(readFileSync(join(CORPUS, 'data/hazards.json')))).toBe(true);
    expect(readFileSync(join(DATA, 'index.json')).equals(readFileSync(join(CORPUS, 'data/index.json')))).toBe(true);
    const corpusShards = readdirSync(join(CORPUS, 'data/bestiary')).filter((f) => f.endsWith('.json'));
    const orphans = (readJson(join(CORPUS, 'report/coverage.json')).orphanShards as Array<{ file: string }>).map((o) => o.file).sort();
    expect(corpusShards.filter((f) => !shipped.includes(f)).sort()).toEqual(orphans);
    expect((pin.skippedShards as Array<{ file: string }>).map((s) => s.file).sort()).toEqual(orphans);
  });
});

/* ---- (4) index row fields ---- */
describe('(4) every index row carries the fields the loader and Add Combatants read', () => {
  const ARR = ['traits', 'immunities', 'weaknesses', 'resistances', 'speedTypes', 'traditions', 'spellTypes'];
  const NUM = ['level', 'maxSpeed', 'spellDC', 'spellLvl'];
  const STR = ['name', 'source', 'file'];
  it('names, numbers and lists with the right types; isNpc on every creature row', () => {
    const bad: string[] = [];
    for (const r of index) {
      for (const k of ARR) if (!Array.isArray(r[k])) bad.push(`${r.name}: ${k}`);
      for (const k of NUM) if (typeof r[k] !== 'number') bad.push(`${r.name}: ${k}`);
      for (const k of STR) if (typeof r[k] !== 'string' || !r[k]) bad.push(`${r.name}: ${k}`);
      if (!r.isHazard && typeof r.isNpc !== 'boolean') bad.push(`${r.name}: isNpc`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

/* ---- (5) the retired builder is gone and nothing runs it ---- */
describe('(5) no script, test or package.json entry references the retired builder', () => {
  const RETIRED = ['build-bestiary.mjs', 'creature-markdown.mjs', 'check-creature-parse.mjs'];
  it('the three files do not exist', () => {
    for (const f of ['scripts/build-bestiary.mjs', 'scripts/lib/creature-markdown.mjs', 'scripts/check-creature-parse.mjs']) {
      expect(existsSync(join(ROOT, f)), f).toBe(false);
    }
  });
  it('no reference outside the importer\'s history note', () => {
    const SELF = new Set(['bestiary-corpus-refute.test.ts']);
    const HISTORY = new Set(['import-bestiary-corpus.mjs']);
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (d.name === 'node_modules' ? [] : walk(join(dir, d.name)))
        : /\.(m?[jt]sx?|json)$/.test(d.name) ? [join(dir, d.name)] : []);
    const files = [...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'test')), join(ROOT, 'package.json'), join(ROOT, 'tracker/package.json')]
      .filter((p) => existsSync(p) && !SELF.has(p.split(/[\\/]/).pop()!) && !HISTORY.has(p.split(/[\\/]/).pop()!));
    const hits: string[] = [];
    for (const p of files) {
      const t = readFileSync(p, 'utf8');
      for (const r of RETIRED) if (t.includes(r)) hits.push(`${p.slice(ROOT.length + 1)}: ${r}`);
    }
    expect(hits).toEqual([]);
    /* Walking scripts/ (raw Archives caches included) took 24.7 s on a loaded machine, and the default
     * 5 s limit failed this test with no finding (second refute pass, 2026-10-06). */
  }, 180_000);
});
