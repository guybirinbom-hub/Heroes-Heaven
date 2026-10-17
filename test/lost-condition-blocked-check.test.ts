/*
 * scripts/lost-condition-check.mjs after the blocked lane (2026-10-17): the 21 kept-over-grant lines whose
 * fix only needed files the first lane could not touch are FIXED and their allow entries are gone, so the
 * check must FAIL the moment any of those over-grants comes back — and a known over-grant may no longer be
 * kept for a file at all (the owner's rule: known over-grants fail, lit or dark). The 16 left were tied to
 * the approval they waited on (ruling #126 in scripts/data/trust-approvals.json) — and on 2026-10-17 he gave
 * it (desk #177, 'Yes, stars on (Recommended)', work/desk-answers-2026-10-17.json): their stars are lit,
 * their numbers retired and their entries gone, so the tree waits on nothing and each number planted back
 * FAILS. The kept-entry rules are still proved, on a planted pre-approval copy (one entry, its number back,
 * its star dark).
 *
 * Every case runs the REAL check in a child process on scratch copies (its env overrides), never the tree:
 * the shipped core.json with one thing planted, the REAL allow file (its snapshot is the measured set — no
 * Foundry packs), the real ledger and owner questions, a scratch approvals file or ledger where the case
 * needs one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHILD_TIMEOUT } from './_timeouts';

vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const ROOT = resolve(__dirname, '..');
const JITI = join(ROOT, 'node_modules/jiti/lib/jiti-cli.mjs');
const CHECK = join(ROOT, 'scripts/lost-condition-check.mjs');
type Rec = Record<string, unknown> & { grantedStrikes?: Record<string, unknown>[] };
type Core = Record<string, Record<string, Rec>>;
type Entry = Record<string, unknown>;
const ALLOW = JSON.parse(readFileSync(join(ROOT, 'scripts/data/lost-condition-allow.json'), 'utf8')) as { entries: Entry[]; snapshot: unknown };
const APPROVALS = JSON.parse(readFileSync(join(ROOT, 'scripts/data/trust-approvals.json'), 'utf8')) as Record<string, { n: number; record?: string }[]>;
const CORE_TEXT = readFileSync(join(ROOT, 'public/core.json'), 'utf8');
type Ledger = { records: Record<string, string[]>; lanes: Record<string, unknown> };
const LEDGER = JSON.parse(readFileSync(join(ROOT, 'src/data/trust-ledger.json'), 'utf8')) as Ledger;

let dir = '';
let n = 0;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lost-cond-blocked-'));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function run(fx: { plant?: (c: Core) => void; entries?: (e: Entry[]) => Entry[]; approvals?: (a: typeof APPROVALS) => void; ledger?: (l: Ledger) => void } = {}) {
  const d = join(dir, `case-${++n}`);
  mkdirSync(d);
  const env: NodeJS.ProcessEnv = { ...process.env, FOUNDRY_PACKS: join(d, 'no-packs') };
  if (fx.plant) {
    const core = JSON.parse(CORE_TEXT) as Core;
    fx.plant(core);
    writeFileSync((env.CORE_JSON = join(d, 'core.json')), JSON.stringify(core));
  }
  if (fx.entries) writeFileSync((env.LOST_COND_ALLOW = join(d, 'allow.json')), JSON.stringify({ ...ALLOW, entries: fx.entries(structuredClone(ALLOW.entries)) }));
  if (fx.approvals) {
    const a = structuredClone(APPROVALS);
    fx.approvals(a);
    writeFileSync((env.TRUST_APPROVALS = join(d, 'approvals.json')), JSON.stringify(a));
  }
  if (fx.ledger) {
    const l = structuredClone(LEDGER);
    fx.ledger(l);
    writeFileSync((env.TRUST_LEDGER = join(d, 'ledger.json')), JSON.stringify(l));
  }
  const r = spawnSync(process.execPath, [JITI, CHECK], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const strikesOf = (c: Core, id: string) => c.feats[id].grantedStrikes as Record<string, unknown>[];
const BAGPIPES = 'items/bagpipes-of-turmoil';

/*
 * THE SIXTEEN desk #177 approved (2026-10-17), each with the too-broad number it carried until then and the
 * Foundry counterpart the check names it by. Print, per record: scripts/data/trust-approvals.json's #177 rows
 * (e.g. equipment-2314-2161 "+1 item bonus to visual Perception checks", feat-6380 "but only when climbing
 * ropes and similar objects").
 */
const SIXTEEN: { record: string; old: Record<string, unknown>; line: string }[] = [
  { record: 'items/bagpipes-of-turmoil', old: { passiveEffects: { skills: { performance: 1 } } }, line: 'FlatModifier selector performance' },
  { record: 'items/borts-blessing', old: { passiveEffects: { skills: { diplomacy: 1 } } }, line: 'FlatModifier selector diplomacy' },
  { record: 'items/clarity-goggles-greater', old: { passiveEffects: { perception: 3 } }, line: 'FlatModifier selector perception' },
  { record: 'items/day-goggles', old: { passiveEffects: { perception: -2 } }, line: 'FlatModifier selector perception' },
  { record: 'items/eye-slash-greater', old: { passiveEffects: { perception: 1, senses: [{ name: 'see four times farther than normal' }] } }, line: 'FlatModifier selector perception' },
  { record: 'items/eye-slash-major', old: { passiveEffects: { perception: 2, senses: [{ name: 'see four times farther than normal' }] } }, line: 'FlatModifier selector perception' },
  { record: 'items/eye-slash-true', old: { passiveEffects: { perception: 3, senses: [{ name: 'see four times farther than normal' }] } }, line: 'FlatModifier selector perception' },
  { record: 'items/holy-chain', old: { passiveEffects: { skills: { diplomacy: 2 } } }, line: 'FlatModifier selector diplomacy' },
  { record: 'items/mirror-goggles-lesser', old: { passiveEffects: { perception: 1 } }, line: 'FlatModifier selector perception,saving-throw' },
  { record: 'items/persona-mask', old: { passiveEffects: { skills: { performance: 1 } } }, line: 'FlatModifier selector performance' },
  { record: 'items/persona-mask-greater', old: { passiveEffects: { skills: { performance: 2 } } }, line: 'FlatModifier selector performance' },
  { record: 'items/razmiri-wayfinder', old: { passiveEffects: { skills: { deception: 1 } } }, line: 'FlatModifier selector deception' },
  { record: 'items/resonant-guitar', old: { passiveEffects: { skills: { performance: 2 } } }, line: 'FlatModifier selector performance' },
  { record: 'items/shining-hackle', old: { passiveEffects: { skills: { stealth: -1 }, perception: 1 } }, line: 'FlatModifier selector perception' },
  { record: 'items/wardrobe-stone-greater', old: { passiveEffects: { perception: 3 } }, line: 'FlatModifier selector perception' },
  { record: 'feats/rope-runner', old: { speeds: { climb: 15 } }, line: 'BaseSpeed selector climb' },
];
const plantOld = (c: Core, which = SIXTEEN) => {
  for (const s of which) {
    const [bucket, id] = s.record.split('/');
    Object.assign(c[bucket][id], structuredClone(s.old));
  }
};

describe('lost-condition-check: green on the tree, and nothing waits on the owner any more', () => {
  it('exit 0; no kept line — desk #177 approved the sixteen Ruling-B stars on 2026-10-17 ("Yes, stars on (Recommended)")', () => {
    const r = run();
    expect(r.status, r.out).toBe(0);
    expect(r.out.split('\n').filter((l) => l.includes("WARN waiting for the owner's approval of the Ruling-B star"))).toEqual([]);
    expect(r.out).toContain("0 waiting for the owner's approval");
    expect(ALLOW.entries.filter((e) => e.verdict === 'kept-over-grant')).toEqual([]);
    for (const s of SIXTEEN) expect(r.out, s.record).not.toMatch(new RegExp(`(WARN|allowed|OVER-GRANT).*${s.record.replace('/', '\\/')} \\|`));
    // nothing is kept for a FILE any more, and none of the fixed records is excused
    expect(r.out).not.toMatch(/blocked by (src|test)\//);
    for (const rec of ['fey-ascension', 'fang-sharpener', 'sprites-spark', 'morphic-strike', 'brooch-of-inspiration', 'obsidian-goggles']) expect(r.out).not.toMatch(new RegExp(`(WARN|allowed).*\\b${rec}`));
  });

  it('the sixteen stars are lit in the shipped ledger, and their numbers are gone from core.json', () => {
    const core = JSON.parse(CORE_TEXT) as Core;
    const sit = LEDGER.lanes.situational as string[];
    for (const s of SIXTEEN) {
      const [bucket, id] = s.record.split('/');
      if (bucket === 'items') expect(sit, `${id}: its star is off the suppressed list`).not.toContain(id);
      for (const [field, value] of Object.entries(s.old)) {
        const now = core[bucket][id][field] as Record<string, unknown> | undefined;
        if (field === 'passiveEffects') {
          expect(now?.perception, `${id} perception`).toBeUndefined();
          for (const k of Object.keys((value as { skills?: object }).skills ?? {})) if (k !== 'stealth') expect((now?.skills as Record<string, unknown> | undefined)?.[k], `${id} ${k}`).toBeUndefined();
        } else expect(now, `${id} ${field}`).toBeUndefined();
      }
    }
    expect(core.items['shining-hackle'].passiveEffects, 'its printed -1 Stealth stays a number').toEqual({ skills: { stealth: -1 } });
    expect(LEDGER.records['feats/rope-runner'], "Rope Runner's own star is on").toBeUndefined();
    expect(LEDGER.lanes.modes as string[], 'modes/cat-rope-runner is on').not.toContain('cat-rope-runner');
  });
});

describe('lost-condition-check: an approved number that comes back FAILS (its star is lit, no entry excuses it)', () => {
  it('planted: each of the sixteen numbers put back — every one is an OVER-GRANT', () => {
    const r = run({ plant: (c) => plantOld(c) });
    expect(r.status).toBe(1);
    for (const s of SIXTEEN) expect(r.out, s.record).toMatch(new RegExp(`OVER-GRANT \\[\\w+\\] ${s.record.replace('/', '\\/')} \\| ${s.line}`));
  });
});

describe('lost-condition-check: a fixed over-grant that comes back FAILS (no allow entry excuses it)', () => {
  it('planted: the four granted-Strike gates taken off again — every counterpart is an OVER-GRANT', () => {
    const r = run({
      plant: (c) => {
        delete strikesOf(c, 'fey-ascension')[0].choiceValue; // (1) feat-4048: the Leaves for every branch
        delete strikesOf(c, 'fang-sharpener')[0].whenHeritage; // (2) feat-1000: the irongut Jaws for any goblin
        for (const g of strikesOf(c, 'sprites-spark')) delete g.whenHeritage; // feat-2635: all ten sparks
        for (const g of strikesOf(c, 'morphic-strike')) delete g.whenHeritage; // feat-6991: all twelve strikes
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('OVER-GRANT [lit] feats/fey-ascension | Strike selector leaves | families: other roll option | on grantedStrikes');
    expect(r.out).toContain('OVER-GRANT [dark] feats/fang-sharpener | Strike selector jaws | families: heritage/ancestry/trait | on grantedStrikes');
    for (const s of ['draxie', 'luminoussprite', 'grig', 'melixie', 'nyktera', 'pixie', 'dijiang', 'gandharva', 'kanchil', 'leungli'])
      expect(r.out).toContain(`OVER-GRANT [dark] feats/sprites-spark | Strike selector ${s} | families: heritage/ancestry/trait`);
    for (const s of ['claw', 'spirittouch', 'strikingsurface', 'root']) expect(r.out).toContain(`OVER-GRANT [dark] feats/morphic-strike | Strike selector ${s} | families: heritage/ancestry/trait`);
  });

  it("planted: Morphic Strike's elemental current without the cantrip gate — the first element wins every yaoguai again", () => {
    const r = run({ plant: (c) => strikesOf(c, 'morphic-strike').forEach((g) => void delete g.whenHeritageChoice) });
    expect(r.status).toBe(1);
    expect(r.out).toContain('OVER-GRANT [dark] feats/morphic-strike | Strike selector elementalcurrent | families: other roll option | on grantedStrikes');
  });

  it('planted: (3) the flat Lore bonus back on the Brooch of Inspiration grades; (4) the passive darkvision back on the Obsidian Goggles', () => {
    const r = run({
      plant: (c) => {
        c.items['brooch-of-inspiration'].passiveEffects = { loreBonus: 1 }; // equipment-1434: Recall Knowledge only
        c.items['brooch-of-inspiration-greater'].passiveEffects = { loreBonus: 2 };
        c.items['obsidian-goggles-greater'].passiveEffects = { senses: [{ name: 'darkvision' }] }; // equipment-3097-3040: the activation's
        c.items['obsidian-goggles-major'].passiveEffects = { senses: [{ name: 'greater-darkvision' }] };
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/OVER-GRANT \[\w+\] items\/brooch-of-inspiration \| FlatModifier selector lore-skill-check \| families: roll context \| on passiveEffects\.loreBonus/);
    expect(r.out).toMatch(/OVER-GRANT \[\w+\] items\/brooch-of-inspiration-greater \| FlatModifier selector lore-skill-check/);
    expect(r.out).toMatch(/OVER-GRANT \[\w+\] items\/obsidian-goggles-greater \| Sense selector darkvision \| families: own toggle \| on passiveEffects\.senses/);
    expect(r.out).toMatch(/OVER-GRANT \[\w+\] items\/obsidian-goggles-major \| Sense selector greater-darkvision \| families: own toggle/);
  });
});

describe('lost-condition-check: a heritage gate that reaches nobody fails (DEAD GATE)', () => {
  it('planted: a whenHeritage naming no heritage, a whenHeritageChoice no heritage offers', () => {
    const r = run({
      plant: (c) => {
        strikesOf(c, 'fang-sharpener')[0].whenHeritage = ['irongut-gobiln'];
        strikesOf(c, 'morphic-strike')[2].whenHeritageChoice = 'electric-ark';
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('DEAD GATE feats/fang-sharpener grantedStrikes[0] (Jaws): whenHeritage names irongut-gobiln, which is not a heritage in core.json');
    expect(r.out).toContain('DEAD GATE feats/morphic-strike grantedStrikes[2] (Elemental Current): whenHeritageChoice "electric-ark" is no answer born-of-elements offers');
    // a dead gate carries nothing, so the over-grant it was meant to stop is reported too
    expect(r.out).toContain('OVER-GRANT [dark] feats/fang-sharpener | Strike selector jaws | families: heritage/ancestry/trait');
  });
});

describe('lost-condition-check: only a wait on the OWNER keeps an over-grant', () => {
  const fileOnly: Entry = {
    record: 'feats/fang-sharpener',
    key: 'Strike',
    selector: 'jaws',
    families: ['heritage/ancestry/trait'],
    verdict: 'kept-over-grant',
    trust: 'dark',
    aonId: 'feat-1000',
    quote: "If you're an irongut goblin, you gain a jaws unarmed attack that deals 1d4 piercing damage",
    why: 'Planted: the shape the first lane used, kept because a file blocked the fix.',
    blockedBy: { files: ['src/rules/build.ts'] },
    followUp: 'Gate it in collectGrantedNaturals.',
  };
  it('planted: a kept entry blocked by a FILE alone fails — a fix nobody made is not a wait', () => {
    const r = run({ plant: (c) => void delete strikesOf(c, 'fang-sharpener')[0].whenHeritage, entries: (e) => [...e, fileOnly] });
    expect(r.status).toBe(1);
    expect(r.out).toContain("a known over-grant FAILS (the owner's rule, 2026-10-17) — blockedBy names only files (src/rules/build.ts)");
  });

  /*
   * The world BEFORE desk #177's approval, planted in scratch copies: Bagpipes of Turmoil's +1 back on the record,
   * its star back on the suppressed list, and its kept entry as the real allow file held it until 2026-10-17
   * (waiting on ruling #126, which the real approvals file still holds in `unruled` as an authorised exception).
   */
  const keptBagpipes = (over: Entry = {}): Entry => ({
    record: BAGPIPES,
    key: 'FlatModifier',
    selector: 'performance',
    families: ['own toggle'],
    verdict: 'kept-over-grant',
    trust: 'lit',
    awaitsApproval: 126,
    aonId: 'equipment-2265',
    quote: 'While playing the bagpipes, you gain a +1 item bonus to Performance checks',
    why: 'Planted: the pre-approval kept entry (a real over-grant, its star dark).',
    blockedBy: { gate: ['star:bagpipes-of-turmoil'] },
    followUp: 'Light the star, then retire passiveEffects.skills.performance with one overlay row, then remove this entry.',
    ...over,
  });
  const preApproval = (over: Entry = {}) => ({
    plant: (c: Core) => plantOld(c, SIXTEEN.filter((s) => s.record === BAGPIPES)),
    ledger: (l: Ledger) => void (l.lanes.situational = [...(l.lanes.situational as string[]), 'bagpipes-of-turmoil']),
    entries: (e: Entry[]) => [...e, keptBagpipes(over)],
  });

  it('green: the planted pre-approval entry is a wait on the owner — exit 0, one waiting line tied to ruling #126', () => {
    const r = run(preApproval());
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/WARN waiting for the owner's approval of the Ruling-B star \[lit\] items\/bagpipes-of-turmoil \| FlatModifier selector performance \| own toggle \| on passiveEffects\.skills\.performance \| ruling #126 is unruled in .*trust-approvals\.json \| blocked by dark star:bagpipes-of-turmoil/);
    // …and the same planted number with NO entry is a plain over-grant
    const bare = run({ plant: preApproval().plant, ledger: preApproval().ledger });
    expect(bare.status).toBe(1);
    expect(bare.out).toContain('OVER-GRANT [lit] items/bagpipes-of-turmoil | FlatModifier selector performance | families: own toggle');
  });

  it('planted: a kept entry with no awaitsApproval, or a number that is no desk question, fails', () => {
    const none = run(preApproval({ awaitsApproval: undefined }));
    expect(none.status).toBe(1);
    expect(none.out).toContain('a kept-over-grant entry needs `awaitsApproval`');
    const bogus = run(preApproval({ awaitsApproval: 99999 }));
    expect(bogus.status).toBe(1);
    expect(bogus.out).toContain('awaitsApproval #99999 is not a desk number');
  });

  it('planted: the approval LANDED for the record — STALE until the ledger is re-stamped and the number retired', () => {
    const r = run({
      ...preApproval(),
      approvals: (a) => {
        a.unruled = a.unruled.filter((x) => x.n !== 126);
        a.approvals.push({ n: 126, record: BAGPIPES, fields: ['situational'], why: 'planted' } as never);
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/STALE allow entry \d+ \(items\/bagpipes-of-turmoil FlatModifier performance\): awaitsApproval #126 has LANDED/);
  });

  it('planted: #126 disposed as noMechanic — no approval can come through it, so nothing is waited on', () => {
    const r = run({
      ...preApproval(),
      approvals: (a) => {
        a.unruled = a.unruled.filter((x) => x.n !== 126);
        a.noMechanic.push({ n: 126, why: 'planted' } as never);
      },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('awaitsApproval #126 is disposed as noMechanic');
  });

  it('planted: the real tree (star LIT) with the old entry put back — STALE, the approval has landed', () => {
    const r = run({ plant: preApproval().plant, entries: preApproval().entries });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/STALE allow entry \d+ \(items\/bagpipes-of-turmoil FlatModifier performance\): star:bagpipes-of-turmoil is LIT now/);
  });
});
