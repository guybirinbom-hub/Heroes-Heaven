/*
 * THE TRUST LEDGER GENERATOR — the five things a wrong ledger would do silently.
 *
 * docs/trust-gate.md section 7 step 1. `scripts/trust-ledger.mjs` writes the OFF list the runtime gate
 * reads, and every failure mode of that file is invisible at generation time: an app that silently
 * empties a shield, a class that loses its chassis, a record that stays dark after Guy ruled it back
 * on, a ledger that churns on every run and makes the section-5 diff-against-tracked check useless.
 * Each `describe` below pins one of them.
 *
 * The generator runs THREE times here (default twice, --batched-only once) because determinism and the
 * superset property are both claims about whole runs, not about one record. It is a child process, so
 * this file uses CHILD_TIMEOUT.
 */
import { describe, expect, it, vi, afterAll } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');
type Json = Record<string, any>;

/** The generator resolves --out against the repo root, so these stay repo-relative. */
const OUT_A = 'work/.trust-ledger-test-a.json';
const OUT_B = 'work/.trust-ledger-test-b.json';
const OUT_BATCHED = 'work/.trust-ledger-test-batched.json';

const gen = (out: string, extra: string[] = []) => {
  execFileSync(process.execPath, ['scripts/trust-ledger.mjs', '--out', out, ...extra], {
    cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return readFileSync(join(CLI_ROOT, out), 'utf8');
};

const textA = gen(OUT_A);
const textB = gen(OUT_B);
const textBatched = gen(OUT_BATCHED, ['--batched-only']);
const ledger: Json = JSON.parse(textA);
const batched: Json = JSON.parse(textBatched);
const core: Json = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));
const fields: Json = JSON.parse(readFileSync(join(CLI_ROOT, 'scripts/data/trust-fields.json'), 'utf8'));
const diff: Json = JSON.parse(readFileSync(join(CLI_ROOT, 'work/.wg-diff-all.json'), 'utf8'));

afterAll(() => {
  for (const f of [OUT_A, OUT_B, OUT_BATCHED]) rmSync(join(CLI_ROOT, f), { force: true });
});

/** bucket/id -> the kinds Wanderer's Guide encodes there. The one thing every invariant below asks. */
const theirKinds = new Map<string, Set<string>>();
for (const list of ['theyOnly', 'weOnly', 'agree']) {
  for (const r of diff[list]) theirKinds.set(`${r.bucket}/${r.id}`, new Set<string>(r.theirKinds ?? []));
}

describe('trust ledger — the same inputs produce the same bytes', () => {
  /* Section 2c: the ledger is tracked and section 5 diffs a fresh run against the tracked copy. A
   * generator that emitted a timestamp, or an unsorted key order, would make that guard red on every
   * run and it would be switched off within a week. */
  it('two runs are byte-identical', () => {
    expect(textB).toBe(textA);
  });

  it('is stamped with exactly coreSha, wgSha and generator — no clock', () => {
    expect(Object.keys(ledger).sort()).toEqual(['coreSha', 'generator', 'lanes', 'records', 'wgSha']);
    expect(ledger.coreSha).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ledger)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('every key and every array is sorted', () => {
    const keys = Object.keys(ledger.records);
    expect(keys).toEqual([...keys].sort());
    for (const [k, paths] of Object.entries(ledger.records as Record<string, string[]>)) {
      expect(paths, k).toEqual([...paths].sort());
    }
    for (const [lane, ids] of Object.entries(ledger.lanes as Json)) {
      /* `featGrants` is a MAP of id -> off kinds (decision 2); the other four are id lists. Both
       * shapes are sorted, keys and values, or the section-5 diff-against-tracked check churns. */
      const list = Array.isArray(ids) ? ids : Object.keys(ids);
      expect(list, lane).toEqual([...list].sort());
      if (!Array.isArray(ids)) {
        for (const [id, kinds] of Object.entries(ids as Record<string, string[]>)) {
          expect(kinds, `${lane}/${id}`).toEqual([...kinds].sort());
          expect(kinds.length, `${lane}/${id}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('trust ledger — the buckets that are ON by construction', () => {
  /* Q2, verbatim: deities are on, "there isnt realy a place to mess up here and we need this". They are
   * not one of the 8 paired buckets, so the only way they could appear is a generator that walked
   * something it was never asked to walk. The counts are asserted so the test cannot pass vacuously. */
  it('no deity is ever in the ledger', () => {
    expect(Object.keys(core.deities).length).toBeGreaterThan(400);
    expect(Object.keys(ledger.records).filter((k) => k.startsWith('deities/'))).toEqual([]);
    expect(ledger.lanes.situational.filter((id: string) => core.deities[id])).toEqual([]);
  });

  /* Section 2 step 3: classes, ancestries and backgrounds ARE the character chassis and are all-on.
   * A class record in the ledger means the gate could take a fighter's HP per level away. */
  it('no class, ancestry or background record is ever in the ledger', () => {
    expect(core.classes.fighter?.hpPerLevel).toBeGreaterThan(0);
    expect(ledger.records['classes/fighter']).toBeUndefined();
    for (const chassis of ['classes/', 'ancestries/', 'backgrounds/']) {
      expect(Object.keys(ledger.records).filter((k) => k.startsWith(chassis)), chassis).toEqual([]);
    }
  });
});

describe('trust ledger — a WE-ONLY record loses its extra kinds and keeps the ones WG encodes', () => {
  /*
   * Ruling Q1: "the trusted unit is the KIND on a record, not the record". `feats/become-thought` is the
   * shape in one row — WG encodes `defense` on it and nothing else, so its `resistances` stays live and
   * its innate spell (kinds spellcasting+spell, neither of them theirs) goes dark. If the generator
   * expanded a trusted KIND back out to its whole field list, as the first draft did, `innateSpells`
   * would survive here and the gate would be decorative.
   */
  it('become-thought: innateSpells off, resistances on', () => {
    const row = [...diff.weOnly, ...diff.agree, ...diff.theyOnly].find(
      (r: Json) => r.bucket === 'feats' && r.id === 'become-thought',
    );
    expect(row?.theirKinds).toEqual(['defense']);
    expect(core.feats['become-thought'].resistances?.length).toBeGreaterThan(0);
    expect(core.feats['become-thought'].innateSpells).toBeDefined();
    expect(ledger.records['feats/become-thought']).toContain('innateSpells');
    expect(ledger.records['feats/become-thought']).not.toContain('resistances');
  });

  /* The example the plan names: WG has the row and encodes only a `note`, so our `modifiesGrant` rider —
   * the whole of what the record mechanically does — goes off, and the record ends fully dark. */
  it('greater-merciful-elixir: its one extra path is off', () => {
    expect(core.feats['greater-merciful-elixir'].modifiesGrant).toBeDefined();
    expect(ledger.records['feats/greater-merciful-elixir']).toEqual(['modifiesGrant']);
  });

  /*
   * …and the same rule as an invariant over the WHOLE ledger, so it survives lane B adding approvals:
   * the generator must NEVER darken a path ANY of whose kinds WG encodes on that record (decision 1 —
   * ANY, not EVERY). An approvals entry can only ever move a path the other way.
   */
  it('no path is off whose kinds WG encodes any of on that record', () => {
    const kinds = new Map<string, string[]>(fields.paths.map((f: Json) => [f.path, f.kinds]));
    const wrong: string[] = [];
    for (const [key, paths] of Object.entries(ledger.records as Record<string, string[]>)) {
      const t = theirKinds.get(key);
      if (!t) continue;
      for (const p of paths) if ((kinds.get(p) ?? []).some((k) => t.has(k))) wrong.push(`${key} ${p}`);
    }
    expect(wrong).toEqual([]);
  });

  /*
   * THE AEON STONES — the case decision 1 was taken for. `innateSpells` answers spellcasting+spell,
   * and Wanderer's Guide encodes `spell` on these rows and not `spellcasting`: it HAS encoded the
   * innate spell. Under the first reading (every kind) the stone's spell went dark, which is a record
   * WG models perfectly well being turned off — the one thing the ledger may not do. The whole class
   * of rows is asserted, not just the one stone, because a regression here would be silent.
   */
  it('an innateSpells record whose WG row has `spell` but not `spellcasting` keeps innateSpells', () => {
    const carriers = [...theirKinds.entries()].filter(([key, t]) => {
      const [bucket, id] = key.split('/');
      return core[bucket]?.[id]?.innateSpells && t.has('spell') && !t.has('spellcasting');
    });
    expect(carriers.length).toBeGreaterThan(100);
    const stone = 'items/aeon-stone-agate-ellipsoid';
    expect(carriers.map(([k]) => k)).toContain(stone);
    expect(core.items['aeon-stone-agate-ellipsoid'].innateSpells).toBeDefined();
    const kept = carriers.filter(([key]) => !(ledger.records[key] ?? []).includes('innateSpells'));
    expect(kept.length).toBe(carriers.length);
  });
});

describe('trust ledger — the denylist is the only vocabulary it has', () => {
  /*
   * Section 2: the gate is a DENYLIST. Every path it names must be one of the hand-checked paths in
   * scripts/data/trust-fields.json, and the section-1 protections must not be reachable at all:
   * `abilityFlaws` and the other costs would hand the player a character stronger than print, `note` is
   * printed prose, and `damage` / `acBonus` / `hp` are item chassis — a shield with no Hit Points.
   */
  it('every path in the ledger is a trust-fields path', () => {
    const universe = new Set<string>(fields.paths.map((f: Json) => f.path));
    const stray = [...new Set(Object.values(ledger.records as Record<string, string[]>).flat())].filter((p) => !universe.has(p));
    expect(stray).toEqual([]);
  });

  it('a protected path never appears — in the universe or in the ledger', () => {
    const universe = new Set<string>(fields.paths.map((f: Json) => f.path));
    const inLedger = new Set(Object.values(ledger.records as Record<string, string[]>).flat());
    for (const p of ['abilityFlaws', 'note', 'spellNotes', 'damage', 'acBonus', 'hp', 'weaknesses', 'speedPenalty', 'dedicationGate', 'uses', 'limitedUses', 'actionCost', 'choice', 'effectChoices']) {
      expect(universe.has(p), `${p} in trust-fields`).toBe(false);
      expect(inLedger.has(p), `${p} in ledger`).toBe(false);
    }
    /* …and not as the tail of a nested path either: `…grant.weaknesses` is the same cost one level
     * down, and a nested `note` is prose wherever it sits. */
    for (const p of inLedger) {
      expect(p.replace(/\[\]$/, '').split('.').pop(), p).not.toMatch(/^(abilityFlaws|note|spellNotes|damage|acBonus|weaknesses|speedPenalty|uses)$/);
    }
  });
});

describe('trust ledger — the star lane names stars, not printed marks', () => {
  /*
   * `situationalBonuses.ts` holds SEVEN top-level `Record` objects and the lane scrape used to read the
   * WHOLE FILE, so 123 ids from RECORD_MARKERS and SITUATIONAL_SUPERSEDES landed on the star lane.
   * Those tables are printed MARKS with their own readers, and section 1 says printed prose is never
   * stripped — a lane list that names them is a lane list that can suppress print. Only FEAT_SITUATIONAL
   * (read by `entriesFor`, the lever section 3 gates) and CHOICE_SITUATIONAL (`choiceSituationalFor`)
   * carry stars. Both counts are asserted so a scrape that silently returned nothing would fail here.
   */
  const between = (text: string, symbol: string) => {
    const i = text.search(new RegExp(`^(?:export )?const ${symbol}\\b`, 'm'));
    expect(i, symbol).toBeGreaterThan(-1);
    const j = text.indexOf('\n};', i);
    return text.slice(i, j < 0 ? undefined : j);
  };
  const keysOf = (text: string) =>
    [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*[[{]/gm)].map((m) => m[1] ?? m[2]);

  it('every situational-lane id is a FEAT_SITUATIONAL or CHOICE_SITUATIONAL key', () => {
    const src = readFileSync(join(CLI_ROOT, 'src/rules/situationalBonuses.ts'), 'utf8');
    const stars = new Set([...keysOf(between(src, 'FEAT_SITUATIONAL')), ...keysOf(between(src, 'CHOICE_SITUATIONAL'))]);
    const marks = new Set(keysOf(between(src, 'RECORD_MARKERS')));
    expect(stars.size).toBeGreaterThan(2000);
    expect(marks.size).toBeGreaterThan(100);
    expect(ledger.lanes.situational.length).toBeGreaterThan(2000);
    expect(ledger.lanes.situational.filter((id: string) => !stars.has(id))).toEqual([]);
    /* …and the regression itself: a mark-only id must not be on the lane. */
    expect(ledger.lanes.situational.filter((id: string) => marks.has(id) && !stars.has(id))).toEqual([]);
  });
});

describe('trust ledger — --batched-only only ever turns MORE off', () => {
  /*
   * Section 2 step 4 and the rejected finding at the end of the plan: default mode trusts every record
   * WG encodes; `--batched-only` trusts only the ones a closed batch has read. The stricter reading must
   * be a strict superset in both the records map and every lane — if it ever turned something back ON,
   * the owner's choice between the two would not be a choice between two safe options.
   */
  it('every OFF path in default mode is also off in --batched-only', () => {
    const missing: string[] = [];
    for (const [key, paths] of Object.entries(ledger.records as Record<string, string[]>)) {
      const b: string[] = batched.records[key] ?? [];
      for (const p of paths) if (!b.includes(p)) missing.push(`${key} ${p}`);
    }
    expect(missing).toEqual([]);
    expect(Object.keys(batched.records).length).toBeGreaterThanOrEqual(Object.keys(ledger.records).length);
  });

  it('every lane in default mode is a subset of the same lane in --batched-only', () => {
    for (const lane of Object.keys(ledger.lanes)) {
      const mine = ledger.lanes[lane];
      if (Array.isArray(mine)) {
        const b = new Set<string>(batched.lanes[lane]);
        expect(mine.filter((id: string) => !b.has(id)), lane).toEqual([]);
        continue;
      }
      /* featGrants is a map, so "more off" means every OFF KIND is still off, not just every id. */
      const missing: string[] = [];
      for (const [id, kinds] of Object.entries(mine as Record<string, string[]>)) {
        const b: string[] = batched.lanes[lane][id] ?? [];
        for (const k of kinds) if (!b.includes(k)) missing.push(`${id} ${k}`);
      }
      expect(missing, lane).toEqual([]);
    }
  });
});

describe('trust ledger — the featGrants lane is per kind, so widening the scrape is safe', () => {
  /*
   * Decision 2. FEAT_GRANTS is a SPREAD of three tables (src/rules/featGrants.ts:753-756) and the
   * lane used to scrape only the one that lives in featGrants.ts, missing 247 ids. Widening it under a
   * single `grantsRecord` kind would have darkened ~110 records on which WG DOES encode `skill` —
   * per kind is the whole reason the widening is allowed, so the invariant is asserted directly.
   */
  const between = (text: string, symbol: string) => {
    const i = text.search(new RegExp(`^(?:export )?const ${symbol}\\b`, 'm'));
    expect(i, symbol).toBeGreaterThan(-1);
    const j = text.indexOf('\n};', i);
    return text.slice(i, j < 0 ? undefined : j);
  };
  const keysOf = (text: string) =>
    [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*[[{]/gm)].map((m) => m[1] ?? m[2]);
  const lane = ledger.lanes.featGrants as Record<string, string[]>;

  it('is a map of id -> off kinds, not a list', () => {
    expect(Array.isArray(lane)).toBe(false);
    expect(Object.keys(lane).length).toBeGreaterThan(100);
  });

  it('reaches all three tables FEAT_GRANTS spreads, not just the hand-authored one', () => {
    const auto = new Set(keysOf(between(readFileSync(join(CLI_ROOT, 'src/rules/featGrantsAuto.ts'), 'utf8'), 'FEAT_SKILL_GRANTS')));
    const laneTable = new Set(keysOf(between(readFileSync(join(CLI_ROOT, 'src/rules/featGrantsLane.ts'), 'utf8'), 'FEAT_LANE_GRANTS')));
    expect(auto.size).toBeGreaterThan(100);
    expect(laneTable.size).toBeGreaterThan(50);
    /* the hole this decision closed: ids from the generated files now reach the lane. */
    expect(Object.keys(lane).filter((id) => auto.has(id)).length).toBeGreaterThan(50);
    expect(Object.keys(lane).filter((id) => laneTable.has(id)).length).toBeGreaterThan(5);
  });

  it('every id on the lane is a key of one of the four scraped registries', () => {
    const known = new Set<string>([
      ...keysOf(between(readFileSync(join(CLI_ROOT, 'src/rules/featGrantsAuto.ts'), 'utf8'), 'FEAT_SKILL_GRANTS')),
      ...keysOf(between(readFileSync(join(CLI_ROOT, 'src/rules/featGrantsLane.ts'), 'utf8'), 'FEAT_LANE_GRANTS')),
      ...keysOf(between(readFileSync(join(CLI_ROOT, 'src/rules/featGrants.ts'), 'utf8'), 'HAND_AUTHORED_GRANTS')),
      ...keysOf(readFileSync(join(CLI_ROOT, 'src/rules/featFeatGrants.ts'), 'utf8')),
    ]);
    expect(Object.keys(lane).filter((id) => !known.has(id))).toEqual([]);
  });

  it('every off kind is one FEATGRANT_KEY_KINDS can name', () => {
    /* the vocabulary of scripts/wg-diff.mjs:838-846, which is the table the generator copies. */
    const vocabulary = new Set(['skill', 'choice', 'grantsRecord', 'save', 'perception', 'ac', 'weapon']);
    const stray = [...new Set(Object.values(lane).flat())].filter((k) => !vocabulary.has(k));
    expect(stray).toEqual([]);
  });

  /* THE INVARIANT THE WIDENING RESTS ON: a lane entry may never name a kind WG encodes on that
   * record, in any bucket the id lives in. The lane is keyed by BARE id, so this is asked of every
   * twin — a trusted twin keeps the kind on for both. */
  it('never lists a kind Wanderer\'s Guide encodes on that record', () => {
    const buckets = ['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'ancestries', 'classes', 'actions'];
    const wrong: string[] = [];
    for (const [id, kinds] of Object.entries(lane)) {
      for (const b of buckets) {
        const t = theirKinds.get(`${b}/${id}`);
        if (!t) continue;
        for (const k of kinds) if (t.has(k)) wrong.push(`${b}/${id} ${k}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
