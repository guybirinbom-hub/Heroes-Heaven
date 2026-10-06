/*
 * The bestiary ships from the verified bestiary corpus (scripts/import-bestiary-corpus.mjs), pinned by
 * scripts/data/bestiary-corpus-pin.json, and guarded by scripts/bestiary-fields-check.mjs (in
 * `npm run verify`).
 *
 * (a)–(c) read the SHIPPED files directly — not through the check — so a bug in the check cannot hide a
 * bad import. (d) is the mutation proof: the check is run on tiny fixture data dirs and must go red for
 * an unnamed shard, a pin whose counts are off, a missing pin, a skipped shard that ships and a family
 * that joins nothing — and green for a correct fixture. The importer's refusals are proven the same way.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check } from '../scripts/bestiary-fields-check.mjs';

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'public/data');
const BESTIARY = join(DATA, 'bestiary');
const HAZARD_FILE = '../hazards.json';
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

type Creature = { name: string; abilities?: unknown; defenses?: { hp?: unknown } };
type Hazard = { name: string; description?: unknown[] };

const shardFiles = readdirSync(BESTIARY).filter((f) => f.endsWith('.json'));
const shards = new Map<string, Creature[]>(shardFiles.map((f) => [f, readJson(join(BESTIARY, f)).creature ?? []]));
const hazards: Hazard[] = readJson(join(DATA, 'hazards.json')).hazard ?? [];
const index: Array<{ name: string; file: string }> = readJson(join(DATA, 'index.json'));
const pin = readJson(join(ROOT, 'scripts/data/bestiary-corpus-pin.json'));

describe('the shipped bestiary equals its corpus pin', () => {
  it('(a) pin counts equal the shipped files', () => {
    const creatures = [...shards.values()].reduce((a, c) => a + c.length, 0);
    expect(pin.counts).toEqual({
      creatures,
      hazards: hazards.length,
      shards: shardFiles.length,
      indexRows: index.length,
      indexHazardRows: index.filter((r) => r.file === HAZARD_FILE).length,
    });
    expect(pin.repo).toBe('https://github.com/guybirinbom-hub/hh-bestiary-corpus');
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof pin.fetchedAt).toBe('string');
    // ruling R12: the shards whose every record is superseded by a linked remaster do not ship
    for (const s of pin.skippedShards) expect(shards.has(s.file)).toBe(false);
  });

  it('(b) every shipped shard is named by the index and every index row names a file that ships', () => {
    const named = new Set(index.filter((r) => r.file !== HAZARD_FILE).map((r) => r.file));
    expect(shardFiles.filter((f) => !named.has(f))).toEqual([]);
    expect([...named].filter((f) => !shards.has(f))).toEqual([]);
    expect(existsSync(join(DATA, 'hazards.json'))).toBe(true);
  });

  it('(c) record shapes the tracker reads: abilities {top,mid,bot} arrays, defenses.hp an array, hazard description[0] a string', () => {
    const badCreatures: string[] = [];
    for (const [f, list] of shards) {
      for (const c of list) {
        const ab = c.abilities as Record<string, unknown> | undefined;
        const ok = !!ab && Array.isArray(ab.top) && Array.isArray(ab.mid) && Array.isArray(ab.bot)
          && Array.isArray(c.defenses?.hp);
        if (!ok) badCreatures.push(`${f}: ${c.name}`);
      }
    }
    expect(badCreatures).toEqual([]);
    const badHazards = hazards.filter((h) => !Array.isArray(h.description) || typeof h.description[0] !== 'string').map((h) => h.name);
    expect(badHazards).toEqual([]);
    expect(hazards.length).toBeGreaterThan(0);
  });
});

/* ---- (d) mutation proof ---- */
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const temp = () => { const r = mkdtempSync(join(tmpdir(), 'hh-bestiary-test-')); roots.push(r); return r; };
const put = (dir: string, file: string, v: unknown) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), typeof v === 'string' ? v : JSON.stringify(v));
};
const TINY = { records: 1, flavor: 1, family: 1, rituals: 1, families: 1 };
const creature = (name: string, family = 'Demon') => ({
  name, family, flavor: 'A fixture creature.', rituals: [{ name: 'r' }],
  abilities: { top: [], mid: [], bot: [] }, defenses: { hp: [{ hp: 10 }] },
});

function fixture(opts: { extraShard?: boolean; pinCreatures?: number; noPin?: boolean; shipSkipped?: boolean; family?: string } = {}) {
  const dir = temp();
  put(dir, 'public/data/bestiary/creatures-a.json', { creature: [creature('Alpha', opts.family)] });
  if (opts.extraShard) put(dir, 'public/data/bestiary/creatures-b.json', { creature: [creature('Beta')] });
  if (opts.shipSkipped) put(dir, 'public/data/bestiary/creatures-old.json', { creature: [creature('Alpha (legacy)')] });
  put(dir, 'public/data/hazards.json', { hazard: [{ name: 'Pit', description: ['A pit.'] }] });
  // refute 2026-10-06: a hazard row carries isHazard, as every shipped one does — the tracker's loader
  // branches on the flag, and the check now fails a hazard row without it.
  put(dir, 'public/data/index.json', [
    { name: 'Alpha', file: 'creatures-a.json' },
    ...(opts.shipSkipped ? [{ name: 'Alpha (legacy)', file: 'creatures-old.json' }] : []),
    { name: 'Pit', file: HAZARD_FILE, isHazard: true },
  ]);
  put(dir, 'public/data/creature-families.json', { demon: { name: 'Demon', text: 'Demons.' } });
  if (!opts.noPin) {
    const shards = opts.shipSkipped ? 2 : 1;
    put(dir, 'scripts/data/bestiary-corpus-pin.json', {
      repo: 'https://github.com/guybirinbom-hub/hh-bestiary-corpus', commit: '0'.repeat(40), fetchedAt: 'fixture',
      counts: {
        creatures: opts.pinCreatures ?? (opts.shipSkipped ? 2 : 1), hazards: 1, shards,
        indexRows: opts.shipSkipped ? 3 : 2, indexHazardRows: 1,
      },
      skippedShards: [{ file: 'creatures-old.json', records: 1, reason: 'every record superseded by a linked remaster' }],
    });
  }
  return dir;
}
const text = (r: { lines: Array<{ text: string }> }) => r.lines.map((l) => l.text).join('\n');

describe('(d) bestiary-fields-check goes red on each mutation, green on a correct fixture', () => {
  it('a correct tiny fixture passes', () => {
    const r = check(fixture(), { floors: TINY });
    expect(text(r)).toContain('all fields present');
    expect(r.bad).toBe(0);
  });

  it('an extra shard no index row names fails', () => {
    const r = check(fixture({ extraShard: true }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(text(r)).toMatch(/bestiary file\(s\) no index row names: creatures-b\.json/);
  });

  it('a pin whose counts are off fails', () => {
    const r = check(fixture({ pinCreatures: 2 }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(text(r)).toMatch(/creatures: pin 2, shipped 1/);
  });

  it('a missing pin fails', () => {
    const r = check(fixture({ noPin: true }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(text(r)).toMatch(/bestiary-corpus-pin\.json is missing/);
  });

  it('a shard the pin skipped (a superseded printing, R12) fails when it ships', () => {
    const r = check(fixture({ shipSkipped: true }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(text(r)).toMatch(/creatures-old\.json ships, but the pin skipped it/);
  });

  it('a family that joins nothing in creature-families.json fails the join-rate floor', () => {
    const r = check(fixture({ family: 'Nowhere' }), { floors: TINY });
    expect(r.bad).toBeGreaterThan(0);
    expect(text(r)).toMatch(/family join rate\s+0\.0000.*BELOW FLOOR/);
  });

  it('the join is lower-cased, as the tracker joins it ("Demon" finds key "demon")', () => {
    const r = check(fixture({ family: 'Demon' }), { floors: TINY });
    expect(text(r)).toMatch(/family join rate\s+1\.0000.*ok/);
  });

  it('the real shipped data passes with the real floors', () => {
    const r = check(ROOT);
    expect(r.lines.filter((l) => (l as { err: boolean }).err).map((l) => l.text)).toEqual([]);
    expect(r.bad).toBe(0);
  });
});

describe('(d) the importer refuses an incomplete corpus', () => {
  const run = (corpus: string) => {
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts/import-bestiary-corpus.mjs'), corpus, '--dry-run'], { stdio: 'pipe', encoding: 'utf8' });
      return { code: 0, err: '' };
    } catch (e) {
      const x = e as { status: number; stderr: string };
      return { code: x.status, err: String(x.stderr) };
    }
  };

  it('refuses without STATUS.md', () => {
    const dir = temp();
    put(dir, 'report/coverage.json', { live: { creature: 1, hazard: 1 }, corpus: { creature: 1, hazard: 1 } });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/REFUSED: .*STATUS\.md is missing/);
  });

  it('refuses when coverage.live != coverage.corpus', () => {
    const dir = temp();
    put(dir, 'STATUS.md', 'Last complete green build: x (Archives fetched 2026-01-01T00:00:00.000Z).\n');
    put(dir, 'report/coverage.json', { live: { creature: 2, hazard: 1 }, corpus: { creature: 1, hazard: 1 } });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/REFUSED: coverage\.live\.creature \(2\) != coverage\.corpus\.creature \(1\)/);
  });
});
