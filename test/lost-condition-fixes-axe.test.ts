import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveDefenses, deriveSkill } from '../src/rules/derive';
import { explainStat, statHasSituational } from '../src/rules/explain';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * LOST-CONDITION LANE (2026-10-17) — Axe of the Dwarven Lords, AoN equipment-609.
 *
 * Print: *"While the axe is in your possession, you gain a +4 item bonus when Crafting armor, jewelry,
 * metalworking, stonemasonry, snares, traps, and weapons."* and *"If you are a dwarf, you gain greater
 * darkvision while holding the axe."*
 *
 * The overlay row carried both as unconditional passives, so with the trust gate ON (how every player
 * sees the app) a HUMAN holding the axe read +4 on every Crafting check and greater darkvision on the
 * Senses row. Now:
 *   · the +4 lives only in the star FEAT_SITUATIONAL['axe-of-the-dwarven-lords'] (ruling B), which is
 *     LIT — Wanderer's Guide encodes `conditional` on this record, so the star is not on the ledger's
 *     situational lane;
 *   · the sense carries `whenCreatureTrait: 'dwarf'`, read by deriveDefenses through hasCreatureTrait.
 *
 * Each over-grant is mutation-proved in memory: the old row is planted back on a clone of the GATED
 * record and the same probe reports it. Synthetic characters only.
 */
const gated = content({ trustGate: true });
const AXE = 'axe-of-the-dwarven-lords';
const OLD_ROW = { skills: { crafting: 4 }, senses: [{ name: 'greater-darkvision' }] };

const pc = (d: ContentDatabase, ancestryId: string, over: Partial<BuildState> = {}): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST lost-condition axe',
      level: 9,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId,
      backgroundId: Object.keys(d.backgrounds)[0],
      ...over,
    } as BuildState,
    d,
  );
const holding = (c: Character): Character => ({
  ...c,
  inventory: [...c.inventory, { instanceId: 'axe', itemId: AXE, quantity: 1, equipped: true, worn: true, invested: true } as InventoryItem],
});
const senses = (c: Character, d: ContentDatabase) => deriveDefenses(c, d).senses.map((s) => s.name);

/** The two over-grants, measured on a built character: what a human holder gets that print withholds. */
function overGrants(d: ContentDatabase): string[] {
  const out: string[] = [];
  const human = pc(d, 'human');
  const held = holding(human);
  if (senses(held, d).includes('greater-darkvision')) out.push('a human holder has greater darkvision');
  const bump = deriveSkill(held, 'crafting', d).modifier - deriveSkill(human, 'crafting', d).modifier;
  if (bump !== 0) out.push(`every Crafting check moves by ${bump}`);
  return out;
}

/** Run `fn` against `d` with the axe's passiveEffects swapped for `pe`, putting the shipped record back after. */
function withPassive<T>(d: ContentDatabase, pe: unknown, fn: () => T): T {
  const saved = d.items[AXE];
  (d.items as Record<string, unknown>)[AXE] = { ...saved, passiveEffects: pe };
  try {
    return fn();
  } finally {
    d.items[AXE] = saved;
  }
}

describe('Axe of the Dwarven Lords — the dwarf-only darkvision and the Crafting list (gate ON)', () => {
  it('the record is still the one print describes (the assertions below are not vacuous)', () => {
    expect(gated.items[AXE]?.aonId).toBe('equipment-609');
    expect(gated.ancestries.dwarf?.traits).toContain('dwarf');
    expect(gated.ancestries.human?.traits).not.toContain('dwarf');
  });

  it('a human holder gets neither the greater darkvision nor a +4 on every Crafting check', () => {
    expect(overGrants(gated)).toEqual([]);
  });

  it('a DWARF holder still gets the greater darkvision print gives', () => {
    const dwarf = holding(pc(gated, 'dwarf'));
    expect(senses(dwarf, gated)).toContain('greater-darkvision');
    expect(senses(pc(gated, 'dwarf'), gated)).not.toContain('greater-darkvision');
  });

  it('the +4 is a LIT star on Crafting carrying the printed list, not a number', () => {
    const held = holding(pc(gated, 'human'));
    const ref = { kind: 'skill', skill: 'crafting' } as const;
    expect(statHasSituational(held, ref, gated)).toBe(true);
    const lines = (explainStat(held, gated, ref).situational ?? []).map((s) => s.text);
    expect(lines.some((t) => /\+4 item/.test(t) && /armor, jewelry, metalwork/.test(t) && /Axe of the Dwarven Lords/.test(t))).toBe(true);
  });

  it('mutation-proof: the old unconditional row, planted back on the gated record, is caught', () => {
    const planted = withPassive(gated, OLD_ROW, () => overGrants(gated));
    expect(planted).toContain('a human holder has greater darkvision');
    expect(planted).toContain('every Crafting check moves by 4');
    // …and the shipped record is back in place afterwards.
    expect(overGrants(gated)).toEqual([]);
  });
});
