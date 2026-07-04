import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { emptyBuild, buildCharacter, deriveBuildFromCharacter } from '../src/rules/build';
import { wizardSpellbookBudget } from '../src/rules/spellcasting';

/*
 * Builder-side grant slots — verified against .import-src Foundry text (Player Core, Remaster):
 *
 *  - School of Unified Magical Theory (school-of-unified-magical-theory): "you gain an additional
 *    1st-level wizard class feat, and you add one 1st-rank spell of your choice to your spellbook."
 *    → a bonus level-1 class-feat slot + a +1 initial spellbook budget.
 *  - Fighter Dedication: "You become trained in martial weapons. You become trained in your choice
 *    of Acrobatics or Athletics…" → skill-training choice (no bonus skill feat).
 *  - Rogue Dedication: "You gain a skill feat … You become trained in light armor … you become
 *    trained in Stealth or Thievery plus one skill of your choice…" → two skill-training choices +
 *    a bonus skill feat.
 */

const UMT = 'school-of-unified-magical-theory';

describe('School of Unified Magical Theory grants', () => {
  it('grants a bonus level-1 wizard CLASS feat (an extra class-feat slot)', () => {
    // A wizard has no level-1 class feat by default (first is level 2). With UMT + a chosen bonus
    // feat, the built character carries one level-1 class feat.
    const umt = build('wizard', 1, { subclassId: UMT, umtFeatId: 'reach-spell' });
    const l1Class = umt.feats.filter((f) => f.level === 1 && f.category === 'class');
    expect(l1Class.map((f) => f.featId)).toContain('reach-spell');

    // A normal-school wizard of the same level has NO level-1 class feat.
    const normal = build('wizard', 1, { subclassId: 'school-of-battle-magic' });
    expect(normal.feats.filter((f) => f.level === 1 && f.category === 'class').length).toBe(0);
    // → UMT wizard has exactly one MORE level-1 class feat than a normal-school wizard.
    expect(l1Class.length - normal.feats.filter((f) => f.level === 1 && f.category === 'class').length).toBe(1);
  });

  it('does not inject the bonus feat when none is chosen, or for a non-UMT school', () => {
    const noPick = build('wizard', 1, { subclassId: UMT });
    expect(noPick.feats.filter((f) => f.level === 1 && f.category === 'class').length).toBe(0);
    // The pick only applies under UMT: same umtFeatId on a different school is ignored.
    const wrongSchool = build('wizard', 1, { subclassId: 'school-of-battle-magic', umtFeatId: 'reach-spell' });
    expect(wrongSchool.feats.some((f) => f.featId === 'reach-spell')).toBe(false);
  });

  it('grants a +1 initial spellbook budget', () => {
    expect(wizardSpellbookBudget(1, true)).toBe(wizardSpellbookBudget(1, false) + 1);
    expect(wizardSpellbookBudget(1, false)).toBe(5);
    expect(wizardSpellbookBudget(1, true)).toBe(6);
    // The +1 persists at every level (a larger book carried forward).
    expect(wizardSpellbookBudget(5, true)).toBe(wizardSpellbookBudget(5, false) + 1);
  });

  it('round-trips the bonus feat: deriveBuildFromCharacter recovers umtFeatId (no extra slot consumed)', () => {
    const c = content();
    const ch = buildCharacter(
      { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', subclassId: UMT, umtFeatId: 'reach-spell' },
      c,
    );
    const b = deriveBuildFromCharacter(ch, c);
    expect(b.umtFeatId).toBe('reach-spell');
    // It must NOT be reconstructed into a level-1 class-feat slot pick.
    expect(Object.entries(b.featPicks).some(([k, v]) => k.startsWith('1:class') && v === 'reach-spell')).toBe(false);
  });
});

describe('Fighter Dedication skill-training grant', () => {
  it('trains the chosen Acrobatics/Athletics (default = first option = Acrobatics)', () => {
    // Fighter Dedication at level 2 on a wizard (untrained in both by default).
    const dflt = build('wizard', 4, { featPicks: { '2:class:0': 'fighter-dedication' } });
    expect(dflt.proficiencies.skills.acrobatics).toBe('trained');

    // Explicit Athletics pick.
    const ath = build('wizard', 4, {
      featPicks: { '2:class:0': 'fighter-dedication' },
      featSkillChoices: { 'fighter-dedication:0': 'athletics' },
    });
    expect(ath.proficiencies.skills.athletics).toBe('trained');
    // Without the dedication there is no such training.
    expect(build('wizard', 4).proficiencies.skills.acrobatics ?? 'untrained').toBe('untrained');
  });

  it('grants NO bonus skill feat (Fighter Dedication has none)', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'fighter-dedication' } });
    // No extra skill feat is injected beyond what the class/background/slots produce.
    const skillFeats = ch.feats.filter((f) => f.category === 'skill');
    const plain = build('wizard', 4).feats.filter((f) => f.category === 'skill');
    expect(skillFeats.length).toBe(plain.length);
  });
});

describe('Rogue Dedication skill grants + bonus skill feat', () => {
  it('trains the Stealth/Thievery choice + a free skill choice (defaults)', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    // slot 0 default = Stealth; slot 1 ('any') default = Acrobatics (first of SKILLS).
    expect(ch.proficiencies.skills.stealth).toBe('trained');
    expect(ch.proficiencies.skills.acrobatics).toBe('trained');
    // light armor still granted (pre-existing).
    expect(ch.proficiencies.defenses.light).toBe('trained');
  });

  it('respects explicit choices (Thievery + a free skill of choice)', () => {
    const ch = build('wizard', 4, {
      featPicks: { '2:class:0': 'rogue-dedication' },
      featSkillChoices: { 'rogue-dedication:0': 'thievery', 'rogue-dedication:1': 'diplomacy' },
    });
    expect(ch.proficiencies.skills.thievery).toBe('trained');
    expect(ch.proficiencies.skills.diplomacy).toBe('trained');
  });

  it('injects the chosen bonus skill feat as an extra skill-feat slot', () => {
    const withFeat = build('wizard', 4, {
      featPicks: { '2:class:0': 'rogue-dedication' },
      dedicationSkillFeats: { 'rogue-dedication': 'assurance' },
    });
    expect(withFeat.feats.some((f) => f.featId === 'assurance' && f.category === 'skill')).toBe(true);

    // The bonus feat is EXTRA: one more skill feat than the same character without the pick.
    const withoutFeat = build('wizard', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    const nWith = withFeat.feats.filter((f) => f.category === 'skill').length;
    const nWithout = withoutFeat.feats.filter((f) => f.category === 'skill').length;
    expect(nWith - nWithout).toBe(1);
  });

  it('round-trips the bonus skill feat into dedicationSkillFeats (no slot consumed)', () => {
    const c = content();
    const ch = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 4,
        classId: 'wizard',
        subclassId: 'school-of-battle-magic',
        featPicks: { '2:class:0': 'rogue-dedication' },
        dedicationSkillFeats: { 'rogue-dedication': 'assurance' },
      },
      c,
    );
    const b = deriveBuildFromCharacter(ch, c);
    expect(b.dedicationSkillFeats?.['rogue-dedication']).toBe('assurance');
    // Not reconstructed into a slot pick.
    expect(Object.values(b.featPicks)).not.toContain('assurance');
  });
});
