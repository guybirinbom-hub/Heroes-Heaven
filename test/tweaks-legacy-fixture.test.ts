import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
import { DATA_IN_SRC, engineDirtyLines, isLegacyCharacter, LEGACY_FIXTURE, legacyDeltas, snapshotSubset, twinIdOf } from '../scripts/blocks-parity-snapshot.mjs';

/**
 * THE "BEFORE" NUMBERS OF TWEAKS PART B (work/tweaks-part-b-notes/plan.md, WP0 steps 3-5, section 3.6).
 *
 * test/fixtures/tweaks-legacy-before.json was written by `blocks-parity-snapshot.mjs --write-fixture`
 * at the part-A engine: per old-Overrides character, every sheet number that differs from its `#none`
 * twin (same build, no overrides), as a DELTA — so a data regeneration that moves a book number moves
 * both twins and the fixture still holds.
 *
 * This file pins the characters part B must NEVER move (plan 3.6 "NOT allowed, NUMBER 0"): the at-slot
 * blocker (Blackjacket), the asOf replay (Molten Wit), the firearm and daily ranks (B26 c), the old keys
 * nobody re-reads, and an import-stamped given feat. It also pins each one's PREMISE — a fixture whose
 * premise fails proves nothing — and the instrument itself: the snapshot waits on the heavy-job lock,
 * only old characters enter the fixture, and the re-take recipe carries every data file the engine reads.
 * WP3's own test (tweaks-migration) pins the characters that are ALLOWED to move, by stat.
 *
 * Synthetic characters only.
 */

type Gate = 'off' | 'on';
type Row = { gates: Record<string, { numbers: Record<string, unknown>; full?: Record<string, any>; buildError?: string; playError?: string }> };
type Fixture = {
  header: { engineCommit: string; retake: string; coreSha: string };
  characters: Record<string, { twin: string | null; gates: Record<string, unknown> }>;
};

const ROOT = join(__dirname, '..');
/* TWEAKS_LEGACY_FIXTURE points the test at a planted copy (proving it fails once), never at a real file. */
const fixture = JSON.parse(readFileSync(process.env.TWEAKS_LEGACY_FIXTURE || join(ROOT, LEGACY_FIXTURE), 'utf8')) as Fixture;
const NEVER_MOVES = /^overrides:(at-slot|asof|firearm|daily|legacy-misc|import-meta):/;

let chars: Record<string, Row> = {};
beforeAll(async () => {
  chars = (await snapshotSubset('^overrides:')).characters as Record<string, Row>;
}, 180_000);

const num = (cid: string, gate: Gate, stat: string) => chars[cid].gates[gate].numbers[stat];
const full = (cid: string, gate: Gate) => chars[cid].gates[gate].full as Record<string, any>;
const GATES: Gate[] = ['off', 'on'];

describe('the legacy fixture (test/fixtures/tweaks-legacy-before.json)', () => {
  it('names the engine commit it was taken at and the re-take recipe', () => {
    expect(fixture.header.engineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(fixture.header.retake).toMatch(/worktree/);
    expect(fixture.header.retake).toMatch(/engineCommit/);
    // the trust gate imports the ledger, so the recipe must carry the re-stamped one (gate-on half)
    for (const f of ['public/core.json', 'public/core-descriptions.json', 'src/data/trust-ledger.json']) expect(fixture.header.retake).toContain(f);
  });

  it('the dirty-src refusal ignores exactly the data the recipe copies (the ledger), and nothing else under src/', () => {
    expect(DATA_IN_SRC).toEqual(['src/data/trust-ledger.json']);
    expect(engineDirtyLines(' M src/data/trust-ledger.json\n')).toEqual([]);
    expect(engineDirtyLines(' M src/data/trust-ledger.json\n M src/rules/build.ts\n?? src/data/trust-ledger.json.bak\n')).toEqual([
      ' M src/rules/build.ts',
      '?? src/data/trust-ledger.json.bak',
    ]);
    expect(engineDirtyLines(' M src/data/page-slices.json\n')).toEqual([' M src/data/page-slices.json']);
  });

  it('covers every old-Overrides character the snapshot builds, each against its #none twin', () => {
    // legacyDeltas keeps OLD characters only (isLegacyCharacter): part B's new-shape characters
    // (overrides:new-shape:*, plan WP1) never enter this fixture, so adding one does not turn this red.
    const now = legacyDeltas(chars);
    expect(Object.keys(fixture.characters).sort()).toEqual(Object.keys(now).sort());
    for (const [cid, row] of Object.entries(fixture.characters)) {
      expect(row.twin, cid).toBe(twinIdOf(cid));
      expect(chars[twinIdOf(cid)], `${cid} has no #none twin in the snapshot`).toBeTruthy();
    }
  });

  it('a new-shape character (by id or by meta.newShape) is not an old-Overrides character, so it never enters the fixture', () => {
    const g = { on: { numbers: { 'speed.land': 30 } } };
    const t = { on: { numbers: { 'speed.land': 25 } } };
    const map = {
      'overrides:new-shape:fighter-L5': { gates: g },
      'overrides:new-shape:fighter-L5#none': { gates: t },
      'overrides:flagged:fighter-L5': { gates: g, meta: { newShape: true } },
      'overrides:flagged:fighter-L5#none': { gates: t },
      'overrides:old:fighter-L5': { gates: g },
      'overrides:old:fighter-L5#none': { gates: t },
    };
    expect(Object.keys(legacyDeltas(map))).toEqual(['overrides:old:fighter-L5']);
    expect(isLegacyCharacter('overrides:new-shape:x', {})).toBe(false);
    expect(isLegacyCharacter('overrides:old:x#none', {})).toBe(false);
    expect(isLegacyCharacter('overrides:old:x', {})).toBe(true);
  });

  it('the characters part B must never move still differ from their twins exactly as at the part-A engine (plan 3.6: NUMBER 0)', () => {
    const now = legacyDeltas(chars);
    const ids = Object.keys(fixture.characters).filter((c) => NEVER_MOVES.test(c));
    // at-slot, asof, firearm, daily (L5 and L8), legacy-misc, import-meta
    expect(ids.length).toBe(7);
    for (const cid of ids)
      expect(now[cid], `${cid} moved against its twin. If only book data changed, the fixture's own recipe applies: ${fixture.header.retake}`).toEqual(fixture.characters[cid]);
  });
});

describe('each never-moves fixture proves something: its premise holds', () => {
  // The before-slot rank (trained) and the order (the old `=` runs before Blackjacket's conditional raise) were
  // measured by probe at the part-A engine (wp0-report "Premises"), not asserted here: an untrained-entry
  // variant would sort "exactly" (below the at-slot rank, case B), which part B may move by design, so it
  // cannot join this never-move list. This test claims only what it asserts.
  it('at-slot: Intimidation is expert with Blackjacket Dedication held — with and without the redundant old entry', () => {
    for (const g of GATES) {
      expect(num('overrides:at-slot:fighter-L4', g, 'skill.intimidation.rank')).toBe('expert');
      expect(num('overrides:at-slot:fighter-L4#none', g, 'skill.intimidation.rank')).toBe('expert');
      expect(full('overrides:at-slot:fighter-L4', g).feats.map((f: { featId: string }) => f.featId)).toContain('blackjacket-dedication');
      expect(full('overrides:at-slot:fighter-L4', g).overrides.proficiencies).toEqual({ intimidation: 'trained' });
    }
  });

  it('asof: Molten Wit read Deception and Diplomacy untrained before itself, and took the "train Deception" branch', () => {
    for (const g of GATES) {
      const c = full('overrides:asof:fighter-L5', g);
      expect(c.skillRankBefore?.['molten-wit']).toEqual({ deception: 'untrained', diplomacy: 'untrained' });
      expect(num('overrides:asof:fighter-L5', g, 'skill.deception.rank')).toBe('trained');
      expect(num('overrides:asof:fighter-L5', g, 'skill.diplomacy.rank')).toBe('untrained');
      expect((c.skillFallbacks ?? []).some((f: { featId: string }) => f.featId === 'molten-wit')).toBe(false);
    }
  });

  it('firearm: the old entry lowers martial weapons below the class rank, while the firearm Strike keeps the gunslinger firearm rank', () => {
    for (const g of GATES) {
      const c = full('overrides:firearm:gunslinger-L5', g);
      const twin = full('overrides:firearm:gunslinger-L5#none', g);
      expect(c.proficiencies.attacks.martial).toBe('trained');
      expect(twin.proficiencies.attacks.martial).toBe('expert');
      expect(c.proficiencies.firearmProf.martial).toBe('master');
      const strikes = c.inventory.map((i: { itemId: string }) => i.itemId);
      expect(strikes).toEqual(['arquebus', 'longsword']);
      // inv-0 = the arquebus (firearm rank), inv-1 = the longsword (the lowered martial rank)
      expect(num('overrides:firearm:gunslinger-L5', g, 'strike.inv-0.attack')).toBe(num('overrides:firearm:gunslinger-L5#none', g, 'strike.inv-0.attack'));
      expect(num('overrides:firearm:gunslinger-L5', g, 'strike.inv-1.attack')).not.toBe(num('overrides:firearm:gunslinger-L5#none', g, 'strike.inv-1.attack'));
    }
  });

  it("daily: the old entry stores Arcana untrained, and the morning's pick beats it on the sheet (Haunting Memories under both gates, Ancestral Longevity where its grant is live)", () => {
    for (const g of GATES) {
      expect(full('overrides:daily:wizard-L8', g).proficiencies.skills.arcana).toBe('untrained');
      expect(num('overrides:daily:wizard-L8', g, 'skill.arcana.rank')).toBe('expert');
      expect(full('overrides:daily:wizard-L5', g).proficiencies.skills.arcana).toBe('untrained');
    }
    // Ancestral Longevity's skill grant is dark under the trust gate; at gate off it trains Arcana.
    expect(num('overrides:daily:wizard-L5', 'off', 'skill.arcana.rank')).toBe('trained');
  });

  it('legacy-misc: every old key still does what it did — the removed feat moves Speed, the given feature is listed, the rest are carried', () => {
    const ids = (xs: { featId?: string; featureId?: string }[] | undefined) => (xs ?? []).map((x) => x.featId ?? x.featureId).sort();
    for (const g of GATES) {
      const c = full('overrides:legacy-misc:cleric-L3', g);
      const twin = full('overrides:legacy-misc:cleric-L3#none', g);
      // removedFeatIds: Fleet is picked on both; the old key takes it off the character (Speed −5 vs the twin)
      expect(ids(twin.feats)).toContain('fleet');
      expect(ids(c.feats)).not.toContain('fleet');
      expect(ids(c.feats)).toEqual(ids(twin.feats).filter((f) => f !== 'fleet'));
      expect(num('overrides:legacy-misc:cleric-L3', g, 'speed.land')).toBe((num('overrides:legacy-misc:cleric-L3#none', g, 'speed.land') as number) - 5);
      // addedFeatures: display only (grantedFeatures; nothing derives from it) — pinned here, not by a number
      expect(ids(c.grantedFeatures)).toEqual(['shield-block']);
      expect(ids(twin.grantedFeatures)).toEqual([]);
      // allowedFeats: only widens the Builder's picker (the build never checks legality) — carried as stored
      expect(c.overrides.allowedFeats).toEqual(['toughness']);
    }
  });

  it('legacy-misc and import-meta carry their old keys into the stored character untouched', () => {
    const misc = full('overrides:legacy-misc:cleric-L3', 'off').overrides;
    expect(Object.keys(misc).sort()).toEqual(['addedFeatures', 'addedLanguages', 'addedSpells', 'allowedFeats', 'removedFeatIds']);
    expect(misc.removedFeatIds).toEqual(['fleet']);
    const imp = full('overrides:import-meta:fighter-L4', 'off').overrides;
    expect(imp.meta['addedFeats:fleet@3']).toEqual({ source: 'import', of: 'fleet@3' });
    expect(num('overrides:import-meta:fighter-L4', 'off', 'speed.land')).toBe((num('overrides:import-meta:fighter-L4#none', 'off', 'speed.land') as number) + 5);
  });
});

describe('the parity snapshot takes the heavy-job lock (never beside vitest)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hh-parity-lock-'));
  const lock = join(dir, 'heavy.lock');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args: string[]) => {
    const env = { ...process.env, HEAVY_LOCK_PATH: lock };
    delete env.HEAVY_LOCK; // vt.mjs's holder would otherwise make the child pass straight through
    const child = spawn(process.execPath, [join(ROOT, 'node_modules/jiti/lib/jiti-cli.mjs'), join(ROOT, 'scripts/blocks-parity-snapshot.mjs'), ...args], { cwd: ROOT, env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const done = new Promise<number>((res) => child.on('close', (code) => res(code ?? 1)));
    return { child, done, out: () => out };
  };

  it('a snapshot run waits while a live job holds the lock, and runs once it is released', async () => {
    // This test's own pid stands in for the other heavy job (a live holder).
    writeFileSync(lock, JSON.stringify({ pid: process.pid, label: 'fixture holder', since: new Date().toISOString() }));
    const outFile = join(dir, 'snap.json');
    const r = run(['--only', '^overrides:lore-bare:', '--out', outFile]);
    const t0 = Date.now();
    while (!/heavy-lock: waiting for pid/.test(r.out()) && Date.now() - t0 < 60_000) await new Promise((s) => setTimeout(s, 250));
    expect(r.out()).toMatch(/heavy-lock: waiting for pid/);
    await new Promise((s) => setTimeout(s, 2500)); // longer than one 2 s poll
    expect(existsSync(outFile), 'it built characters while another heavy job held the lock').toBe(false);
    rmSync(lock, { force: true }); // the other job finishes
    expect(await r.done).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(outFile, 'utf8')).characters).sort()).toEqual(['overrides:lore-bare:fighter-L3', 'overrides:lore-bare:fighter-L3#none']);
    expect(existsSync(lock)).toBe(false); // released what it took
  }, CHILD_TIMEOUT);

  it('--self-test only reads files: it runs (and passes) while the lock is held', async () => {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, label: 'fixture holder', since: new Date().toISOString() }));
    const base = join(dir, 'base.json');
    writeFileSync(base, JSON.stringify({ characters: chars }));
    const r = run(['--self-test', '--baseline', base]);
    expect(await r.done, r.out()).toBe(0);
    expect(r.out()).toMatch(/self-test passed/);
    expect(r.out()).not.toMatch(/heavy-lock: waiting/);
    rmSync(lock, { force: true });
  }, CHILD_TIMEOUT);
});
