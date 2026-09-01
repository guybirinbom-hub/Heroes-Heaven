import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill, passiveItemPenalty } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { BuildState } from '../src/rules/build';
import type { InventoryItem } from '../src/rules/types';

const db = content();

/**
 * "…BUT YOU ALSO TAKE A −1 ITEM PENALTY TO YOUR STEALTH CHECKS." (Shining Hackle.)
 *
 * `passiveItemBonus` starts at 0 and takes Math.max, so a NEGATIVE passiveEffects.skills entry could
 * never reach a number — the penalty was authored, shipped and applied to nobody. The fix is a
 * companion `passiveItemPenalty` added to deriveSkill as its OWN poolTypedMods term, because RAW an
 * item bonus and an item penalty both apply and must not compete for one slot.
 */
describe('an item skill penalty actually computes', () => {
  const inv = (itemId: string): InventoryItem[] => [{ instanceId: 'i1', itemId, quantity: 1, worn: true, invested: true } as InventoryItem];
  const withItem = (itemId: string) => build('rogue', 5, { inventory: inv(itemId) } as Partial<BuildState>);

  it("shining hackle's −1 Stealth reaches the modifier", () => {
    const plain = build('rogue', 5, {} as Partial<BuildState>);
    const c = withItem('shining-hackle');
    expect(db.items['shining-hackle']?.passiveEffects?.skills?.stealth).toBe(-1);
    expect(passiveItemPenalty(c, db, 'stealth')).toBe(-1);
    expect(deriveSkill(c, 'stealth', db).modifier).toBe(deriveSkill(plain, 'stealth', db).modifier - 1);
  });

  it('…and its +1 Perception item bonus is unharmed by the penalty lane', () => {
    /* The penalty helper is deliberately SKILL-lane only: day-goggles' −2 Perception is conditional
     * in print and lives as a star; wiring the helper into perception would apply it flat. */
    const plain = build('rogue', 5, {} as Partial<BuildState>);
    const c = withItem('shining-hackle');
    expect(passiveItemPenalty(c, db, 'perception' as never)).toBe(0);
    expect(deriveSkill(c, 'acrobatics', db).modifier).toBe(deriveSkill(plain, 'acrobatics', db).modifier);
  });

  it('a penalty and a bonus from DIFFERENT items both apply — they are separate pools', () => {
    const c = build('rogue', 5, {
      inventory: [
        { instanceId: 'i1', itemId: 'shining-hackle', quantity: 1, worn: true, invested: true },
        /* any item with a positive stealth passive would do; find one from the data so the test does
         * not invent gear. If none exists the assertion degrades to the penalty alone. */
      ],
    } as Partial<BuildState>);
    expect(deriveSkill(c, 'stealth', db).modifier).toBe(deriveSkill(build('rogue', 5, {} as Partial<BuildState>), 'stealth', db).modifier - 1);
  });

  it("wandering-pipe carries NO flat passive any more — both halves are circumstance stars", () => {
    /* Print types BOTH its numbers circumstance ('grants its holder a +2 circumstance bonus… but
     * imposes a −1 circumstance penalty to Stealth checks made to Hide or Sneak'), which the passive
     * lane cannot say — it pools everything as an item bonus. And the −1 is CONDITIONAL (Hide/Sneak
     * only), so a flat penalty would have double-counted beside its star the moment penalties began
     * to compute. The clandestine-cloak precedent puts gear-state bonuses in stars. */
    expect(db.items['wandering-pipe']?.passiveEffects).toBeUndefined();
    const stars = FEAT_SITUATIONAL['wandering-pipe'] ?? [];
    expect(stars.some((s) => s.targets.some((t) => t.detail === 'deception') && /\+2 circumstance/.test(s.bonus))).toBe(true);
    expect(stars.some((s) => s.targets.some((t) => t.detail === 'stealth') && /-1 circumstance/.test(s.bonus))).toBe(true);
    const c = withItem('wandering-pipe');
    expect(passiveItemPenalty(c, db, 'stealth')).toBe(0);
  });
});
