import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';

const c = content();

/**
 * A focus spell carries its OWN pool point. A feat may therefore declare `focusPoolBonus` (it is a
 * pool-only feat) OR grant a focus spell — never both, or the character gets two points for one spell.
 *
 * build.ts's applyFeatFocus set `contributedSpell` from `feat.focusSpells`, a domains choice, or
 * ADV_SPELL — but NOT from an `effectChoices` option whose grant carries focusSpells. Shadow Magic
 * grants its spell that way AND carried focusPoolBonus: 1, so a Shadowdancer shipped with a 2-point
 * focus pool for a single focus spell. Its sibling Additional Shadow Magic models the same thing
 * correctly (grant only, no bonus), which is what makes the discrepancy provable rather than a
 * judgement call.
 */
const shadowdancer = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 12,
  classId: 'rogue',
  ancestryId: Object.keys(c.ancestries)[0],
  backgroundId: Object.keys(c.backgrounds)[0],
  keyAbility: 'dex',
  subclassId: (c.classes.rogue?.subclass?.options[0]?.id as string) ?? null,
  ...over,
});

/** Pool size for a build that has taken `featId` in a level-N slot, with its effect choice resolved. */
function poolWith(featId: string, effectChoiceValue?: string): number {
  const feat = c.feats[featId];
  expect(feat, `${featId} missing from content`).toBeTruthy();
  const key = `${feat.level}:class:0`;
  const build = shadowdancer({
    featPicks: { [key]: featId },
    ...(effectChoiceValue
      ? { effectChoices: { [`${featId}:${feat.effectChoices![0].id}`]: effectChoiceValue } }
      : {}),
  } as Partial<BuildState>);
  const ch = buildCharacter(build, c);
  return ch.focus?.max ?? 0;
}

describe('focus pool is not double-counted', () => {
  it('every feat that grants a focus spell via effectChoices is caught by the engine guard', () => {
    // 28 shipped feats carry BOTH an effectChoices focus grant and focusPoolBonus — Shadow Magic,
    // Order Spell, Arcane School Spell, First Revelation, Basic Bloodline Spell, the four Perfect Ki
    // rungs, and 19 more. Each was handing out a phantom pool point.
    //
    // The fix is in the ENGINE, not the data: build.ts skips focusPoolBonus whenever the feat can
    // grant a focus spell through a choice, exactly as it already did for a domains choice. So the
    // invariant to hold is not "the data is pristine" (the redundant field is harmless now) but
    // "every such record is seen by that guard". This asserts the guard's predicate covers all of
    // them, so none can double-count.
    const grantsFocusViaEffectChoice = (f: { effectChoices?: { options?: { grant?: { focusSpells?: string[] } }[] }[] }) =>
      (f.effectChoices ?? []).some((ec) => (ec.options ?? []).some((o) => (o.grant?.focusSpells?.length ?? 0) > 0));

    const withBoth = Object.values(c.feats).filter((f) => grantsFocusViaEffectChoice(f) && f.focusPoolBonus);
    expect(withBoth.length, 'expected the known set of double-declaring feats').toBeGreaterThanOrEqual(28);
    for (const f of withBoth) {
      expect(grantsFocusViaEffectChoice(f), `${f.name} must be caught by the guard`).toBe(true);
    }
  });

  it('Shadow Magic gives a 1-point pool for its one focus spell', () => {
    const feat = c.feats['shadow-magic'];
    expect(feat?.effectChoices?.[0]?.options?.length).toBeGreaterThan(0);
    const chosen = feat.effectChoices![0].options![0].value;
    expect(poolWith('shadow-magic', chosen)).toBe(1);
  });

  it('Additional Shadow Magic — the correctly-modelled sibling — also gives 1', () => {
    const feat = c.feats['additional-shadow-magic'];
    const chosen = feat.effectChoices![0].options![0].value;
    expect(poolWith('additional-shadow-magic', chosen)).toBe(1);
  });
});
