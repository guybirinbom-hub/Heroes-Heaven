import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { maxTakes } from '../src/rules/featGrants';
import type { FeatChoiceDef, InnateSpellGrant } from '../src/rules/types';

/**
 * Batch 037, data-rows-5: the WG-comparison findings whose whole fix is authored data.
 *
 * Every assertion reads the SHIPPED artefacts through `content()` (public/core.json plus the
 * split-out public/core-descriptions.json), so each one fails until the driver applies
 * work/.b037-rows-data-rows-5.json. That is the point — the test pins the row, not a patched copy.
 */
const db = content();

const feat = (id: string) => db.feats[id]!;
const choiceOf = (id: string): FeatChoiceDef => feat(id).choice!;
/** The single innate grant one daily-choice option hands over. */
const granted = (def: FeatChoiceDef, value: string): InnateSpellGrant => {
  const opt = (def.options ?? []).find((o) => o.value === value)!;
  expect(opt, `${value} is still an offered answer`).toBeDefined();
  const gs = opt.grant?.innateSpells ?? [];
  expect(gs, `${value} carries exactly one innate grant`).toHaveLength(1);
  return gs[0];
};

/*
 * THE SIX KITSUNE / NAGAJI DAILY SPELL FEATS.
 *
 * All five records already asked their question once, at daily preparations (`choice.daily`, which
 * Builder.tsx skips through `askedAtDailyPrep`). What none of them had was a GRANT: dailyChoiceGrants
 * (derive.ts:1824) reads `opt.grant` off the record's own options, and every option shipped bare — so
 * the morning's answer was recorded and no spell ever became castable.
 */

describe('kitsune-spell-familiarity grants its chosen cantrip at daily preparations', () => {
  /* feat-2619: "During your daily preparations, choose daze , forbidding ward , or ghost sound .
   * Until your next daily preparations, you can cast this cantrip as a divine innate spell at will.
   * A cantrip is heightened to a spell level equal to half your level rounded up." */

  // batch 037: kitsune-spell-familiarity#daily-control
  it('kitsune-spell-familiarity is asked once, at daily preparations', () => {
    const def = choiceOf('kitsune-spell-familiarity');
    expect(def.daily).toBe(true);
    expect((def.options ?? []).map((o) => o.value)).toEqual(['daze', 'forbidding-ward', 'ghost-sound']);
  });

  /* ⚠ The third answer's KEY is the printed word and its SPELL is the current printing. Ghost Sound
   * (spell-132) is superseded — its remaster_id is spell-1528, Figment — and
   * scripts/superseded-grant-check.mjs refuses any grant route that hands a player a legacy printing,
   * so the option value stays "ghost-sound" (a stored answer, and print's own word) while the grant
   * names `figment`. Same shape as the nagaji twin, where print says "mage hand" and the option is
   * telekinetic-hand. */
  // batch 037: kitsune-spell-familiarity#daily-control
  it('every kitsune-spell-familiarity answer grants an at-will divine innate cantrip', () => {
    const def = choiceOf('kitsune-spell-familiarity');
    for (const [answer, spellId] of [['daze', 'daze'], ['forbidding-ward', 'forbidding-ward'], ['ghost-sound', 'figment']]) {
      const g = granted(def, answer);
      // batch 037: kitsune-spell-familiarity#daily-control
      expect(g.spellId).toBe(spellId);
      expect(g.tradition).toBe('divine');
      expect(g.atWill).toBe(true);
      // Every one of the three is a real cantrip record, so "at will" is the whole cadence.
      // batch 037: kitsune-spell-familiarity#daily-control
      expect(db.spells[spellId]!.rank ?? 0).toBe(0);
      // …and nothing superseded reaches the player.
      expect(db.spells[spellId]!.edition).not.toBe('superseded');
    }
  });
});

describe('kitsune-spell-mysteries grants its chosen 1st-rank divine spell once a day', () => {
  /* feat-2624: "During your daily preparations, choose bane , illusory object , or sanctuary . You
   * can cast this as a 1st-level divine innate spell once that day." */

  // batch 037: kitsune-spell-mysteries#daily-control
  it('every kitsune-spell-mysteries answer grants a 1st-rank divine innate spell, once that day', () => {
    const def = choiceOf('kitsune-spell-mysteries');
    expect(def.daily).toBe(true);
    for (const id of ['bane', 'illusory-object', 'sanctuary']) {
      const g = granted(def, id);
      expect(g.spellId).toBe(id);
      expect(g.tradition).toBe('divine');
      expect(g.rank).toBe(1);
      expect(g.usesPerDay).toBe(1);
      expect(g.atWill).toBeUndefined();
    }
  });
});

describe('nagaji-spell-mysteries grants its chosen 1st-rank occult spell once a day', () => {
  /* feat-3988: "During your daily preparations, choose charm , fleet step , or heal . You can cast
   * the chosen spell as a 1st-level occult innate spell once that day." */

  // batch 037: nagaji-spell-mysteries#daily-control
  it('every nagaji-spell-mysteries answer grants a 1st-rank occult innate spell, once that day', () => {
    const def = choiceOf('nagaji-spell-mysteries');
    expect(def.daily).toBe(true);
    for (const id of ['charm', 'fleet-step', 'heal']) {
      const g = granted(def, id);
      expect(g.spellId).toBe(id);
      expect(g.tradition).toBe('occult');
      expect(g.rank).toBe(1);
      expect(g.usesPerDay).toBe(1);
      // Their middle answer points at no spell at all on WG's side; all three of ours resolve.
      expect(db.spells[id]).toBeDefined();
    }
  });
});

describe('kitsune-spell-expertise grants its chosen spell at 5th rank, not the spell’s own', () => {
  /* feat-2629: "During your daily preparations, choose confusion , death ward , or illusory scene .
   * You can Cast this Spell as a 5th-level divine innate spell once that day." */

  // batch 037: kitsune-spell-expertise#daily-control
  it('every kitsune-spell-expertise answer grants a 5th-rank divine innate spell, once that day', () => {
    const def = choiceOf('kitsune-spell-expertise');
    expect(def.daily).toBe(true);
    for (const id of ['confusion', 'death-ward', 'illusory-scene']) {
      const g = granted(def, id);
      expect(g.spellId).toBe(id);
      expect(g.tradition).toBe('divine');
      expect(g.rank).toBe(5);
      expect(g.usesPerDay).toBe(1);
    }
    // Confusion's own record is rank 4, so the printed 5th-rank casting exists only on the grant.
    expect(db.spells['confusion']!.rank).toBe(4);
  });
});

describe('nagaji-spell-expertise grants its chosen spell at 5th rank, not the spell’s own', () => {
  /* feat-3996: "During your daily preparations, choose blink , control water , or subconscious
   * suggestion . You can Cast this Spell as a 5th-level occult innate spell once that day." Blink is
   * the legacy name; the remaster record this app ships is Flicker, and no `blink` record exists. */

  // batch 037: nagaji-spell-expertise#daily-control
  it('every nagaji-spell-expertise answer grants a 5th-rank occult innate spell, once that day', () => {
    const def = choiceOf('nagaji-spell-expertise');
    expect(def.daily).toBe(true);
    for (const id of ['flicker', 'control-water', 'subconscious-suggestion']) {
      const g = granted(def, id);
      expect(g.spellId).toBe(id);
      expect(g.tradition).toBe('occult');
      expect(g.rank).toBe(5);
      expect(g.usesPerDay).toBe(1);
    }
    expect(db.spells['blink']).toBeUndefined();
    // Flicker's own record is rank 4, so the printed 5th-rank casting exists only on the grant.
    expect(db.spells['flicker']!.rank).toBe(4);
  });
});

describe('time-mage-dedication’s Time Sense follows the caster’s own tradition', () => {
  /* feat-8480: "You also gain time sense as an innate cantrip usable at will. This innate spell and
   * your focus spells from the time mage archetype are of the same tradition as the spells you used
   * to meet the archetype's prerequisites." The prerequisite is a spellcasting class feature, so the
   * tradition is the character's own class casting — `traditionFromCasting`, read at build.ts:8243. */

  // batch 037: time-mage-dedication#innate-tradition
  it('time-mage-dedication grants Time Sense with no fixed tradition and no picker', () => {
    const gs = feat('time-mage-dedication').innateSpells ?? [];
    expect(gs).toHaveLength(1);
    expect(gs[0].spellId).toBe('time-sense');
    expect(gs[0].atWill).toBe(true);
    expect(gs[0].traditionFromCasting).toBe(true);
    // A fixed tradition would beat the derivation for a caster of any other tradition, and a picker
    // would offer three answers the prerequisite makes illegal.
    expect(gs[0].tradition).toBeUndefined();
    expect(feat('time-mage-dedication').choice).toBeUndefined();
  });
});

describe('clawdancer-dedication grants the two stances, not a second copy of their Strikes', () => {
  /* feat-5436 defines both attacks inside the stances: "Claw Stance ... The only Strikes you can make
   * are frenzied claw unarmed attacks. These deal 1d6 slashing damage..." and "Talon Stance ... The
   * only Strikes you can make are spinning talon unarmed attacks." The dedication grants neither on
   * its own; its own `grantedStrikes` put both on the sheet permanently and again while a stance ran. */

  // batch 037: clawdancer-dedication#duplicate-strikes
  it('clawdancer-dedication carries no grantedStrikes of its own', () => {
    expect(feat('clawdancer-dedication').grantedStrikes).toBeUndefined();
    // The lane that IS printed stays: the dedication hands over the two stance actions.
    expect(feat('clawdancer-dedication').grantsActions).toEqual(['claw-stance', 'talon-stance']);
  });

  // batch 037: clawdancer-dedication#duplicate-strikes
  it('the Strikes clawdancer-dedication stopped duplicating still live on their own stances', () => {
    expect(db.stances!['claw-stance']!.strikes!.map((s) => s.name.toLowerCase())).toEqual(['frenzied claw']);
    expect(db.stances!['talon-stance']!.strikes!.map((s) => s.name.toLowerCase())).toEqual(['spinning talon']);
  });
});

describe('versatile-mutation asks its energy question at 8th level and only once', () => {
  /* feat-5454: "At 8th level, choose one of the following: acid, cold, electricity, fire, or sonic
   * damage..." — and the document's text ends at "adds that trait to the action." with no Special
   * clause of any kind. */

  // batch 037: versatile-mutation#energy-level
  it('versatile-mutation holds its five-option energy question back to 8th level', () => {
    const def = choiceOf('versatile-mutation');
    expect(def.minLevel).toBe(8);
    expect((def.options ?? []).map((o) => o.value)).toEqual(['acid', 'cold', 'electricity', 'fire', 'sonic']);
  });

  // batch 037: versatile-mutation#takable-twice
  it('versatile-mutation may be taken once, and its choice no longer guards a second take', () => {
    expect(feat('versatile-mutation').maxTakable).toBeUndefined();
    expect(maxTakes(feat('versatile-mutation'))).toBe(1);
    expect(choiceOf('versatile-mutation').distinctAcrossTakes).toBeUndefined();
  });

  // batch 037: versatile-mutation#takable-twice
  it('versatile-mutation no longer prints the Special clause the flag was read from', () => {
    const d = feat('versatile-mutation').description!;
    expect(d).toContain('adds that trait to the action.');
    expect(d).not.toContain('**Special**');
    expect(d).not.toContain('second time at 16th level');
  });
});

describe('arcana-of-iron does not hand over the Weapon Expertise class feature', () => {
  /* feat-7980: "You become trained in advanced weapons. If you gain the weapon expertise class
   * feature, your proficiency in martial and advanced weapons increases to expert." A CONDITION on a
   * feature the class may grant — never a grant of that feature. */

  // batch 037: arcana-of-iron#weapon-proficiency
  it('arcana-of-iron grants no class features', () => {
    expect(feat('arcana-of-iron').grantsClassFeatures).toBeUndefined();
  });
});
