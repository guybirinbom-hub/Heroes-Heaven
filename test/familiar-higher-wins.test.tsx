// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom, renderText } from './_render';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { familiarAbilityBudget, familiarFeatRaise } from '../src/rules/companions';
import { upgradedGrantSlug } from '../src/rules/companionGrants';
import type { Character, CompanionConfig } from '../src/rules/types';

/*
 * Owner ruling #168 (2026-10-15, desk enhanced-familiar#fixed-budget-grants), his pick "Higher number wins":
 * Enhanced Familiar's "four ... instead of two" (AoN feat-4717) and a familiar grant that prints its own
 * "three ... instead of two" both replace the same base two, so they do not add up.
 *
 *   Psychopomp Familiar (feat-3468) "You can select three familiar or master abilities each day, instead of two"
 *   Basic Witchcraft (feat-5101)    "You can select three familiar abilities for your familiar each day, instead of two."
 *     → 3 alone, 4 with Enhanced Familiar, 6 with Incredible Familiar (feat-5004 "a base of six ... instead of four")
 *   Undead Familiar (feat-9095) 1, Enhanced Undead Familiar (feat-9101) 3, Glyph Familiar (feat-9170) 1
 *     → "the undead and glyph limits stay as printed", with or without either feat.
 *
 * Before the ruling all five were 'unsettled' and kept 3 / 3 / 1 / 3 / 1 whatever feats the character had.
 *
 * MUTATION LINES (proven once on a scratch copy, 2026-10-16)
 *   1. In src/rules/companions.ts familiarFeatRaise, drop the `'higher-wins'` branch (return hit.add): the
 *      Psychopomp / Basic Witchcraft legs read 5 and 7 instead of 4 and 6 — red.
 *   2. Mark Psychopomp Familiar 'fixed' (or back to 'unsettled'): those legs read 3 — red.
 *   3. Mark Undead Familiar 'higher-wins': the undead leg reads 4 instead of 1 — red.
 */
const db = content();
const noop = () => undefined;
const fam = (grantSlug: string): CompanionConfig => ({ id: `f-${grantSlug}`, kind: 'familiar', name: '', grantSlug });
/** A built fighter at `level` that also holds `featIds` (the readers ask only `character.feats`). */
const holder = (level: number, ...featIds: string[]): Character => {
  const ch = build('fighter', level);
  return { ...ch, feats: [...ch.feats, ...featIds.map((featId) => ({ featId, level: 2, source: 'archetype' }))] } as Character;
};

describe('#168: Enhanced Familiar meets a fixed-number familiar grant — the higher number wins', () => {
  it('Psychopomp Familiar: 3 alone, 4 with Enhanced Familiar, 6 with Incredible Familiar', () => {
    expect(familiarAbilityBudget(fam('psychopomp-familiar'), holder(4, 'soul-warden-dedication', 'psychopomp-familiar'))).toBe(3);
    expect(familiarAbilityBudget(fam('psychopomp-familiar'), holder(4, 'soul-warden-dedication', 'psychopomp-familiar', 'enhanced-familiar'))).toBe(4);
    expect(
      familiarAbilityBudget(fam('psychopomp-familiar'), holder(8, 'soul-warden-dedication', 'psychopomp-familiar', 'enhanced-familiar', 'incredible-familiar')),
    ).toBe(6);
    expect(familiarFeatRaise(fam('psychopomp-familiar'), holder(4, 'psychopomp-familiar', 'enhanced-familiar'))).toEqual({ add: 1, by: 'Enhanced Familiar' });
  });

  it('Basic Witchcraft: 3 alone, 4 with Enhanced Familiar, 6 with Incredible Familiar', () => {
    expect(familiarAbilityBudget(fam('basic-witchcraft'), holder(4, 'witch-dedication', 'basic-witchcraft'))).toBe(3);
    expect(familiarAbilityBudget(fam('basic-witchcraft'), holder(4, 'witch-dedication', 'basic-witchcraft', 'enhanced-familiar'))).toBe(4);
    expect(familiarAbilityBudget(fam('basic-witchcraft'), holder(8, 'witch-dedication', 'basic-witchcraft', 'enhanced-familiar', 'incredible-familiar'))).toBe(6);
  });

  it('the undead and glyph limits stay as printed with either feat', () => {
    for (const feats of [[], ['enhanced-familiar'], ['enhanced-familiar', 'incredible-familiar']]) {
      expect(familiarAbilityBudget(fam('undead-familiar'), holder(8, 'undead-familiar', ...feats)), `undead ${feats}`).toBe(1);
      expect(familiarAbilityBudget(fam('enhanced-undead-familiar'), holder(8, 'undead-familiar', 'enhanced-undead-familiar', ...feats)), `enhanced undead ${feats}`).toBe(3);
      expect(familiarAbilityBudget(fam('glyph-familiar'), holder(8, 'glyph-familiar', ...feats)), `glyph ${feats}`).toBe(1);
      expect(familiarFeatRaise(fam('undead-familiar'), holder(8, 'undead-familiar', ...feats)).by).toBeUndefined();
    }
  });

  /* The same rule for a grant that prints its own FOUR (Enhanced Psychopomp Familiar feat-3471, Draconic Familiar
   * feat-8093, Adaptive Mask Familiar feat-1104 — 'baked'): nothing more with Enhanced Familiar (4 is 4), 6 with
   * Incredible Familiar. Found by package G's checker: with Incredible Familiar the Psychopomp familiar read 6, and
   * taking Enhanced Psychopomp Familiar (which supersedes it) dropped the same familiar to 4.
   * MUTATION LINE: drop `|| grant.enhancedFamiliar === 'baked'` from familiarFeatRaise — the 6 legs read 4, red. */
  it('a printed four meets Incredible Familiar the same way: 6, and the Enhanced Psychopomp upgrade never lowers it', () => {
    const inc = ['enhanced-familiar', 'incredible-familiar'];
    expect(familiarAbilityBudget(fam('enhanced-psychopomp-familiar'), holder(8, 'psychopomp-familiar', 'enhanced-psychopomp-familiar', 'enhanced-familiar'))).toBe(4);
    const before = familiarAbilityBudget(fam('psychopomp-familiar'), holder(8, 'psychopomp-familiar', ...inc));
    const after = familiarAbilityBudget(fam('enhanced-psychopomp-familiar'), holder(8, 'psychopomp-familiar', 'enhanced-psychopomp-familiar', ...inc));
    expect(before).toBe(6);
    expect(after).toBe(6);
    expect(familiarAbilityBudget(fam('draconic-familiar'), holder(8, 'draconic-familiar', ...inc))).toBe(6);
    expect(familiarAbilityBudget(fam('draconic-familiar'), holder(8, 'draconic-familiar', 'enhanced-familiar'))).toBe(4);
    // Familiar Master's own Incredible Familiar prints six: nothing more from either feat.
    expect(familiarAbilityBudget(fam('incredible-familiar-familiar-master'), holder(10, 'familiar-master-dedication', 'enhanced-familiar', 'incredible-familiar-familiar-master'))).toBe(6);
  });

  it('P02\'s additive grants are unchanged: the plain familiar 2→4 and 6, the Witch Dedication familiar 2→4', () => {
    expect(familiarAbilityBudget(fam('familiar'), holder(4, 'enhanced-familiar'))).toBe(4);
    expect(familiarAbilityBudget(fam('familiar'), holder(8, 'enhanced-familiar', 'incredible-familiar'))).toBe(6);
    expect(familiarAbilityBudget(fam('witch-dedication'), holder(4, 'witch-dedication', 'enhanced-familiar'))).toBe(4);
  });

  it('the familiar card says the feat raised Basic Witchcraft\'s three to four, and says nothing without the feat', () => {
    const card = (ch: Character) => {
      const played = applyPlayState(ch, initialPlay(ch, db), db);
      return renderText(<CompanionsTab character={played} content={db} onPlay={noop} charKey="t" />);
    };
    const withFeat = card(holder(4, 'witch-dedication', 'basic-witchcraft', 'enhanced-familiar'));
    expect(withFeat).toContain('Granted by Basic Witchcraft.');
    expect(withFeat).toContain('Your Enhanced Familiar feat raises the number you choose to 4.');
    const without = card(holder(4, 'witch-dedication', 'basic-witchcraft'));
    expect(without).toContain('Granted by Basic Witchcraft.');
    expect(without).not.toContain('raises the number you choose');
    // An undead familiar's card never claims a raise.
    expect(card(holder(4, 'undead-familiar', 'enhanced-familiar'))).not.toContain('raises the number you choose');
  });
});

/*
 * Found while testing #168 like a player (package G, 2026-10-16): a familiar is stored with the grant it was
 * first edited under. A Witch Dedication familiar the player had named kept "Choose 2" after Basic Witchcraft
 * ("three ... instead of two"), and the upgrade added a SECOND, unnamed familiar card beside it, because
 * featGrantedCompanions drops only the superseded slug and the stored companion still carried it. Now the
 * owned upgrade answers for the familiar the player keeps (upgradedGrantSlug), and no second card appears.
 * Run on the code before this change, the first leg below read two cards and "Granted by Witch Dedication".
 *
 * MUTATION LINE: in CompanionsTab, map `explicit` with the stored slug again (drop upgradedGrantSlug) — red.
 */
describe('an upgrade grant answers for the familiar the player already keeps', () => {
  const kept = (grantSlug: string, ...featIds: string[]) => {
    const ch = { ...holder(4, ...featIds), companions: [{ id: 'cmp-0', kind: 'familiar', name: 'Moth', grantSlug, abilities: [] }] } as unknown as Character;
    const played = applyPlayState(ch, initialPlay(ch, db), db);
    const s = renderDom(<CompanionsTab character={played} content={db} onPlay={noop} charKey="t" />);
    const pills = [...s.host.querySelectorAll('.cmp-pill')].map((e) => (e.textContent ?? '').trim());
    const text = s.host.textContent ?? '';
    s.stop();
    return { pills, text };
  };

  it('a named Witch Dedication familiar, then Basic Witchcraft: one card, three abilities, four with Enhanced Familiar', () => {
    const bw = kept('witch-dedication', 'witch-dedication', 'basic-witchcraft');
    expect(bw.pills).toHaveLength(1);
    expect(bw.pills[0]).toContain('Moth');
    expect(bw.text).toContain('Granted by Basic Witchcraft.');
    const ef = kept('witch-dedication', 'witch-dedication', 'basic-witchcraft', 'enhanced-familiar');
    expect(ef.pills).toHaveLength(1);
    expect(ef.text).toContain('Your Enhanced Familiar feat raises the number you choose to 4.');
  });

  it('without the upgrade it is the Witch Dedication familiar again (the stored grant never changed)', () => {
    const wd = kept('witch-dedication', 'witch-dedication');
    expect(wd.pills).toHaveLength(1);
    expect(wd.text).toContain('Granted by Witch Dedication.');
  });

  it('a named Undead Familiar, then Enhanced Undead Familiar: one card that reads the three', () => {
    const eu = kept('undead-familiar', 'undead-familiar', 'enhanced-undead-familiar');
    expect(eu.pills).toHaveLength(1);
    expect(eu.text).toContain('Granted by Enhanced Undead Familiar.');
    expect(familiarAbilityBudget({ ...fam('enhanced-undead-familiar') }, holder(4, 'undead-familiar', 'enhanced-undead-familiar'))).toBe(3);
  });

  it('upgradedGrantSlug follows a chain and leaves an unowned upgrade alone', () => {
    expect(upgradedGrantSlug('pet', new Set(['pet', 'spirit-familiar-animist', 'shaman']))).toBe('shaman');
    expect(upgradedGrantSlug('psychopomp-familiar', new Set(['psychopomp-familiar', 'enhanced-psychopomp-familiar']))).toBe('enhanced-psychopomp-familiar');
    expect(upgradedGrantSlug('witch-dedication', new Set(['witch-dedication']))).toBe('witch-dedication');
  });
});
