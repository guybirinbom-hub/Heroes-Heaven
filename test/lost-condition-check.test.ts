/*
 * scripts/lost-condition-check.mjs — a condition Foundry attached to an effect is not lost on our record
 * (2026-10-17). The import dropped Foundry's rule predicates ("only while raging", "only while wearing your
 * innovation", "only on visual Perception checks") and our own overlay rows did the same by hand; this check
 * fails every counterpart that applies more broadly than the condition, lit or dark, unless the allow file
 * quotes print saying otherwise.
 *
 * Every case runs the REAL check in a child process against scratch copies (its env overrides), never the
 * tree: the shipped core.json with one record planted, an allow file holding only the snapshot rows the case
 * is about (no Foundry packs, so the snapshot is the measured set), a scratch Archives page, trust ledger and
 * owner-question file. Each guard is shown red on a planted bad case and green on the clean fixture.
 * Synthetic records only (ids zz-lc-*).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHILD_TIMEOUT } from './_timeouts';
import { atomsOf, importerDocs, loadPackIndex } from '../scripts/lib/foundry-rules.mjs';

vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const ROOT = resolve(__dirname, '..');
const JITI = join(ROOT, 'node_modules/jiti/lib/jiti-cli.mjs');
const CHECK = join(ROOT, 'scripts/lost-condition-check.mjs');
const PACKS = join(ROOT, '.import-src/pf2e/packs/pf2e');

type Rec = Record<string, unknown>;
type Core = Record<string, Record<string, Rec>>;
type Row = { r: string; k: string; s: unknown; a: Record<string, unknown>[]; [k: string]: unknown };
type Entry = Record<string, unknown>;

const realCore = (): Core => JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const realAllow = JSON.parse(readFileSync(join(ROOT, 'scripts/data/lost-condition-allow.json'), 'utf8')) as {
  entries: Entry[];
  snapshot: { rows: Row[] };
};
type Ledger = { records: Record<string, string[]>; lanes: Record<string, unknown> };
const realLedger = JSON.parse(readFileSync(join(ROOT, 'src/data/trust-ledger.json'), 'utf8')) as Ledger;
/** A real kept-over-grant entry and its real snapshot rows (2026-10-17 reconcile). */
const realEntry = (record: string): Entry => {
  const e = realAllow.entries.find((x) => x.record === record && x.verdict === 'kept-over-grant');
  if (!e) throw new Error(`no kept-over-grant entry for ${record} in the allow file`);
  return structuredClone(e);
};
const realRows = (record: string): Row[] => realAllow.snapshot.rows.filter((r) => r.r === record);
const BAGPIPES = 'items/bagpipes-of-turmoil';
const ROPE = 'feats/rope-runner';
/*
 * A DARK kept over-grant (synthetic). Until 2026-10-17 the real Sprite's Spark entry played this part —
 * dark, blocked by a FILE — but it is fixed now (heritage-gated Strikes, test/lost-condition-blocked-*), and
 * a file-blocked entry fails outright since the owner's rule that known over-grants fail. What is left to
 * guard is a dark over-grant waiting on a dark GATE: an approval that lights the over-granting field
 * instead of the gate must still fail.
 */
const CLAWS = 'feats/zz-lc-claws';
const CLAWS_MODE = 'zz-lc-claws-form';
const CLAWS_PAGE = 'feat-990004';
const CLAWS_ROWS: Row[] = [{ r: CLAWS, k: 'Strike', s: 'claw', a: [{ f: 'heritage/ancestry/trait' }] }];
const clawsEntry = (over: Entry = {}): Entry => ({
  record: CLAWS,
  key: 'Strike',
  selector: 'claw',
  families: ['heritage/ancestry/trait'],
  verdict: 'kept-over-grant',
  trust: 'dark',
  awaitsApproval: 126,
  aonId: CLAWS_PAGE,
  quote: 'If you are a zz heritage, you gain a claw unarmed attack',
  why: 'Synthetic: a dark over-grant whose carrier (a mode) is dark too, waiting on the owner.',
  blockedBy: { gate: [`mode:${CLAWS_MODE}`] },
  followUp: 'Synthetic: light the mode, then drop the standing claw.',
  ...over,
});

/** The two real records the planted cases take a gate away from, and the synthetic ones. */
const REAL = ['classFeatures/animal-instinct', 'classFeatures/dense-plating'];
const GOGGLES = 'items/zz-lc-goggles';
const MASK = 'items/zz-lc-mask';
const PIPES = 'items/zz-lc-pipes';
const SYNTH_ROWS: Row[] = [
  // Foundry: +1 to Perception, predicate ["visual"] (an effect trait) — a NUMBER cannot carry it (ruling B)
  { r: GOGGLES, k: 'FlatModifier', s: ['perception'], a: [{ f: 'effect trait' }] },
  // Foundry: +1 to Performance behind the document's own "playing" toggle
  { r: MASK, k: 'FlatModifier', s: ['performance'], a: [{ f: 'own toggle' }] },
  { r: PIPES, k: 'FlatModifier', s: ['performance'], a: [{ f: 'own toggle' }] },
];
const MASK_PAGE = 'equipment-990002';
const PIPES_PAGE = 'equipment-990003';
const MASK_QUOTE = 'You gain a +1 item bonus to Performance checks while you wear the mask';
const maskEntry = (over: Entry = {}): Entry => ({
  record: MASK,
  key: 'FlatModifier',
  selector: 'performance',
  families: ['own toggle'],
  verdict: 'default-state',
  aonId: MASK_PAGE,
  quote: MASK_QUOTE,
  why: 'Synthetic: print gives the bonus whenever the mask is worn; the toggle is Foundry bookkeeping.',
  ...over,
});
const pipesEntry = (over: Entry = {}): Entry => ({
  record: PIPES,
  key: 'FlatModifier',
  selector: 'performance',
  families: ['own toggle'],
  verdict: 'needs-reading',
  ownerQuestion: 9001,
  aonId: PIPES_PAGE,
  quote: 'The pipes grant a +2 item bonus to Performance checks',
  why: 'Synthetic: whether "while playing" is every Performance check with the pipes is the owner\'s reading.',
  ...over,
});

let dir = '';
let n = 0;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lost-cond-'));
  const mirror = join(dir, 'mirror', 'equipment');
  mkdirSync(mirror, { recursive: true });
  writeFileSync(join(mirror, `${MASK_PAGE}.json`), JSON.stringify({ text: `<title level="1">Zz Mask</title> Zz Mask --- ${MASK_QUOTE} , and while acting.` }));
  writeFileSync(join(mirror, `${PIPES_PAGE}.json`), JSON.stringify({ text: 'Zz Pipes --- The pipes grant a +2 item bonus to Performance checks while playing music with them.' }));
  // the two real kept over-grants' pages, holding only their entries' printed clause
  const bag = realEntry(BAGPIPES);
  writeFileSync(join(mirror, `${bag.aonId}.json`), JSON.stringify({ text: `Bagpipes --- ${bag.quote}.` }));
  const rope = realEntry(ROPE);
  mkdirSync(join(dir, 'mirror', 'feat'), { recursive: true });
  writeFileSync(join(dir, 'mirror', 'feat', `${rope.aonId}.json`), JSON.stringify({ text: `Rope Runner --- ${rope.quote}` }));
  writeFileSync(join(dir, 'mirror', 'feat', `${CLAWS_PAGE}.json`), JSON.stringify({ text: `Zz Claws --- ${clawsEntry().quote} that deals 1d6 slashing damage.` }));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  plant?: (core: Core) => void;
  entries?: Entry[];
  rows?: Row[];
  ledger?: (l: Ledger) => void;
  questions?: Record<string, unknown>;
  /** scripts/data/trust-approvals.json stand-in; default: ruling #126 unruled (what the kept entries wait on). */
  approvals?: Record<string, unknown>;
  packs?: string;
  snapshotRows?: Row[];
}
/** Write one scratch fixture and run the check on it. */
function run(fx: Fixture = {}) {
  const d = join(dir, `case-${++n}`);
  mkdirSync(d);
  const core = realCore();
  core.items[GOGGLES.split('/')[1]] = { id: 'zz-lc-goggles', name: 'Zz Goggles', aonId: 'equipment-990001' }; // the bonus already moved to a star
  core.items[MASK.split('/')[1]] = { id: 'zz-lc-mask', name: 'Zz Mask', aonId: MASK_PAGE, passiveEffects: { skills: { performance: 1 } } };
  core.items[PIPES.split('/')[1]] = { id: 'zz-lc-pipes', name: 'Zz Pipes', aonId: PIPES_PAGE, passiveEffects: { skills: { performance: 2 } } };
  // the synthetic DARK kept over-grant: an ungated Claw (the over-grant), and the dark mode that would carry it
  core.feats[CLAWS.split('/')[1]] = { id: 'zz-lc-claws', name: 'Zz Claws', level: 1, aonId: CLAWS_PAGE, grantedStrikes: [{ name: 'Claw', die: 'd6', damageType: 'slashing', traits: ['unarmed'], group: 'brawling' }] };
  core.modes[CLAWS_MODE] = { id: CLAWS_MODE, name: 'Zz Claws Form', feats: ['zz-lc-claws'], modifiers: [], note: 'Synthetic.' };
  fx.plant?.(core);
  const rows = fx.snapshotRows ?? [...realAllow.snapshot.rows.filter((r) => REAL.includes(r.r)), ...SYNTH_ROWS, ...(fx.rows ?? [])];
  const allow = { _: 'test fixture', entries: fx.entries ?? [maskEntry(), pipesEntry()], snapshot: { rows } };
  const ledger = structuredClone(realLedger);
  ledger.records[CLAWS] = ['grantedStrikes'];
  ledger.lanes.modes = [...((ledger.lanes.modes as string[]) ?? []), CLAWS_MODE];
  fx.ledger?.(ledger);
  const questions = fx.questions ?? { open: [{ n: 9001 }], deferred: [], ruled: [], authorisedExceptions: [{ n: 126 }] };
  const approvals = fx.approvals ?? { approvals: [], noMechanic: [], engine: [], unruled: [{ n: 126, id: null, status: 'authorisedException' }] };
  const paths = { core: join(d, 'core.json'), allow: join(d, 'allow.json'), ledger: join(d, 'ledger.json'), questions: join(d, 'questions.json'), approvals: join(d, 'approvals.json') };
  writeFileSync(paths.core, JSON.stringify(core));
  writeFileSync(paths.allow, JSON.stringify(allow));
  writeFileSync(paths.ledger, JSON.stringify(ledger));
  writeFileSync(paths.questions, JSON.stringify(questions));
  writeFileSync(paths.approvals, JSON.stringify(approvals));
  const env = {
    ...process.env,
    CORE_JSON: paths.core,
    LOST_COND_ALLOW: paths.allow,
    TRUST_LEDGER: paths.ledger,
    OWNER_QUESTIONS: paths.questions,
    TRUST_APPROVALS: paths.approvals,
    AON_MIRROR: join(dir, 'mirror'),
    FOUNDRY_PACKS: fx.packs ?? join(d, 'no-packs'),
  };
  const r = spawnSync(process.execPath, [JITI, CHECK], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('lost-condition-check: the clean fixture is green', () => {
  it('real gated records, an allowed default state, a needs-reading warning — exit 0', () => {
    const r = run();
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('from the snapshot (no Foundry packs here)');
    expect(r.out).toContain(`allowed [lit] ${MASK} | FlatModifier selector performance | own toggle | default-state (${MASK_PAGE})`);
    // needs-reading is a WARNING, not a failure
    expect(r.out).toContain(`WARN needs-reading [lit] ${PIPES} | FlatModifier selector performance | own toggle | needs-reading (${PIPES_PAGE}) owner question #9001`);
    expect(r.out).toContain('lost-condition: ok');
  });
});

describe('lost-condition-check: a lost gate fails', () => {
  it('planted: Animal Instinct without grantedStrikesState (Foundry: self:effect:rage) — its jaws out of rage', () => {
    const r = run({ plant: (c) => void delete c.classFeatures['animal-instinct'].grantedStrikesState });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/OVER-GRANT \[lit\] classFeatures\/animal-instinct \| Strike selector jaws \| families: self effect\/condition \| on grantedStrikes/);
  });

  it('planted: Dense Plating without defensesRequire (Foundry: armor:id:<innovation>) — resistance with the suit off', () => {
    const r = run({ plant: (c) => void delete c.classFeatures['dense-plating'].defensesRequire });
    expect(r.status).toBe(1);
    expect(r.out).toContain('OVER-GRANT [lit] classFeatures/dense-plating | Resistance type slashing | families: armor/shield | on resistances');
  });

  it('planted: a number back on passiveEffects for a visual-only bonus (ruling B: a star, never a number)', () => {
    const r = run({ plant: (c) => void (c.items['zz-lc-goggles'].passiveEffects = { perception: 1 }) });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`OVER-GRANT [lit] ${GOGGLES} | FlatModifier selector perception | families: effect trait | on passiveEffects.perception`);
  });

  it('planted: a DARK over-grant fails too (an approval could switch it on)', () => {
    const r = run({
      plant: (c) => void (c.items['zz-lc-goggles'].passiveEffects = { perception: 1 }),
      ledger: (l) => void (l.records[GOGGLES] = ['passiveEffects.perception']),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`OVER-GRANT [dark] ${GOGGLES} | FlatModifier selector perception | families: effect trait | on passiveEffects.perception`);
  });
});

describe('lost-condition-check: the allow file is held to print', () => {
  it('planted: a misquoted entry fails', () => {
    const r = run({ entries: [maskEntry({ quote: 'You gain a +1 item bonus to every Performance check you ever make' }), pipesEntry()] });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`the quote is not printed in ${MASK_PAGE}`);
  });

  it('planted: an entry citing another page fails', () => {
    const r = run({ entries: [maskEntry({ aonId: PIPES_PAGE }), pipesEntry()] });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`aonId ${PIPES_PAGE} is not the record's page (${MASK_PAGE})`);
  });

  it('planted: a stale entry (the record no longer over-grants) fails', () => {
    const r = run({ plant: (c) => void delete c.items['zz-lc-mask'].passiveEffects });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/STALE allow entry 1 \(items\/zz-lc-mask FlatModifier performance\): "own toggle" no longer over-grants/);
  });

  it('planted: an entry excuses only its families — a second family on the same counterpart still fails', () => {
    const r = run({ rows: [{ r: MASK, k: 'FlatModifier', s: ['performance'], a: [{ f: 'own toggle' }, { f: 'target' }] }] });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`OVER-GRANT [lit] ${MASK} | FlatModifier selector performance | families: target`);
  });

  it('planted: a second entry on the same condition fails (a pasted twin, or a selector-less entry over a narrower one)', () => {
    // round-2 note: a scratch copy of the beastkin entry pasted twice was not refused.
    const twin = run({ entries: [maskEntry(), pipesEntry(), maskEntry()] });
    expect(twin.status).toBe(1);
    expect(twin.out).toContain(`allow entry 3 (${MASK} FlatModifier performance): duplicates allow entry 1 on ${MASK} FlatModifier performance "own toggle" — keep one entry per condition`);
    const wide = run({ entries: [maskEntry(), pipesEntry(), maskEntry({ selector: undefined })] });
    expect(wide.status).toBe(1);
    expect(wide.out).toContain('duplicates allow entry 1');
    expect(run().status).toBe(0); // one entry per condition is green
  });

  it('planted: needs-reading without an open owner question fails (ruled, or no number)', () => {
    const ruled = run({ questions: { open: [], deferred: [], ruled: [{ n: 9001 }] } });
    expect(ruled.status).toBe(1);
    expect(ruled.out).toContain('owner question #9001 is ruled — apply the ruling and change the verdict');
    const none = run({ entries: [maskEntry(), pipesEntry({ ownerQuestion: undefined })] });
    expect(none.status).toBe(1);
    expect(none.out).toContain('a needs-reading entry needs `ownerQuestion`');
  });
});

/*
 * 2026-10-17 reconcile: an over-grant whose carrier is DARK under the trust gate is KEPT, and the allow file
 * says so with `kept-over-grant` — never as a silent "route". It prints as a WARN line on every run, needs what
 * blocks it and the fix, and fails as STALE the moment a gate carrier it names is lit (the number must go
 * then, or the player sees it twice). Since the owner's rule that known over-grants FAIL, the only blocker that
 * may keep one is that dark gate waiting on HIS approval: the line says "waiting for the owner's approval of
 * the Ruling-B star" and names the desk number it waits on (test/lost-condition-blocked-check.test.ts runs the
 * same rules on the real allow file).
 */
const waitLine = (rest: string) => `WARN waiting for the owner's approval of the Ruling-B star ${rest}`;
describe('lost-condition-check: a kept over-grant stays visible and tied to its blocker', () => {
  const base = [maskEntry(), pipesEntry()];
  it('green: the real Bagpipes of Turmoil entry (its star is dark) prints as a waiting line tied to ruling #126, exit 0', () => {
    const r = run({ rows: realRows(BAGPIPES), entries: [...base, realEntry(BAGPIPES)] });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(waitLine(`[lit] ${BAGPIPES} | FlatModifier selector performance | own toggle | on passiveEffects.skills.performance | ruling #126 is unruled in `));
    expect(r.out).toMatch(/ruling #126 is unruled in [^|]*approvals\.json \| blocked by dark star:bagpipes-of-turmoil \(equipment-2265\)/);
    expect(r.out).toContain("1 over-grant line(s) WAITING for the owner's approval of the Ruling-B star, 1 of them lit");
    expect(r.out).not.toMatch(/allowed \[lit\] items\/bagpipes-of-turmoil/);
  });

  it('planted: the star is LIT now (an approval landed) — the entry fails as STALE until the number goes', () => {
    const r = run({
      rows: realRows(BAGPIPES),
      entries: [...base, realEntry(BAGPIPES)],
      ledger: (l) => void (l.lanes.situational = (l.lanes.situational as string[]).filter((id) => id !== 'bagpipes-of-turmoil')),
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/STALE allow entry 3 \(items\/bagpipes-of-turmoil FlatModifier performance\): star:bagpipes-of-turmoil is LIT now/);
  });

  it('planted: no blockedBy, no followUp, a star of ANOTHER record, a file that does not exist — each fails', () => {
    const noBlock = run({ rows: realRows(BAGPIPES), entries: [...base, { ...realEntry(BAGPIPES), blockedBy: undefined }] });
    expect(noBlock.status).toBe(1);
    expect(noBlock.out).toContain('a kept-over-grant entry needs `blockedBy`');
    const noFollow = run({ rows: realRows(BAGPIPES), entries: [...base, { ...realEntry(BAGPIPES), followUp: ' ' }] });
    expect(noFollow.status).toBe(1);
    expect(noFollow.out).toContain('a kept-over-grant entry needs `followUp`');
    const other = run({ rows: realRows(BAGPIPES), entries: [...base, { ...realEntry(BAGPIPES), blockedBy: { gate: ['star:borts-blessing'] } }] });
    expect(other.status).toBe(1);
    expect(other.out).toContain("star:borts-blessing: a star is keyed by the record's own id (star:bagpipes-of-turmoil)");
    const file = run({ rows: realRows(BAGPIPES), entries: [...base, { ...realEntry(BAGPIPES), blockedBy: { files: ['src/rules/no-such-file.ts'] } }] });
    expect(file.status).toBe(1);
    expect(file.out).toContain('blockedBy.files names "src/rules/no-such-file.ts", which is not a file in the repo');
  });

  it('planted: blockedBy, trust or awaitsApproval on a verdict that says the record is RIGHT fails (no half-excused over-grants)', () => {
    const r = run({ entries: [maskEntry({ blockedBy: { files: ['src/rules/build.ts'] } }), pipesEntry()] });
    expect(r.status).toBe(1);
    expect(r.out).toContain('`blockedBy`/`followUp`/`trust`/`awaitsApproval` belong to a kept-over-grant entry — a default-state entry says the record is right, not blocked');
    const t = run({ entries: [maskEntry({ trust: 'lit' }), pipesEntry()] });
    expect(t.status).toBe(1);
    expect(t.out).toContain('`blockedBy`/`followUp`/`trust`/`awaitsApproval` belong to a kept-over-grant entry');
    const w = run({ entries: [maskEntry({ awaitsApproval: 126 }), pipesEntry()] });
    expect(w.status).toBe(1);
    expect(w.out).toContain('`blockedBy`/`followUp`/`trust`/`awaitsApproval` belong to a kept-over-grant entry');
  });

  it("planted: a FILES-only blocker fails (the owner's rule: a known over-grant fails; a fix nobody made is no wait); files BESIDE a dark gate are fine", () => {
    const files = run({ entries: [maskEntry({ verdict: 'kept-over-grant', trust: 'lit', awaitsApproval: 126, blockedBy: { files: ['src/rules/build.ts'] }, followUp: 'Synthetic: gate it in build.ts.' }), pipesEntry()] });
    expect(files.status).toBe(1);
    expect(files.out).toContain("a known over-grant FAILS (the owner's rule, 2026-10-17) — blockedBy names only files (src/rules/build.ts)");
    const beside = run({ rows: realRows(BAGPIPES), entries: [...base, { ...realEntry(BAGPIPES), blockedBy: { gate: ['star:bagpipes-of-turmoil'], files: ['src/rules/build.ts'] } }] });
    expect(beside.status, beside.out).toBe(0);
    expect(beside.out).toContain('blocked by dark star:bagpipes-of-turmoil, src/rules/build.ts (equipment-2265)');
  });

  it('planted: no awaitsApproval, a number that is no desk question, an approval that LANDED, a number disposed as engine — each fails', () => {
    const rows = realRows(BAGPIPES);
    const none = run({ rows, entries: [...base, { ...realEntry(BAGPIPES), awaitsApproval: undefined }] });
    expect(none.status).toBe(1);
    expect(none.out).toContain('a kept-over-grant entry needs `awaitsApproval`');
    const bogus = run({ rows, entries: [...base, { ...realEntry(BAGPIPES), awaitsApproval: 9001.5 }] });
    expect(bogus.status).toBe(1);
    expect(bogus.out).toContain('a kept-over-grant entry needs `awaitsApproval`');
    const unknown = run({ rows, entries: [...base, { ...realEntry(BAGPIPES), awaitsApproval: 4242 }] });
    expect(unknown.status).toBe(1);
    expect(unknown.out).toContain('awaitsApproval #4242 is not a desk number');
    const landed = run({ rows, entries: [...base, realEntry(BAGPIPES)], approvals: { approvals: [{ n: 126, record: BAGPIPES, fields: ['situational'] }], noMechanic: [], engine: [], unruled: [] } });
    expect(landed.status).toBe(1);
    expect(landed.out).toMatch(/STALE allow entry 3 \(items\/bagpipes-of-turmoil FlatModifier performance\): awaitsApproval #126 has LANDED — .* approves items\/bagpipes-of-turmoil \(situational\)/);
    const elsewhere = run({ rows, entries: [...base, realEntry(BAGPIPES)], approvals: { approvals: [{ n: 126, record: 'items/borts-blessing', fields: ['situational'] }], noMechanic: [], engine: [], unruled: [] } });
    expect(elsewhere.status, elsewhere.out).toBe(0);
    expect(elsewhere.out).toContain('ruling #126 is approved in');
    const engine = run({ rows, entries: [...base, realEntry(BAGPIPES)], approvals: { approvals: [], noMechanic: [], engine: [{ n: 126 }], unruled: [] } });
    expect(engine.status).toBe(1);
    expect(engine.out).toContain('awaitsApproval #126 is disposed as engine');
  });

  it('the real Rope Runner entry (record star + mode, both dark) is green, and each going LIT is STALE', () => {
    const rope = run({ rows: realRows(ROPE), entries: [...base, realEntry(ROPE)] });
    expect(rope.status, rope.out).toBe(0);
    expect(rope.out).toContain(waitLine(`[lit] ${ROPE} | BaseSpeed selector climb | own toggle | on speeds.climb | ruling #126 is unruled in `));
    expect(rope.out).toContain('blocked by dark record-star, dark mode:cat-rope-runner (feat-6380)');
    const starLit = run({ rows: realRows(ROPE), entries: [...base, realEntry(ROPE)], ledger: (l) => void (l.records[ROPE] = (l.records[ROPE] || []).filter((p) => p !== 'situational')) });
    expect(starLit.status).toBe(1);
    expect(starLit.out).toContain('record-star is LIT now');
    const modeLit = run({ rows: realRows(ROPE), entries: [...base, realEntry(ROPE)], ledger: (l) => void (l.lanes.modes = (l.lanes.modes as string[]).filter((id) => id !== 'cat-rope-runner')) });
    expect(modeLit.status).toBe(1);
    expect(modeLit.out).toContain('mode:cat-rope-runner is LIT now');
    const foreign = run({ rows: realRows(ROPE), entries: [...base, { ...realEntry(ROPE), blockedBy: { gate: ['record-star', 'mode:item-obsidian-goggles'] } }] });
    expect(foreign.status).toBe(1);
    expect(foreign.out).toContain('mode:item-obsidian-goggles: that mode does not belong to feats/rope-runner');
  });
});

/*
 * 2026-10-17 round 2 (the independent check's blocking finding): an approval that lit a DARK kept over-grant's
 * FIELD (the ledger losing the record's OFF path) rather than its gate left verify green while every sprite got
 * all ten heritage Strikes. The entry records its `trust`, and the live trust state must equal it. Sprite's
 * Spark itself is fixed now; the synthetic Zz Claws (an ungated Claw, its carrier a dark mode) plays the part.
 */
describe('lost-condition-check: a kept over-grant keeps the trust state it was written with', () => {
  const base = [maskEntry(), pipesEntry()];
  const claws = () => ({ rows: CLAWS_ROWS, entries: [...base, clawsEntry()] });
  it('green: a dark kept entry (trust dark, grantedStrikes dark, its mode dark) prints as a dark waiting line', () => {
    const r = run(claws());
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(waitLine(`[dark] ${CLAWS} | Strike selector claw | heritage/ancestry/trait | on grantedStrikes | ruling #126 is unruled in `));
    expect(r.out).toContain(`blocked by dark mode:${CLAWS_MODE} (${CLAWS_PAGE})`);
    expect(r.out).toContain("1 over-grant line(s) WAITING for the owner's approval of the Ruling-B star, 0 of them lit");
  });

  it('planted: an approval lights the field (the ledger drops its OFF path) — "a kept DARK over-grant is LIT now" fails', () => {
    const r = run({ ...claws(), ledger: (l) => void delete l.records[CLAWS] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/allow entry 3 \(feats\/zz-lc-claws Strike claw\): a kept DARK over-grant is LIT now \(grantedStrikes\) — players see the too-broad effect\. Fix it before the approval lands/);
  });

  it('planted: lit in part (only grantedStrikes[0] off) fails as PARTLY LIT', () => {
    const r = run({ ...claws(), ledger: (l) => void (l.records[CLAWS] = ['grantedStrikes[0]']) });
    expect(r.status).toBe(1);
    expect(r.out).toContain('a kept DARK over-grant is PARTLY LIT now (grantedStrikes)');
  });

  it('planted: the gate is lit instead — STALE until the number goes', () => {
    const r = run({ ...claws(), ledger: (l) => void (l.lanes.modes = (l.lanes.modes as string[]).filter((id) => id !== CLAWS_MODE)) });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`mode:${CLAWS_MODE} is LIT now`);
  });

  it('planted: no trust fails; a LIT entry whose field went dark fails as STALE (or it could turn lit again unseen)', () => {
    const none = run({ rows: CLAWS_ROWS, entries: [...base, clawsEntry({ trust: undefined })] });
    expect(none.status).toBe(1);
    expect(none.out).toContain('a kept-over-grant entry needs `trust`');
    const bad = run({ rows: CLAWS_ROWS, entries: [...base, clawsEntry({ trust: 'off' })] });
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('a kept-over-grant entry needs `trust`');
    const darker = run({
      rows: realRows(BAGPIPES),
      entries: [...base, realEntry(BAGPIPES)],
      ledger: (l) => void (l.records[BAGPIPES] = [...(l.records[BAGPIPES] || []), 'passiveEffects.skills.performance']),
    });
    expect(darker.status).toBe(1);
    expect(darker.out).toContain("STALE allow entry 3 (items/bagpipes-of-turmoil FlatModifier performance): trust says lit but the over-granting field is dark now (passiveEffects.skills.performance) — set trust to 'dark'");
  });

  it('every kept-over-grant entry in the real allow file names its trust (matching the fixes lane\'s trustBefore), a dark gate and the approval it waits on', () => {
    const verdicts = JSON.parse(readFileSync(join(ROOT, 'work/lost-condition-verdicts.json'), 'utf8')) as { entries: Entry[] };
    const kept = realAllow.entries.filter((e) => e.verdict === 'kept-over-grant');
    expect(kept.length).toBeGreaterThan(0);
    for (const e of kept) {
      expect(['dark', 'partly', 'lit'], `${e.record}`).toContain(e.trust);
      expect((e.blockedBy as { gate?: string[] })?.gate?.length, `${e.record} waits on a gate`).toBeGreaterThan(0);
      expect(e.awaitsApproval, `${e.record}`).toBe(126);
      const v = verdicts.entries.find((x) => x.record === e.record && x.key === e.key && (x.selector ?? x.type ?? null) === (e.selector ?? e.type ?? null));
      if (v?.trustBefore) expect(e.trust, `${e.record} ${e.key}`).toBe(v.trustBefore);
    }
  });
});

describe('lost-condition-check: a Sense gated on the creature trait (Axe of the Dwarven Lords shape)', () => {
  const row: Row = { r: GOGGLES, k: 'Sense', s: 'greater-darkvision', a: [{ f: 'heritage/ancestry/trait' }] };
  it('planted: an ungated sense is an over-grant; whenCreatureTrait carries it; a second ungated copy still fails', () => {
    const open = run({ rows: [row], plant: (c) => void (c.items['zz-lc-goggles'].passiveEffects = { senses: [{ name: 'greater-darkvision' }] }) });
    expect(open.status).toBe(1);
    expect(open.out).toContain(`OVER-GRANT [lit] ${GOGGLES} | Sense selector greater-darkvision | families: heritage/ancestry/trait | on passiveEffects.senses`);
    const gated = run({ rows: [row], plant: (c) => void (c.items['zz-lc-goggles'].passiveEffects = { senses: [{ name: 'greater-darkvision', whenCreatureTrait: 'dwarf' }] }) });
    expect(gated.status, gated.out).toBe(0);
    const twice = run({
      rows: [row],
      plant: (c) => {
        c.items['zz-lc-goggles'].passiveEffects = { senses: [{ name: 'greater-darkvision', whenCreatureTrait: 'dwarf' }] };
        c.items['zz-lc-goggles'].senses = [{ name: 'greater-darkvision' }];
      },
    });
    expect(twice.status).toBe(1);
    expect(twice.out).toContain(`OVER-GRANT [lit] ${GOGGLES} | Sense selector greater-darkvision | families: heritage/ancestry/trait | on senses`);
  });
});

describe('lost-condition-check: built-in carriers keep what Foundry kept', () => {
  it('a negated own toggle is the default state; a state variant beside its base rule is no over-grant', () => {
    const r = run({
      rows: [
        { r: MASK, k: 'FlatModifier', s: ['performance'], a: [{ f: 'own toggle', n: 1 }] },
        { r: MASK, k: 'FlatModifier', s: ['performance'], a: [{ f: 'own toggle' }, { f: 'self effect/condition' }], bs: 1 },
      ],
    });
    expect(r.status, r.out).toBe(0);
  });

  it('a melee-only selector against a strikeDamage entry for every Strike fails, predicated or not', () => {
    const plant = (c: Core) => void (c.items['zz-lc-goggles'].strikeDamage = [{ type: 'untyped', flat: 2, appliesTo: 'all' }]);
    const row: Row = { r: GOGGLES, k: 'FlatModifier', s: ['melee-strike-damage'], a: [], sc: 'melee' };
    const r = run({ plant, rows: [row] });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`OVER-GRANT [lit] ${GOGGLES} | FlatModifier selector melee-strike-damage | families: melee-only selector | on strikeDamage`);
    const narrowed = run({ plant: (c) => void (c.items['zz-lc-goggles'].strikeDamage = [{ type: 'untyped', flat: 2, appliesTo: 'melee' }]), rows: [row] });
    expect(narrowed.status, narrowed.out).toBe(0);
  });
});

describe.skipIf(!existsSync(PACKS))('lost-condition-check: the snapshot equals the Foundry packs', () => {
  it('planted: a snapshot missing one measured row fails as drift', () => {
    const all = realAllow.snapshot.rows;
    const i = all.findIndex((r) => r.r === 'classFeatures/dense-plating');
    expect(i).toBeGreaterThanOrEqual(0);
    const base = run({ packs: PACKS, entries: realAllow.entries, snapshotRows: all });
    expect(base.out).not.toContain('SNAPSHOT drift');
    const r = run({ packs: PACKS, entries: realAllow.entries, snapshotRows: [...all.slice(0, i), ...all.slice(i + 1)] });
    expect(r.status).toBe(1);
    expect(r.out).toContain('SNAPSHOT drift against the Foundry packs: 1 row(s) measured and not in the snapshot');
    expect(r.out).toContain('"r":"classFeatures/dense-plating"');
  });
});

describe('lost-condition-check: the digest reads a Foundry document into families (scratch packs)', () => {
  it('own toggle / roll option / state variant / nand+or / comparison — written to the snapshot, then judged', () => {
    const d = join(dir, 'digest');
    const packs = join(d, 'packs');
    const doc = (pack: string, name: string, rules: unknown[]) => {
      mkdirSync(join(packs, pack), { recursive: true });
      writeFileSync(join(packs, pack, `${name.toLowerCase().replace(/ /g, '-')}.json`), JSON.stringify({ name, system: { rules } }));
    };
    // the Spurned Lute shape: +1 while "playing" (its own toggle) and -4 under a DIFFERENT roll option
    doc('equipment', 'Zz Lc Lute', [
      { key: 'RollOption', option: 'playing', toggleable: true },
      { key: 'FlatModifier', selector: 'performance', type: 'item', value: 1, predicate: ['playing'] },
      { key: 'FlatModifier', selector: 'performance', type: 'circumstance', value: -4, predicate: ['playing-other-than-zz-lc-lute'] },
    ]);
    // the overdrive shape: [armor] beside [armor, overdrive] — a state variant of the same resistance
    doc('class-features', 'Zz Lc Plating', [
      { key: 'Resistance', type: 'fire', value: 3, predicate: ['armor:id:{actor|flags.system.innovationId}'] },
      { key: 'Resistance', type: 'fire', value: 5, predicate: ['armor:id:{actor|flags.system.innovationId}', { or: ['self:effect:overdrive-success', 'self:effect:overdrive-critical-success'] }] },
    ]);
    doc('feats', 'Zz Lc Claws', [
      { key: 'Strike', label: 'PF2E.Weapon.Base.claw', predicate: [{ nand: ['self:effect:dragon-claws', { or: ['feature:zz-a', 'feature:zz-b'] }] }] },
      { key: 'FlatModifier', selector: 'hp', value: 5, predicate: [{ gte: ['self:level', 5] }] },
    ]);
    const core = realCore();
    core.items['zz-lc-lute'] = { id: 'zz-lc-lute', name: 'Zz Lc Lute', passiveEffects: { skills: { performance: 1 } } };
    core.classFeatures['zz-lc-plating'] = { id: 'zz-lc-plating', name: 'Zz Lc Plating', level: 1, resistances: [{ type: 'fire', value: 3 }], defensesRequire: { armored: true }, whileActive: [{ state: 'overdrive', resistances: [{ type: 'fire', value: 5 }] }] };
    core.feats['zz-lc-claws'] = { id: 'zz-lc-claws', name: 'Zz Lc Claws', level: 4, grantedStrikes: [{ name: 'Claw', die: 'd6', traits: ['unarmed'], group: 'brawling' }], maxHpBonus: { flat: 5 } };
    const paths = { core: join(d, 'core.json'), allow: join(d, 'allow.json'), ledger: join(d, 'ledger.json'), questions: join(d, 'q.json') };
    writeFileSync(paths.core, JSON.stringify(core));
    writeFileSync(paths.allow, JSON.stringify({ _: 'test fixture', entries: [], snapshot: { rows: [] } }));
    writeFileSync(paths.ledger, JSON.stringify(realLedger));
    writeFileSync(paths.questions, JSON.stringify({ open: [] }));
    const env = { ...process.env, CORE_JSON: paths.core, LOST_COND_ALLOW: paths.allow, TRUST_LEDGER: paths.ledger, OWNER_QUESTIONS: paths.questions, AON_MIRROR: join(dir, 'mirror'), FOUNDRY_PACKS: packs, FOUNDRY_INDEX_CACHE: join(d, 'cache', 'idx') };
    const go = (args: string[] = []) => {
      const r = spawnSync(process.execPath, [JITI, CHECK, ...args], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 26 });
      return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
    };
    // an empty snapshot against packs that measure rows is drift
    const drift = go();
    expect(drift.status).toBe(1);
    expect(drift.out).toContain('SNAPSHOT drift against the Foundry packs: 6 row(s) measured and not in the snapshot, 0 in the snapshot and not measured');
    const w = go(['--write-snapshot']);
    expect(w.status, w.out).toBe(0);
    const rows = (JSON.parse(readFileSync(paths.allow, 'utf8')) as { snapshot: { rows: Row[] } }).snapshot.rows;
    expect(rows).toEqual([
      { r: 'classFeatures/zz-lc-plating', k: 'Resistance', s: ['fire'], a: [{ f: 'armor/shield' }, { f: 'self effect/condition', o: 1 }, { f: 'self effect/condition', o: 1 }], bs: 1 },
      { r: 'classFeatures/zz-lc-plating', k: 'Resistance', s: ['fire'], a: [{ f: 'armor/shield' }] },
      { r: 'feats/zz-lc-claws', k: 'FlatModifier', s: ['hp'], a: [{ f: 'self:level', c: 'gte', v: 5 }] },
      { r: 'feats/zz-lc-claws', k: 'Strike', s: 'claw', a: [{ f: 'self effect/condition', n: 1 }, { f: 'feature/class/feat', n: 1, o: 1, x: 'feature:zz-a' }, { f: 'feature/class/feat', n: 1, o: 1, x: 'feature:zz-b' }] },
      { r: 'items/zz-lc-lute', k: 'FlatModifier', s: ['performance'], a: [{ f: 'other roll option' }] },
      { r: 'items/zz-lc-lute', k: 'FlatModifier', s: ['performance'], a: [{ f: 'own toggle' }] }, // NO bs: the -4 is no base rule
    ]);
    const r = go();
    expect(r.status).toBe(1);
    expect(r.out).not.toContain('SNAPSHOT drift');
    const over = r.out.split('\n').filter((l) => l.includes('OVER-GRANT ['));
    expect(over).toEqual([
      // a 4th-level feat carrying Foundry's "self:level >= 5" HP from 4th level
      expect.stringContaining('OVER-GRANT [lit] feats/zz-lc-claws | FlatModifier selector hp | families: self:level | on maxHpBonus'),
      expect.stringContaining('OVER-GRANT [lit] feats/zz-lc-claws | Strike selector claw | families: feature/class/feat, self effect/condition | on grantedStrikes'),
      // the lute's +1 is NOT excused as a state variant of the -4 (a different predicate)
      expect.stringContaining('OVER-GRANT [lit] items/zz-lc-lute | FlatModifier selector performance | families: other roll option, own toggle | on passiveEffects.skills.performance'),
    ]);
    // the plating: defensesRequire carries the armour, and the overdrive rule is a state variant whose
    // value lives in whileActive — no over-grant on either row
    expect(r.out).not.toContain('zz-lc-plating');
  });
});

describe('the shared Foundry pack index (scripts/lib/foundry-rules.mjs)', () => {
  it('atomsOf walks not / nand / or / comparisons', () => {
    const atoms = atomsOf([{ nand: ['self:effect:dragon-claws', { or: ['feature:a', 'feature:b'] }] }, { gte: ['self:level', 7] }, { not: 'target:trait:fiend' }]);
    expect(atoms).toEqual([
      { atom: 'self:effect:dragon-claws', op: 'has', neg: true, inOr: false },
      { atom: 'feature:a', op: 'has', neg: true, inOr: true },
      { atom: 'feature:b', op: 'has', neg: true, inOr: true },
      { atom: 'self:level', op: 'gte', rhs: 7, neg: false, inOr: false },
      { atom: 'target:trait:fiend', op: 'has', neg: true, inOr: false },
    ]);
  });

  it('importerDocs replays the importer ids; the cache is used, and refused once a pack file changes', () => {
    const packs = join(dir, 'packs');
    const cacheDir = join(dir, 'cache', 'idx');
    mkdirSync(join(packs, 'feats', 'general'), { recursive: true });
    mkdirSync(join(packs, 'feats', 'archetype', 'acrobat'), { recursive: true });
    mkdirSync(join(packs, 'actions', 'class'), { recursive: true });
    writeFileSync(join(packs, 'feats', 'general', 'foo.json'), JSON.stringify({ name: 'Foo', system: { rules: [] } }));
    writeFileSync(join(packs, 'feats', 'archetype', 'acrobat', 'foo.json'), JSON.stringify({ name: 'Foo', system: { rules: [{ key: 'Note' }] } }));
    writeFileSync(join(packs, 'actions', 'class', 'rage.json'), JSON.stringify({ name: 'Rage', system: { slug: 'rage', rules: [] } }));
    writeFileSync(join(packs, 'feats', '_folders.json'), JSON.stringify([]));
    const first = loadPackIndex(packs, { cacheDir });
    expect(first?.cached).toBe(false);
    const docs = importerDocs(first);
    expect(docs.map((d: { id: string; bucket: string; alsoBucket?: string }) => `${d.bucket}/${d.id}${d.alsoBucket ? ' +' + d.alsoBucket : ''}`).sort()).toEqual([
      'actions/rage +classFeatures',
      'feats/foo',
      'feats/foo-acrobat',
    ]);
    expect(loadPackIndex(packs, { cacheDir })?.cached).toBe(true);
    writeFileSync(join(packs, 'feats', 'general', 'foo.json'), JSON.stringify({ name: 'Foo', system: { rules: [{ key: 'FlatModifier', selector: 'ac' }] } }));
    const again = loadPackIndex(packs, { cacheDir });
    expect(again?.cached).toBe(false);
    expect(importerDocs(again).find((d: { id: string }) => d.id === 'foo')?.rules).toEqual([{ key: 'FlatModifier', selector: 'ac' }]);
    expect(loadPackIndex(join(dir, 'no-such-packs'))).toBeNull();
  });
});
