import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { applyTrustGate, clearTrustGate, TRUST_LEDGER } from '../src/data/trustGate';
import { buildCharacter, CLASS_TRAINING_CLAUSE_FEATURES, classTrainingClauseOptions, skillOrderLegacyOf } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';
import { content } from './_content';
import {
  SKILL_ORDER_CASES,
  SKILL_ORDER_READER_CASES,
  SKILL_ORDER_WPS,
  mk,
  observe,
  unresolvedIds,
  type SkillOrderCase,
  type SkillOrderExpect,
} from './fixtures/skill-order-cases';

/**
 * SKILL RANKS LEVEL BY LEVEL — THE GUARD (plan work/skill-rank-level-by-level/plan.md, WP0 step 4; guard G1).
 *
 * Every case in test/fixtures/skill-order-cases.ts, one test per case and expect group. A case the engine gets
 * wrong today names the work package that fixes it (`flips`); each of its groups that differs from today runs
 * as `it.fails` until that package flips the case (sets `flips: null`, deletes `today`), so:
 *   - a package that fixes a case without flipping it turns the run red (the `it.fails` starts passing);
 *   - a flipped case that breaks again turns it red (a plain `it`).
 * `it.fails` is green for ANY throw, so every flipping case also has a plain PREMISE test (D17): every id it
 * names resolves in content, the build does not throw, and today's exact values hold. That is what proves each
 * `it.fails` fails for the reason the findings give, not a renamed id.
 * Synthetic characters only.
 *
 * The app runs with the trust gate ON by default (src/data/trustGate.ts `trustGateOn`), so the cases also run
 * at gate on (G1-on, the last describe): every group must give the gate-off result, except the EXACT list
 * GATE_ON_KNOWN below, where an untrusted lane of the trust ledger darkens part of a record.
 */

const db = content();
type Group = keyof SkillOrderExpect;
type Gate = 'off' | 'on';
const GROUPS: Group[] = ['skills', 'fallbacks', 'fallbacksLack', 'featsHave', 'featsLack', 'grantedSkillsLack', 'storedAnswers', 'increases'];
/** Groups whose value is "the named tokens that hold" (observe filters the shape's own tokens). */
const TOKEN_GROUPS = ['fallbacksLack', 'featsHave', 'featsLack', 'grantedSkillsLack'] as const;
const J = (v: unknown) => JSON.stringify(v);
/**
 * Run `fn` with the trust gate's three code-side lanes (situational, engine, feat grants) set for `gate`, and
 * cleared after: applyTrustGate writes them globally, so a build must never inherit the other gate's lanes
 * (scripts/blocks-parity-snapshot.mjs `setGate` does the same). The lanes come from the ledger alone, so
 * applying the gate to the ungated db only to set them is exact; its returned copy is dropped.
 */
function atGate<T>(gate: Gate, fn: () => T): T {
  if (gate === 'on') applyTrustGate(db);
  else clearTrustGate();
  try {
    return fn();
  } finally {
    clearTrustGate();
  }
}
let dbOnCache: ContentDatabase | null = null;
const dbOn = (): ContentDatabase => {
  if (!dbOnCache) {
    dbOnCache = content({ trustGate: true });
    clearTrustGate(); // content() leaves the gate-on lanes set
  }
  return dbOnCache;
};
const dbAt = (gate: Gate) => (gate === 'on' ? dbOn() : db);
const caches: Record<Gate, Map<string, Character>> = { off: new Map(), on: new Map() };
const charAt = (c: SkillOrderCase, gate: Gate): Character => {
  let ch = caches[gate].get(c.id);
  if (!ch) {
    const d = dbAt(gate); // loaded OUTSIDE atGate: the first gated load clears the lanes it set
    caches[gate].set(c.id, (ch = atGate(gate, () => buildCharacter(c.build, d))));
  }
  return ch;
};
const charOf = (c: SkillOrderCase): Character => charAt(c, 'off');
/** What group `g` of case `c` shows at `gate` (observe itself may run the engine: storedAnswers' stamp path). */
const observeAt = (c: SkillOrderCase, g: Group, gate: Gate): unknown => {
  const ch = charAt(c, gate);
  const d = dbAt(gate);
  return atGate(gate, () => observe({ [g]: c.expect[g] } as SkillOrderExpect, ch, c.build, d)[g]);
};
afterAll(() => clearTrustGate());
/** Does group `g` of case `c` run as `it.fails` today? */
const failsToday = (c: SkillOrderCase, g: Group) => !!c.flips && J(c.today?.[g]) !== J(c.expect[g]);

describe('skill ranks level by level: every findings case gives the print result (G1)', () => {
  for (const c of SKILL_ORDER_CASES.filter((x) => !x.reverse)) {
    for (const g of GROUPS) {
      if (c.expect[g] === undefined) continue;
      const fails = failsToday(c, g);
      (fails ? it.fails : it)(`${c.id} ${g}: ${c.title}${fails ? ` [fails until ${c.flips}]` : ''}`, () => {
        expect(observeAt(c, g, 'off'), `${c.id} ${g} (${c.print})`).toEqual(c.expect[g]);
      });
    }
  }
});

/**
 * The premise shape: `today`, with every token group widened to the tokens of `expect` AND `today`. observe
 * reports the named tokens that hold, so a token group of `today` alone is vacuous (`featsLack: []` observed
 * with no tokens is always `[]`); widened, `today: []` really says "none of expect's tokens holds today".
 */
function premiseShape(c: SkillOrderCase): SkillOrderExpect {
  const shape: SkillOrderExpect = { ...c.today };
  for (const g of TOKEN_GROUPS) {
    if (c.today?.[g] === undefined) continue;
    shape[g] = [...new Set([...(c.expect[g] ?? []), ...c.today[g]!])];
  }
  return shape;
}
const sortTokens = (e: SkillOrderExpect): SkillOrderExpect => {
  const out: SkillOrderExpect = { ...e };
  for (const g of TOKEN_GROUPS) if (out[g]) out[g] = [...out[g]!].sort();
  return out;
};

describe("the premise of every flipping case holds on today's engine (D17)", () => {
  // skill-order WP9: K1sa was the last flipping case, so the loop below makes no test; this one pins that nothing
  // still waits on a package (a case given `flips` again turns it red and gets its premise test back).
  it('no case still waits on a work package (all flipped by WP9)', () => {
    expect(SKILL_ORDER_CASES.filter((x) => x.flips).map((x) => x.id)).toEqual([]);
  });
  for (const c of SKILL_ORDER_CASES.filter((x) => !x.reverse && x.flips)) {
    it(`${c.id}: ids resolve, the build runs, every slot pick is taken, today's values hold`, () => {
      expect(unresolvedIds(c, db), `${c.id} names records content lacks`).toEqual([]);
      expect(() => charOf(c)).not.toThrow();
      // Every slot pick is a feat row of its own (not a granted one) at the slot's level: a case whose feat
      // never lands would otherwise show today's values for the wrong reason (today's bug swallows the feat's
      // training, so "today" equals the feat-less character).
      const notTaken = Object.entries(c.build.featPicks ?? {})
        .filter(([key, id]) => !charOf(c).feats.some((f) => f.featId === id && !f.grantedBy && f.level === Number(key.split(':')[0])))
        .map(([key, id]) => `${key}=${id}`);
      expect(notTaken, `${c.id} slot picks that are not taken`).toEqual([]);
      const got = atGate('off', () => observe(premiseShape(c), charOf(c), c.build, db));
      expect(sortTokens(got)).toEqual(sortTokens(c.today!));
    });
  }
});

describe('the case list itself (meta)', () => {
  const all = [...SKILL_ORDER_CASES, ...SKILL_ORDER_READER_CASES];
  const byId = new Map(all.map((c) => [c.id, c]));

  it('case ids are unique', () => {
    expect(byId.size).toBe(all.length);
  });
  it('every finding 1-9 has a case', () => {
    const have = new Set(all.map((c) => c.finding));
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !have.has(n as never))).toEqual([]);
  });
  it('a case with no finding is a Dual Class or Free Archetype case', () => {
    expect(all.filter((c) => c.finding === null && c.tag !== 'DC' && c.tag !== 'FA').map((c) => c.id)).toEqual([]);
  });
  it("every 'before' case names an existing 'after' twin, and every 'same' case names an existing twin", () => {
    const bad: string[] = [];
    for (const c of all) {
      if (c.dir === 'before' && byId.get(c.twin ?? '')?.dir !== 'after') bad.push(`${c.id} → ${c.twin}`);
      if (c.dir === 'same' && !byId.get(c.twin ?? '')) bad.push(`${c.id} → ${c.twin}`);
    }
    expect(bad).toEqual([]);
  });
  it('the DC, FA, D5, OV, RB and P groups each have a case', () => {
    const tags = new Set(all.map((c) => c.tag));
    expect(['DC', 'FA', 'D5', 'OV', 'RB', 'P'].filter((t) => !tags.has(t as never))).toEqual([]);
  });
  it('every reader case that proves a LATER source is not counted has a twin proving an EARLIER one is', () => {
    const bad = SKILL_ORDER_READER_CASES.filter((c) => c.lower && (!c.twin || !byId.get(c.twin) || (byId.get(c.twin) as { lower?: true }).lower));
    expect(bad.map((c) => c.id)).toEqual([]);
  });
  it('every flips names a work package of the plan; reader cases flip in WP7', () => {
    expect(SKILL_ORDER_CASES.filter((c) => c.flips && !SKILL_ORDER_WPS.includes(c.flips)).map((c) => c.id)).toEqual([]);
    expect(SKILL_ORDER_READER_CASES.filter((c) => c.flips && c.flips !== 'WP7').map((c) => c.id)).toEqual([]);
  });
  it('every case with flips has today, and none without', () => {
    expect(all.filter((c) => !!c.flips !== (c.today !== undefined)).map((c) => c.id)).toEqual([]);
  });
  it("a flipping build case's today names the same groups as its expect, and at least one differs", () => {
    const bad: string[] = [];
    for (const c of SKILL_ORDER_CASES.filter((x) => x.flips)) {
      const eg = GROUPS.filter((g) => c.expect[g] !== undefined);
      const tg = GROUPS.filter((g) => c.today![g] !== undefined);
      if (J(eg) !== J(tg)) bad.push(`${c.id}: groups ${eg} vs ${tg}`);
      else if (!eg.some((g) => failsToday(c, g))) bad.push(`${c.id}: today equals expect`);
    }
    expect(bad).toEqual([]);
  });
});

/*
 * WP5 (plan D14): a class training above 1st level owes a replacement skill only where its own text — or the text
 * of the feature that asks the question — prints "already trained → a different skill". The evidence file lists
 * every class option and class feature that trains a skill above 1st level with the clause it prints ("—" for
 * none); the judged set in src/rules/build.ts must be exactly its clause rows.
 */
describe('WP5: the class trainings that owe a replacement (plan D14)', () => {
  const EVIDENCE = 'work/skill-rank-level-by-level/wp5-class-trainings.md';
  /** The first column of every table row in the section headed `## <heading…>` of the evidence file. */
  const idsUnder = (heading: string): string[] => {
    const text = readFileSync(EVIDENCE, 'utf8').replace(/\r\n/g, '\n');
    const start = text.indexOf(`\n## ${heading}`);
    if (start < 0) throw new Error(`${EVIDENCE}: no section "## ${heading}"`);
    const end = text.indexOf('\n## ', start + 1);
    return text
      .slice(start, end < 0 ? undefined : end)
      .split('\n')
      .filter((l) => /^\| [a-z0-9]/.test(l))
      .map((l) => l.split('|')[1].trim())
      .filter((id) => id !== 'id'); // the header row
  };
  it("the judged options are exactly the evidence file's clause rows", () => {
    const judged = classTrainingClauseOptions(db).map((o) => o.optionId).sort();
    expect(judged.length, 'the evidence has judged rows').toBeGreaterThan(0);
    expect(judged).toEqual(idsUnder('Judged').sort());
    expect(judged.filter((id) => idsUnder('Not judged').includes(id))).toEqual([]);
  });
  it('every clause feature prints the clause in its own text', () => {
    const bad = [...CLASS_TRAINING_CLAUSE_FEATURES].filter((f) => !/already trained in the granted skill, you become trained in a different skill of your choice/i.test(db.classFeatures[f]?.description ?? ''));
    expect(bad).toEqual([]);
  });
  it("the live path stays today's: a background-trained Athletics owes The Brave's replacement in print only", () => {
    // Laborer trains Athletics at 1st, so the epithet at 3rd is redundant in print (A6e's shape), AND the skill is
    // already trained where today's engine wrote the epithet (the creation block, after the background) — the one
    // place a judge without the `print` guard would also owe it on the live path, which must stay today's (G11).
    const ch = buildCharacter(mk({ classId: 'exemplar', ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'laborer', level: 3, extraChoices: { 'root-epithet': ['the-brave'] } }), db);
    expect((ch.skillFallbacks ?? []).map((f) => `${f.featId}:${f.skill}`)).toEqual(['the-brave:athletics']);
    const legacy = skillOrderLegacyOf(ch);
    expect(legacy?.skillFallbacks ?? null, "today's engine owes nothing").toEqual([]);
    expect(legacy?.skills.athletics).toBe('trained');
  });
  it('no judged option id is a feat or background id (its answer key `<id>:fallback:<skill>` has no prefix)', () => {
    expect(classTrainingClauseOptions(db).filter((o) => db.feats[o.optionId] || db.backgrounds[o.optionId]).map((o) => o.optionId)).toEqual([]);
  });
});

/*
 * G1 AT GATE ON (the app's default). Every group of every build case gives the same result at gate on as at gate
 * off, except these: an untrusted lane of the trust ledger (src/data/trust-ledger.json) darkens part of a record,
 * so at gate on the record does less than print. They are NOT skill-order defects: the gate turns off the feat's
 * own "a skill of your choice instead" (featGrants lane `choice`) or the heritage's skill grant, whatever the order.
 * Measured 2026-10-22 on main (6f59895). The list is EXACT both ways:
 *   - a group listed here must show this gate-on value AND differ from its gate-off value; when a WP moves the
 *     gate-off value onto it (K1 fallbacks after WP3), or the ledger starts trusting the lane, the entry is stale
 *     and the run is red until the WP removes it — so every WP sees its gate-on result move;
 *   - a group not listed must equal gate off, so a WP that fixes a case at one gate only is red.
 * `lane` names the ledger entry that darkens it ("featGrants:<feat>:<path>" or "records:<bucket>/<id>:<path>").
 * Whether these lanes should be trusted is a data question for chat-todo.md, not this job.
 */
const KHOLO = 'featGrants:kholo-lore:choice';
const ASH = 'records:heritages/ancient-ash:effectChoices[].options[].grant.skills';
const SHISK = 'records:heritages/lorekeeper-shisk:effectChoices[].options[].grant.skills';
/* skill-order WP3: the print pass moved gate off onto gate on for K1 / K1s / K4 (fallbacks: none owed once the feat
 * comes first) and V2 (fallbacks), so their entries went; and it moved gate off AWAY from gate on where the darkened
 * heritage grant or the darkened "instead" is what print now reads first: AA3, AA7 (Ancient Ash's Stealth), LS1,
 * LS2, LL1 (Lorekeeper Shisk's Society), AD1 (Alchemist Dedication's replacement, owed from WP3) — added. */
const GATE_ON_KNOWN: Record<string, Partial<Record<Group, { on: unknown; lane: string }>>> = {
  K2: { fallbacks: { on: [], lane: KHOLO } },
  K3: { fallbacks: { on: [], lane: KHOLO } },
  K4b: { fallbacks: { on: [], lane: KHOLO } },
  OV2: { fallbacks: { on: [], lane: KHOLO } },
  OV3: { fallbacks: { on: [], lane: KHOLO } },
  AA3: { skills: { on: { stealth: 'trained' }, lane: ASH } }, // skill-order WP3: AA3
  AA5: { skills: { on: { stealth: 'trained' }, lane: ASH } },
  AA7: { skills: { on: { stealth: 'expert' }, lane: ASH } }, // skill-order WP3: AA7
  AA7b: { skills: { on: { stealth: 'trained' }, lane: ASH } },
  LS1: { skills: { on: { society: 'trained' }, lane: SHISK } }, // skill-order WP3: LS1
  LS2: { skills: { on: { society: 'trained' }, lane: SHISK } }, // skill-order WP3: LS2
  LL1: { skills: { on: { society: 'expert', 'lore:sailing': 'untrained' }, lane: SHISK } }, // skill-order WP3: LL1
  AD1: { fallbacks: { on: [], lane: 'featGrants:alchemist-dedication:choice' } }, // skill-order WP3: AD1
  AD2: { fallbacks: { on: [], lane: 'featGrants:alchemist-dedication:choice' } },
  AD3: { fallbacks: { on: [], lane: 'featGrants:alchemist-dedication:choice' } },
  V1: { fallbacks: { on: [], lane: 'featGrants:vandal:choice' } },
  SN1: { fallbacks: { on: [], lane: 'featGrants:snare-setter:choice' } },
  SN2: { fallbacks: { on: [], lane: 'featGrants:snare-setter:choice' } },
};
/** Does the trust ledger really darken `lane`? */
function laneInLedger(lane: string): boolean {
  const m = /^(featGrants|records):([^:]+):(.+)$/.exec(lane);
  if (!m) return false;
  const paths = m[1] === 'featGrants' ? TRUST_LEDGER.lanes.featGrants?.[m[2]] : TRUST_LEDGER.records[m[2]];
  return !!paths?.includes(m[3]);
}

describe('G1 at gate on (the app default): every case gives the gate-off result, except the exact GATE_ON_KNOWN list', () => {
  for (const c of SKILL_ORDER_CASES.filter((x) => !x.reverse)) {
    for (const g of GROUPS) {
      if (c.expect[g] === undefined) continue;
      const known = GATE_ON_KNOWN[c.id]?.[g];
      it(`${c.id} ${g} at gate on${known ? ` [known: ${known.lane}]` : ''}`, () => {
        const off = observeAt(c, g, 'off');
        const on = observeAt(c, g, 'on');
        if (!known) {
          expect(on, `${c.id} ${g}: gate on differs from gate off`).toEqual(off);
          return;
        }
        expect(on, `${c.id} ${g}: the known gate-on value`).toEqual(known.on);
        expect(on, `${c.id} ${g}: gate on now equals gate off; remove its GATE_ON_KNOWN entry`).not.toEqual(off);
      });
    }
  }
  it('every GATE_ON_KNOWN entry names a build case group and a lane the trust ledger darkens', () => {
    const bad: string[] = [];
    for (const [id, groups] of Object.entries(GATE_ON_KNOWN)) {
      const c = SKILL_ORDER_CASES.find((x) => x.id === id && !x.reverse);
      for (const [g, k] of Object.entries(groups)) {
        if (!c || c.expect[g as Group] === undefined) bad.push(`${id} ${g}: no such case group`);
        if (!laneInLedger(k!.lane)) bad.push(`${id} ${g}: lane ${k!.lane} is not in the ledger`);
      }
    }
    expect(bad).toEqual([]);
  });
});
