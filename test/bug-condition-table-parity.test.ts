/*
 * BUG GUARD — the two condition tables must agree.
 *
 * The app carries the same PF2e conditions twice: src/rules/conditions.ts resolves them on the
 * PLAYER's sheet, tracker/src/utils/conditionEffects.ts resolves them on the GM's initiative
 * tracker. The owner's question on 2026-09-15 was "check which table is the correct one" — this
 * file is that answer as a guard, so nobody has to check again.
 *
 * For every condition id BOTH tables carry a row for (and, for valued ones, values 1..3) it resolves
 * the same character stat through each side's public function and asserts the same
 * {target, amount, type}. Where only one side has numbers, the id must appear in EXCEPTIONS with the
 * printed reason — a stale exception fails too, so a fix can't be forgotten in here.
 *
 * MUTATION-PROVEN, both directions (lines as the runner printed them).
 * Deleting the `fascinated` row from src/rules/conditions.ts:
 *   → AssertionError: fascinated: Perception  sheet {status:0,circumstance:0}
 *     tracker {status:-2,circumstance:0} — one side only, and not a documented exception:
 *     expected false to be true // Object.is equality
 * Putting the tracker's Fascinated row back to enumerating the 16 named skills (its shape before the
 * Lore target below existed) — the drift a 16-skill sweep is blind to, and the reason this target is
 * here:
 *   → AssertionError: fascinated: a Lore skill (sheet {status:-2,circumstance:0} vs
 *     tracker {status:0,circumstance:0}) — 1 failed | 60 passed. The same mutation on Stupefied's
 *     row fails its three values the same way.
 * Changing the tracker's Deafened row to −3:
 *   → AssertionError: deafened: Perception (sheet {status:-2,circumstance:0} vs
 *     tracker {status:-3,circumstance:0}): expected { status: -2, circumstance: +0 } to deeply
 *     equal { status: -3, circumstance: +0 }
 *
 * THE TWO VOCABULARIES ARE NOT TOUCHED. The sheet asks (governing attribute, slot); the tracker
 * asks for a flat stat key. TARGETS below is the translation, and NAME_MAP the id spelling — both
 * live here, in the test, exactly as briefed.
 */
import { describe, it, expect } from 'vitest';
import { conditionTypedMods, CONDITION_EFFECT_IDS, type ConditionSlot } from '../src/rules/conditions';
import type { ActiveCondition, AbilityId } from '../src/rules/types';
import { resolveStatMod, resolveAttackMod, CONDITION_META, type StatMods } from '../tracker/src/utils/conditionEffects';
import type { AppliedCondition } from '../tracker/src/types/pf2e';

/** A penalty pair, as both tables express it: the worst status and the worst circumstance. */
interface Typed {
  status: number;
  circumstance: number;
}
const ZERO: Typed = { status: 0, circumstance: 0 };
const same = (a: Typed, b: Typed) => a.status === b.status && a.circumstance === b.circumstance;
const show = (t: Typed) => `{status:${t.status},circumstance:${t.circumstance}}`;

// ── Name map (the ONLY spelling difference between the two id vocabularies) ────────────────────
const NAME_MAP: Record<string, string> = {
  // The sheet's data ids come from the Archives slug; the tracker keys CONDITION_META by the AoN
  // name lowercased. They agree on every id except this one.
  'persistent-damage': 'persistent damage',
};
const trackerName = (sheetId: string) => NAME_MAP[sheetId] ?? sheetId;

// ── Target map: one character stat, addressed in both vocabularies ─────────────────────────────
interface Target {
  /** What a failure calls it. */
  name: string;
  /** Sheet side: the stat's governing attribute + slot. */
  ability: AbilityId;
  slot: ConditionSlot;
  /** Tracker side: the stat key a probe pushes onto, and how the tracker resolves the stat. */
  probeKey: keyof StatMods;
  tracker: (conds: AppliedCondition[]) => number;
}

const plain = (name: string, key: keyof StatMods, ability: AbilityId, slot: ConditionSlot): Target => ({
  name, ability, slot, probeKey: key, tracker: (cs) => resolveStatMod(cs, key, false),
});
/* A Strike is the one target the tracker splits across two keys — the general `attackBonus` and the
 * range-specific one. resolveAttackMod pools them the way the stat block shows them. */
const strike = (name: string, range: 'melee' | 'ranged', ability: AbilityId): Target => ({
  name, ability, slot: 'attack',
  probeKey: range === 'melee' ? 'meleeAttack' : 'rangedAttack',
  tracker: (cs) => resolveAttackMod(cs, range),
});

/** Each of the 16 skills with its governing attribute, so the sheet can be asked the same question. */
const SKILLS: [keyof StatMods, AbilityId][] = [
  ['acrobatics', 'dex'], ['arcana', 'int'], ['athletics', 'str'], ['crafting', 'int'],
  ['deception', 'cha'], ['diplomacy', 'cha'], ['intimidation', 'cha'], ['medicine', 'wis'],
  ['nature', 'wis'], ['occultism', 'int'], ['performance', 'cha'], ['religion', 'wis'],
  ['society', 'int'], ['stealth', 'dex'], ['survival', 'wis'], ['thievery', 'dex'],
];

const TARGETS: Target[] = [
  plain('AC', 'ac', 'dex', 'ac'),
  plain('Fortitude', 'fort', 'con', 'save'),
  plain('Reflex', 'ref', 'dex', 'save'),
  plain('Will', 'will', 'wis', 'save'),
  plain('Perception', 'perception', 'wis', 'perception'),
  strike('melee Strike', 'melee', 'str'),
  strike('ranged Strike', 'ranged', 'dex'),
  // A caster's key attribute is always mental, so 'cha' answers for all three — no row in either
  // table treats int/wis/cha differently.
  plain('spell attack', 'spellAttack', 'cha', 'spell-attack'),
  plain('spell DC', 'spellDC', 'cha', 'spell-dc'),
  ...SKILLS.map(([k, a]) => plain(k, k, a, 'skill')),
  /* A LORE — the skill neither side can name in advance, and the hole a 16-skill sweep cannot see.
   * The sheet keys every Lore to Intelligence (derive.ts skillAbility: `lore:*` → 'int') and asks
   * the `skill` slot, so Fascinated's "Perception and skill checks" and Stupefied's Int clause both
   * reach it. The tracker has no per-stat key for a Lore, so the probe swamps the pooled
   * CIRCUMSTANCE half through `allChecks`, which an unenumerated skill always draws from. */
  {
    name: 'a Lore skill', ability: 'int', slot: 'skill', probeKey: 'allChecks',
    tracker: (cs) => resolveStatMod(cs, 'hell lore' as keyof StatMods, false),
  },
];

/*
 * NOT COMPARED, and why:
 *  • classDC — the tracker's key carries no governing attribute, the sheet's `class-dc` is keyed to
 *    the character's own key attribute. Clumsy would have to answer "yes" for a Dex class DC and
 *    "no" for a Wis one from the same flat key. Not a drift, a missing dimension.
 *  • speed — the sheet has no speed slot at all: Encumbered's −10 ft lives in deriveSpeeds.
 *  • damage — the tracker shows rolls, never damage bonuses, so it has no key for Enfeebled's
 *    "Strength-based damage rolls".
 *  • allChecks — a tracker pseudo-stat, folded into its targets before anything reads it.
 */

// ── Reading a typed pair out of each side ──────────────────────────────────────────────────────
const sheetTyped = (conds: ActiveCondition[], t: Target): Typed => {
  const mods = conditionTypedMods(conds, t.ability, t.slot);
  return {
    status: mods.find((m) => m.type === 'status')?.value ?? 0,
    circumstance: mods.find((m) => m.type === 'circumstance')?.value ?? 0,
  };
};

const tc = (name: string, value?: number): AppliedCondition =>
  ({ id: name, name, isPermanent: false, ...(value === undefined ? {} : { value }) }) as AppliedCondition;

/* The tracker's public functions return one number, not a typed breakdown — so we read the halves
 * apart with a probe. A −1000 circumstance penalty swamps whatever circumstance penalty the row
 * carries (worst-of-type wins, so the row's own value stops counting); what is left above −1000 is
 * the STATUS half, and the rest of the plain total is the circumstance half. No vocabulary changed,
 * no private export read. */
const SWAMP = 1000;
const probe = (key: keyof StatMods): AppliedCondition =>
  ({
    id: 'parity-probe', name: 'parity-probe', isPermanent: false,
    mods: { [key]: -SWAMP }, modTypes: { [key]: 'circumstance' },
  }) as AppliedCondition;

const trackerTyped = (conds: AppliedCondition[], t: Target): Typed => {
  const base = t.tracker(conds);
  const status = t.tracker([...conds, probe(t.probeKey)]) + SWAMP;
  return { status, circumstance: base - status };
};

// ── The sweep ──────────────────────────────────────────────────────────────────────────────────
/** Every id either table knows, plus the tracker's legacy alias. */
const ALL_IDS = [
  ...new Set([
    ...CONDITION_EFFECT_IDS.map(trackerName),
    ...Object.keys(CONDITION_META),
    'flat-footed',
  ]),
].sort();

/** Ids only ONE side puts a number on. Each needs the printed reason; a stale entry fails below. */
const EXCEPTIONS: Record<string, string> = {
  encumbered:
    "sheet only — Encumbered is imposed by the sheet's own bulk maths (Clumsy 1 plus −10 ft Speed), " +
    'never applied by a GM. The tracker has no inventory, so it has no row and no Encumbered tile.',
  'flat-footed':
    'tracker only — the legacy Core Rulebook name for Off-Guard, kept so an old saved encounter ' +
    "still resolves. The sheet's data is remaster-only, so it has no such id to give a row to.",
};

const valued = (name: string) => CONDITION_META[name]?.hasValue ?? false;
const applied = (name: string, v: number | undefined): [ActiveCondition[], AppliedCondition[]] =>
  [[{ id: name, ...(v === undefined ? {} : { value: v }) }], [tc(name, v)]];

describe('the sheet and the tracker resolve every shared condition to the same numbers', () => {
  for (const name of ALL_IDS) {
    const values: (number | undefined)[] = valued(name) ? [1, 2, 3] : [undefined];
    for (const v of values) {
      it(`${name}${v === undefined ? '' : ' ' + v}`, () => {
        const [sheetConds, trackerConds] = applied(name, v);
        const rows = TARGETS.map((t) => ({
          t,
          sheet: sheetTyped(sheetConds, t),
          tracker: trackerTyped(trackerConds, t),
        }));
        const sheetHas = rows.some((r) => !same(r.sheet, ZERO));
        const trackerHas = rows.some((r) => !same(r.tracker, ZERO));

        if (sheetHas !== trackerHas) {
          const why = EXCEPTIONS[name];
          const first = rows.find((r) => !same(r.sheet, r.tracker))!;
          expect(
            why !== undefined,
            `${name}: ${first.t.name}  sheet ${show(first.sheet)}  tracker ${show(first.tracker)}` +
              ' — one side only, and not a documented exception',
          ).toBe(true);
          // The exception's claim, asserted: the silent side really is silent everywhere.
          for (const r of rows) expect(sheetHas ? r.tracker : r.sheet, `${name}: ${r.t.name}`).toEqual(ZERO);
          return;
        }

        expect(EXCEPTIONS[name], `${name} is listed as an exception but both tables agree — delete the entry`)
          .toBeUndefined();
        for (const r of rows) {
          expect(r.sheet, `${name}: ${r.t.name} (sheet ${show(r.sheet)} vs tracker ${show(r.tracker)})`)
            .toEqual(r.tracker);
        }
      });
    }
  }
});

describe('the six rows the sheet was missing, as printed', () => {
  const at = (name: string, target: string) =>
    sheetTyped([{ id: name }], TARGETS.find((t) => t.name === target)!);

  it('Unconscious: "–4 status penalty to AC, Perception, and Reflex saves, and you have the blinded and off-guard conditions"', () => {
    expect(at('unconscious', 'AC')).toEqual({ status: -4, circumstance: -2 }); // off-guard is the −2
    expect(at('unconscious', 'Perception')).toEqual({ status: -4, circumstance: 0 });
    expect(at('unconscious', 'Reflex')).toEqual({ status: -4, circumstance: 0 });
    // "Reflex saves" — not every Dex-keyed roll, and not the other two saves.
    expect(at('unconscious', 'Fortitude')).toEqual(ZERO);
    expect(at('unconscious', 'Will')).toEqual(ZERO);
    expect(at('unconscious', 'ranged Strike')).toEqual(ZERO);
    expect(at('unconscious', 'stealth')).toEqual(ZERO);
  });

  it('Fascinated: "–2 status penalty to Perception and skill checks"', () => {
    expect(at('fascinated', 'Perception')).toEqual({ status: -2, circumstance: 0 });
    expect(at('fascinated', 'athletics')).toEqual({ status: -2, circumstance: 0 });
    expect(at('fascinated', 'occultism')).toEqual({ status: -2, circumstance: 0 });
    // "skill checks" is every skill, not the 16 with fixed names.
    expect(at('fascinated', 'a Lore skill')).toEqual({ status: -2, circumstance: 0 });
    expect(at('fascinated', 'AC')).toEqual(ZERO);
    expect(at('fascinated', 'Will')).toEqual(ZERO);
  });

  it('Blinded: "if vision is your only precise sense, you take a –4 status penalty to Perception checks"', () => {
    expect(at('blinded', 'Perception')).toEqual({ status: -4, circumstance: 0 });
    // The entry prints no AC clause — being off-guard to what you can't see comes from the
    // detection rules, so the GM adds Off-Guard alongside it.
    expect(at('blinded', 'AC')).toEqual(ZERO);
  });

  it('Deafened: "–2 status penalty to Perception checks for initiative and checks that involve sound…"', () => {
    expect(at('deafened', 'Perception')).toEqual({ status: -2, circumstance: 0 });
    expect(at('deafened', 'AC')).toEqual(ZERO);
  });

  it('Confused and Paralyzed are off-guard: "–2 circumstance penalty to AC"', () => {
    expect(at('confused', 'AC')).toEqual({ status: 0, circumstance: -2 });
    expect(at('paralyzed', 'AC')).toEqual({ status: 0, circumstance: -2 });
    expect(at('confused', 'melee Strike')).toEqual(ZERO);
    expect(at('paralyzed', 'Perception')).toEqual(ZERO);
  });

  it('they stack by type with the rest: Unconscious + Frightened 2 is −4 status, −2 circumstance on AC', () => {
    // Worst status (−4 unconscious beats −2 frightened) plus the off-guard circumstance.
    const ac = TARGETS.find((t) => t.name === 'AC')!;
    expect(sheetTyped([{ id: 'unconscious' }, { id: 'frightened', value: 2 }], ac))
      .toEqual({ status: -4, circumstance: -2 });
  });
});
