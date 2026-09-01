import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc } from '../src/rules/derive';
import { CATALOG_MODES, modeRelevant } from '../src/rules/modes';

const db = content();

/**
 * *"Your carapace is medium armor in the plate armor group that grants a +4 item bonus to AC, a Dex
 * cap of +1, a check penalty of –2, a Speed penalty of –5 feet, a Strength value of +3, and has the
 * comfort trait. You can never wear other armor or remove your carapace."* (Hardshell Surki, Howl of
 * the Wild pg. 49.)
 *
 * The armour shipped as a correct item that NOTHING granted, and `grantsItems` was read off feats and
 * class features but never off a HERITAGE — so the one ancestry that cannot buy armour had none: no
 * AC bonus, no Dex cap, no penalties. Both halves are needed, which is why the item existing is not
 * the same as the character having it.
 */
describe('the hardshell surki carapace', () => {
  it('is a correctly statted medium plate armour', () => {
    const it_ = db.items['hardshell-surki-carapace'];
    expect(it_).toBeTruthy();
    expect(it_.itemType).toBe('armor');
    expect(it_.category).toBe('medium');
    expect(it_.group).toBe('plate');
    expect(it_.acBonus).toBe(4);
    expect(it_.dexCap).toBe(1);
    expect(it_.checkPenalty).toBe(-2);
    expect(it_.speedPenalty).toBe(-5);
    expect(it_.traits).toContain('comfort');
  });

  it('is granted by the heritage rather than left orphaned', () => {
    const g = db.heritages['hardshell-surki']?.grantsItems ?? [];
    expect(g.map((x) => x.itemId)).toContain('hardshell-surki-carapace');
  });

  it('reaches a built character, and no other surki heritage gets one', () => {
    const ch = build('fighter', 1, { ancestryId: 'surki', heritageId: 'hardshell-surki' });
    const held = (ch.inventory ?? []).map((i) => i.itemId);
    expect(held, 'the carapace must be on the character, not merely in the database').toContain('hardshell-surki-carapace');

    const other = build('fighter', 1, { ancestryId: 'surki', heritageId: 'lantern-surki' });
    expect((other.inventory ?? []).map((i) => i.itemId)).not.toContain('hardshell-surki-carapace');
  });

  it('actually moves AC — the whole reason the clause exists', () => {
    const hard = build('fighter', 1, { ancestryId: 'surki', heritageId: 'hardshell-surki' });
    const bare = build('fighter', 1, { ancestryId: 'surki', heritageId: 'lantern-surki' });
    expect(deriveAc(hard, db).value).toBeGreaterThan(deriveAc(bare, db).value);
  });
});

/**
 * *"You establish a force field that grants you resistance 10 to damage dealt by spells and magical
 * abilities with the trait of your magiphage ability, except for force damage."*
 *
 * Whether incoming damage came from a spell of your magiphage tradition is a fact about the ATTACKER,
 * so this is an `against`-qualified resistance: display-only, never folded into the computed total.
 * That is also why the tradition need not be substituted into the type — the player answered
 * `magiphageTradition` once on the ancestry, and four per-tradition modes would ask again and let them
 * answer differently.
 */
describe('Dampening Harmonics', () => {
  /* It lives in `scripts/data/toggle-modes.json`, merged into `core.modes` — NOT in the code catalogue
   * in modes.ts. Asserting that here is the point: it was very nearly authored a second time in
   * modes.ts, which would have put two identical toggles in front of the player. */
  const mode = db.modes['dampening-harmonics'];

  it('ships once, from the data catalogue', () => {
    expect(mode).toBeTruthy();
    expect(CATALOG_MODES.some((m) => m.name === 'Dampening Harmonics'), 'a second copy in modes.ts').toBe(false);
  });

  it('is offered to a hardshell surki and to nobody else', () => {
    const gate = new Set(['hardshell-surki']);
    expect(modeRelevant(mode, 'fighter', 'surki', gate)).toBe(true);
    expect(modeRelevant(mode, 'fighter', 'surki', new Set(['lantern-surki']))).toBe(false);
    expect(modeRelevant(mode, 'fighter', 'surki', new Set())).toBe(false);
  });

  it('the heritage it is gated on is a real record the gate resolver can see', () => {
    // `modeGateIds()` unions feats + owned class features + heritages; a gate naming something none of
    // those can hold is a mode no character is ever offered.
    expect(db.heritages['hardshell-surki']).toBeTruthy();
  });

  it('carries the resistance as a QUALIFIED entry, so it never inflates the total', () => {
    const r = mode.resistances?.[0];
    expect(r?.value).toBe(10);
    expect(r?.against, 'unqualified, this would add a flat 10 against everything').toBeTruthy();
    expect(r!.against).toMatch(/force/i);
  });

  it('the action that turns it on is granted by the heritage', () => {
    expect(db.heritages['hardshell-surki'].grantsActions).toContain('dampening-harmonics');
    expect(db.actions['dampening-harmonics']).toBeTruthy();
  });
});
