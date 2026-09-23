import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { CASTER_ARCHETYPES } from '../src/rules/casterArchetypes';
import { checkPrerequisites, dedicationBlock } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/**
 * SPELLSHOT — the owner, 2026-09-22: *"the entire Spellshot archetype is very bad — go over the text;
 * nothing works like the text."*
 *
 * He was right about the biggest one. Spellshot Dedication prints *"You cast arcane spells like a
 * wizard, gaining a spellbook with four common arcane cantrips of your choice … You can prepare two
 * cantrips each day from your spellbook … your key spellcasting attribute … is Intelligence, and they
 * are arcane spells. … This counts as the wizard archetype for the benefits of Basic Wizard
 * Spellcasting."* (feat-3267) and the archetype was missing from CASTER_ARCHETYPES entirely, so:
 *
 *   · measured at levels 2, 4 and 8, a spellshot had NO spellcasting entry of any kind;
 *   · the two cantrips were authored as INNATE at-will picks, which is a different mechanic from the
 *     spellbook the record prints and which nothing connected to a slot ladder;
 *   · Basic Wizard Spellcasting was unreachable — `checkPrerequisites` resolves "Wizard Dedication"
 *     to a real feat and therefore enforces it — and the record's own note said to take it through an
 *     Override.
 *
 * `mk()` could not mint this one because there is no `basic-spellshot-spellcasting`: the ladder IS the
 * wizard one, which is presumably how the archetype came to be missing from the table.
 *
 * …and three things the fix itself broke, each of which is a player losing something without being
 * asked — the app's first rule — and each held by the last three describe blocks here:
 *
 *   · the two cantrips a spellshot ALREADY PICKED lived in the record's retired `effectChoices`, so
 *     switching the record to the archetype pool delivered them nowhere (the pool is empty for a
 *     stored build);
 *   · the app models ONE archetype caster and `activeCasterArchetype` takes the first match, so
 *     placing this entry early took the spellcasting away from Spellshot + Beast Gunner — the one
 *     dedication pairing the record's own Special clause legalises;
 *   · a blanket "counts as Wizard Dedication" token opened Arcane School Spell, which archetype-122
 *     does not list and which hands out a focus point and a wizard school focus spell.
 *
 * MUTATION-PROVED (every leg fails when its fix is reverted):
 *   · delete the `'spellshot-dedication'` entry from CASTER_ARCHETYPES (src/rules/casterArchetypes.ts)
 *     → "the dedication is a caster archetype at all" and every slot-ladder case fail;
 *   · delete the `DEDICATION_COUNTS_AS` loop in `checkPrerequisites` (src/rules/build.ts)
 *     → "the wizard ladder is reachable" fails;
 *   · drop the `LEGACY_ARCHETYPE_CANTRIP_KEYS` fallback at the `srcCantripsRaw` read (build.ts)
 *     → "a spellshot built before this keeps the two cantrips they picked" fails;
 *   · move `'spellshot-dedication'` back above `'beast-gunner-dedication'` in CASTER_ARCHETYPES
 *     → "Spellshot + Beast Gunner keeps the beast gunner's repertoire" fails;
 *   · key the legacy fallback on `arch.dedicationId` instead of the dedications the character HOLDS
 *     → "…and the spellshot's stored cantrips survive that pairing" fails;
 *   · drop `notOnItsList` from DEDICATION_COUNTS_AS → "Master Wizard Spellcasting is not on the
 *     spellshot's list" fails;
 *   · widen `forFeats` back to a blanket token → "…and nothing the archetype does not list" fails;
 *   · drop the `alsoCounts` credit in `dedicationBlock` (src/rules/build.ts) → "…and the borrowed
 *     wizard rungs count as the spellshot feats they are printed as" fails, "Take 2 more feats…";
 *   · drop `redundantFallback` from the `spellshot-dedication` row in featGrantsAuto.ts → "the
 *     dedication's Arcana training is the replacement skill" fails (no question, no free skill).
 */

const db = content();

/** A synthetic spellshot — the gunslinger way plus the dedication the way forces at 2nd level. */
const spellshot = (level: number, picks: Record<string, string> = {}, over: Record<string, unknown> = {}) =>
  build('gunslinger', level, {
    subclassId: 'way-of-the-spellshot',
    featPicks: { '2:class': 'spellshot-dedication', ...picks },
    ...over,
  });

const entryOf = (ch: Character) => ch.spellcasting.find((e) => e.id === 'spellshot-dedication-casting');
const ranksOf = (ch: Character) =>
  Object.keys(entryOf(ch)?.prepared ?? {})
    .map(Number)
    .sort((a, b) => a - b);

/** The ladder, with the feats that unlock it. Basic at 4th, Expert at 12th — the levels they print. */
const LADDER = { '4:class': 'basic-wizard-spellcasting', '12:class': 'expert-wizard-spellcasting' };

describe('Spellshot Dedication is a caster archetype', () => {
  it('the dedication is a caster archetype at all', () => {
    expect(CASTER_ARCHETYPES['spellshot-dedication'], 'spellshot is not in CASTER_ARCHETYPES').toBeDefined();
  });

  it('at 2nd level it is a PREPARED arcane entry keyed on Intelligence, trained', () => {
    const e = entryOf(spellshot(2));
    expect(e, 'a spellshot has no spellcasting entry').toBeDefined();
    // *"You cast arcane spells like a wizard"* — a spellbook caster, not a repertoire.
    expect(e!.type).toBe('prepared');
    expect(e!.tradition).toBe('arcane');
    expect(e!.keyAbility).toBe('int');
    // *"You're trained in the spell attack modifier and spell DC statistics."*
    expect(e!.proficiency).toBe('trained');
  });

  it('the dedication alone grants no ranked slots', () => {
    expect(ranksOf(spellshot(8))).toEqual([]);
  });

  it('two cantrips prepared, however many the player picked', () => {
    // *"gaining a spellbook with four common arcane cantrips … You can PREPARE TWO cantrips each day"* —
    // the pool holds four, the entry delivers the two that are live.
    const e = entryOf(spellshot(2, {}, { cantrips: ['detect-magic', 'electric-arc', 'light', 'shield'] }));
    expect(e!.cantrips).toEqual(['detect-magic', 'electric-arc']);
  });

  it('a gunslinger on another way has no arcane entry at all', () => {
    const ch = build('gunslinger', 8, { subclassId: 'way-of-the-sniper' });
    expect(ch.spellcasting.find((e) => e.tradition === 'arcane')).toBeUndefined();
  });
});

describe('the wizard ladder is the spellshot ladder', () => {
  it('the wizard ladder is reachable — Basic Wizard Spellcasting and Basic Arcana', () => {
    const ch = spellshot(4);
    for (const id of ['basic-wizard-spellcasting', 'basic-arcana']) {
      const r = checkPrerequisites(db.feats[id], ch, db);
      expect(r.met, `${id} still unmet for a spellshot: ${r.unmet.join(', ')}`).toBe(true);
    }
  });

  it('…and is still closed to a gunslinger who never took the dedication', () => {
    const plain = build('gunslinger', 4, { subclassId: 'way-of-the-sniper' });
    expect(checkPrerequisites(db.feats['basic-wizard-spellcasting'], plain, db).met).toBe(false);
  });

  it('…and reaches nothing the archetype does not list', () => {
    // *"This counts as the wizard archetype FOR THE BENEFITS OF BASIC WIZARD SPELLCASTING"* — one named
    // benefit, not the wizard archetype's door. Arcane School Spell also prints prerequisite "Wizard
    // Dedication", is absent from archetype-122, and carries a focus point plus a wizard school focus
    // spell a spellshot has no school for.
    const r = checkPrerequisites(db.feats['arcane-school-spell'], spellshot(20), db);
    expect(r.met, 'a spellshot qualifies for a wizard school focus spell').toBe(false);
  });

  it('Basic Wizard Spellcasting opens ranks 1-3 on the printed schedule', () => {
    expect(ranksOf(spellshot(4, { '4:class': LADDER['4:class'] })), 'rank 1 at 4th').toEqual([1]);
    expect(ranksOf(spellshot(6, { '4:class': LADDER['4:class'] })), 'rank 2 at 6th').toEqual([1, 2]);
    expect(ranksOf(spellshot(8, { '4:class': LADDER['4:class'] })), 'rank 3 at 8th').toEqual([1, 2, 3]);
  });

  it('Expert Wizard Spellcasting opens ranks 4-6 and raises the proficiency', () => {
    expect(ranksOf(spellshot(12, LADDER))).toEqual([1, 2, 3, 4]);
    expect(ranksOf(spellshot(14, LADDER))).toEqual([1, 2, 3, 4, 5]);
    expect(ranksOf(spellshot(16, LADDER))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(entryOf(spellshot(12, LADDER))!.proficiency).toBe('expert');
  });

  it('a prepared slot holds the spell the player put in it', () => {
    const ch = spellshot(8, { '4:class': LADDER['4:class'] }, { spells: { 1: ['magic-missile'], 3: ['fireball'] } });
    expect(entryOf(ch)!.prepared![1][0].spellId).toBe('magic-missile');
    expect(entryOf(ch)!.prepared![3][0].spellId).toBe('fireball');
  });

  it('the ladder stops at expert, as the archetype\'s own feat list does', () => {
    // archetype-122 lists Spellshot Dedication · Basic Arcana · Basic Wizard Spellcasting · Spell-Woven
    // Shot · Advanced Arcana · Fulminating Shot · Arcane Breadth · Call Gun · Expert Wizard
    // Spellcasting · Phase Bullet · Black Powder Embodiment. Master Wizard Spellcasting is not on it.
    expect(CASTER_ARCHETYPES['spellshot-dedication'].masterId).toBeUndefined();
  });
});

describe('the record says what it does', () => {
  it('the spellbook is not a pile of innate at-will cantrips', () => {
    const rec = db.feats['spellshot-dedication'];
    expect(rec.effectChoices, 'innate cantrip picks would double-grant beside the archetype pool').toBeUndefined();
    expect(rec.spellcastingGrant, 'the casting profile belongs to the archetype entry').toBeUndefined();
    expect(spellshot(8).spellcasting.some((e) => e.type === 'innate')).toBe(false);
  });

  it('the note no longer sends the player to an Override', () => {
    expect(db.feats['spellshot-dedication'].note).not.toMatch(/Override/i);
  });

  it('the Special clause names the two archetypes the import deleted', () => {
    // Shipped as "…two other feats from the or archetypes." — both names gone, sentence grammatical.
    expect(db.feats['spellshot-dedication'].description).toContain(
      'two other feats from the spellshot or beast gunner archetypes',
    );
    expect(db.feats['spellshot-dedication'].description).toContain(
      'counts as the wizard archetype for the benefits of Basic Wizard Spellcasting',
    );
  });

  it('Fulminating Shot and Call Gun keep the clauses the import dropped', () => {
    expect(db.feats['fulminating-shot'].description).toContain('empowering it with a blast of crackling energy');
    expect(db.feats['call-gun'].description).toContain('conjure it directly to your hand from any distant location');
  });

  it('Energy Shot carries the printing its aonId claims', () => {
    for (const bucket of ['classFeatures', 'actions'] as const) {
      const d = db[bucket]['energy-shot'].description!;
      // action-923 (remastered) narrowed the draw and dropped the "shrouding the bullet" clause;
      // the record had the legacy text (action-3692) under the remastered id.
      expect(d, bucket).toContain('You can Interact to draw a crossbow or firearm.');
      expect(d, bucket).not.toContain('shrouding the bullet with potential energy');
    }
  });
});

describe('the way and the gate, which were already right', () => {
  it('Way of the Spellshot trains Arcana and moves the class DC to Intelligence', () => {
    const ch = spellshot(2);
    // *"Way Skill Arcana … You use Intelligence for your class DC."*
    expect(ch.proficiencies.skills.arcana).toBe('trained');
    expect(ch.classDcKeyAbility).toBe('int');
  });

  it('its three deeds are the spellshot ones, on the normal 1/9/15 schedule', () => {
    const way = db.classes.gunslinger!.subclass!.options.find((o) => o.id === 'way-of-the-spellshot')!;
    expect(way.featureIds).toEqual([
      { id: 'energy-shot', level: 1 },
      { id: 'recall-ammunition', level: 9 },
      { id: 'dispelling-bullet', level: 15 },
    ]);
  });

  it('a build made before the archetype existed keeps the two cantrips it picked', () => {
    // The record USED to ask for its spellbook cantrips itself, as two innate `effectChoices`
    // (`spellbook-cantrip-1` / `-2`). Those questions are gone; the stored ANSWERS are not, and a
    // player's two picks may not quietly stop existing because the app changed its mind about where
    // cantrips live. Read only while the archetype pool is empty — see LEGACY_ARCHETYPE_CANTRIP_KEYS.
    const stored = {
      'spellshot-dedication:spellbook-cantrip-1': 'electric-arc',
      'spellshot-dedication:spellbook-cantrip-2': 'detect-magic',
    };
    expect(entryOf(spellshot(4, {}, { effectChoices: stored }))!.cantrips).toEqual(['electric-arc', 'detect-magic']);
    // …and a pick made in the archetype's own picker wins, so re-answering there migrates it.
    expect(entryOf(spellshot(4, {}, { effectChoices: stored, cantrips: ['light'] }))!.cantrips).toEqual(['light']);
  });

  it('Spellshot + Beast Gunner keeps the beast gunner\'s repertoire', () => {
    // The app models ONE archetype caster (activeCasterArchetype returns the first match), and this is
    // the one dedication pairing the Special clause below legalises. A beast gunner's spontaneous
    // repertoire, cantrips and slots must not be replaced by the spellshot's prepared entry on an
    // update — nothing asked the player. Ordering in CASTER_ARCHETYPES is what holds it.
    const both = spellshot(6, { '4:class': 'beast-gunner-dedication' });
    const bgOnly = build('gunslinger', 6, {
      subclassId: 'way-of-the-drifter',
      featPicks: { '2:class': 'beast-gunner-dedication' },
    });
    const bg = (ch: Character) => ch.spellcasting.find((e) => e.id === 'beast-gunner-dedication-casting');
    expect(bg(both)).toEqual(bg(bgOnly));
    expect(bg(both)?.type).toBe('spontaneous');
    // …and the pairing does NOT also get a second, prepared archetype entry.
    expect(both.spellcasting.find((e) => e.id === 'spellshot-dedication-casting')).toBeUndefined();
  });

  it('…and the spellshot\'s stored cantrips survive that pairing', () => {
    /*
     * The pool belongs to the beast gunner here, so the legacy fallback cannot be keyed on whichever
     * dedication WON it — the spellshot's two stored answers would be delivered nowhere, which is the
     * app's first rule broken by the very fix that protects the pairing. Before the archetype had a
     * table entry those two shipped as at-will INNATE arcane cantrips, so that is where they land.
     */
    const stored = {
      'spellshot-dedication:spellbook-cantrip-1': 'electric-arc',
      'spellshot-dedication:spellbook-cantrip-2': 'detect-magic',
    };
    const both = spellshot(6, { '4:class': 'beast-gunner-dedication' }, { effectChoices: stored });
    const innate = both.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips, 'the spellshot lost both stored cantrips to the pairing').toEqual([
      'electric-arc',
      'detect-magic',
    ]);
    // Attributed to the feat that asked, not to the archetype that owns the pool.
    expect(innate?.spellSources?.['electric-arc']).toBe('Spellshot Dedication');
    // The beast gunner's own entry is untouched by them.
    expect(both.spellcasting.find((e) => e.id === 'beast-gunner-dedication-casting')?.cantrips).toEqual([]);
  });

  it('Master Wizard Spellcasting is not on the spellshot\'s list', () => {
    /*
     * archetype-122 ends at Expert Wizard Spellcasting. Master's OWN prerequisite line is *"Expert
     * Wizard Spellcasting, legendary in Arcana"* — it names no dedication — so opening the bottom rung
     * to a spellshot leaves this one clear by accident, and with no `masterId` on the table entry it
     * would grant a level-18 class feat's worth of nothing. Blocked outright, and the sentence says why.
     */
    // Legendary in Arcana, so the feat's own printed line is MET and the wall is the only thing left.
    const legendaryArcana = { skillIncreases: { 3: 'arcana', 7: 'arcana', 15: 'arcana' } };
    const l18 = spellshot(
      18,
      { '4:class': 'basic-wizard-spellcasting', '12:class': 'expert-wizard-spellcasting' },
      legendaryArcana,
    );
    const r = checkPrerequisites(db.feats['master-wizard-spellcasting'], l18, db);
    expect(r.met, 'a spellshot can take a rung the archetype does not list, and it grants nothing').toBe(false);
    expect(r.unmet.join(' ')).toContain("Spellshot archetype's feat list");
    // …but a character who actually took Wizard Dedication is a member and keeps it: the only line left
    // is the real skill prerequisite.
    const alsoWizard = spellshot(
      18,
      {
        '4:class': 'basic-wizard-spellcasting',
        '6:class': 'wizard-dedication',
        '12:class': 'expert-wizard-spellcasting',
      },
      legendaryArcana,
    );
    expect(checkPrerequisites(db.feats['master-wizard-spellcasting'], alsoWizard, db)).toEqual({ met: true, unmet: [] });
  });

  it('the Special clause lets Beast Gunner Dedication through and nothing else', () => {
    // *"You can't select another dedication feat other than Beast Gunner Dedication until you've gained
    // two other feats from the spellshot or beast gunner archetypes."*
    const taken = ['spellshot-dedication'];
    expect(dedicationBlock(taken, db.feats['beast-gunner-dedication'], db)).toBeNull();
    expect(dedicationBlock(taken, db.feats['wizard-dedication'], db)).not.toBeNull();
    // …and two spellshot feats open it.
    expect(dedicationBlock([...taken, 'fulminating-shot', 'call-gun'], db.feats['wizard-dedication'], db)).toBeNull();
  });

  it('…and the borrowed wizard rungs count as the spellshot feats they are printed as', () => {
    /*
     * The two rungs the dedication's own permission reaches are on archetype-122 — the Archives tag
     * Basic Arcana and Basic Wizard Spellcasting `archetype: ["Wizard","Spellshot"]` — but ours carry
     * the single string 'wizard', so a spellshot who spent 4th and 6th on exactly the ladder their
     * rewritten note points them at credited nothing and could never take a second dedication.
     * Measured before: "Take 2 more feats from the Spellshot or Beast Gunner archetypes first."
     */
    const taken = ['spellshot-dedication', 'basic-arcana', 'basic-wizard-spellcasting'];
    expect(dedicationBlock(taken, db.feats['wizard-dedication'], db)).toBeNull();
    // One rung is one feat, not two — the credit is per rung, not a flag.
    expect(dedicationBlock(taken.slice(0, 2), db.feats['wizard-dedication'], db)).toContain('1 more feat');
    // …and ONLY the rungs the archetype lists. Two other wizard-archetype feats are the wizard's own.
    const otherWizard = Object.values(db.feats)
      .filter((f) => f.archetype === 'wizard' && !f.traits.includes('dedication'))
      .map((f) => f.id)
      .filter((id) => !['basic-arcana', 'basic-wizard-spellcasting'].includes(id))
      .slice(0, 2);
    expect(otherWizard).toHaveLength(2);
    expect(
      dedicationBlock(['spellshot-dedication', ...otherWizard], db.feats['wizard-dedication'], db),
      'a wizard feat the spellshot archetype does not list bought them a dedication',
    ).not.toBeNull();
  });

  it('the dedication\'s Arcana training is the replacement skill, and it is a real one', () => {
    /*
     * *"You become trained in Arcana; if you were already trained in Arcana, you instead become
     * trained in a skill of your choice."* (feat-3267.) Way of the Spellshot's way skill IS Arcana and
     * the dedication is forced at 2nd level, so for a spellshot the replacement branch is the ONLY
     * branch — the printed benefit is always a free skill of their choice, never the Arcana they have.
     *
     * The engine models it as a PICK (FEAT_GRANTS `redundantFallback` → Character.skillFallbacks →
     * the builder's "Already trained in Arcana — replacement skill" card), so an unanswered spellshot
     * trains nothing extra and an answered one trains one more skill than another way. Both halves are
     * asserted: the pending question has to exist, or the card never appears and the pick is dead.
     */
    const trained = (ch: Character) =>
      Object.entries(ch.proficiencies.skills).filter(([, r]) => r !== 'untrained').length;
    const sniper = build('gunslinger', 2, { subclassId: 'way-of-the-sniper' });
    const pending = spellshot(2);
    expect(pending.skillFallbacks ?? [], 'no replacement-skill question, so the printed benefit is unreachable')
      .toContainEqual(expect.objectContaining({ featId: 'spellshot-dedication', skill: 'arcana' }));
    expect(trained(pending), 'an unanswered pick must not silently train a skill').toBe(trained(sniper));
    const answered = spellshot(2, {}, { featSkillChoices: { 'spellshot-dedication:fallback:arcana': 'stealth' } });
    expect(trained(answered)).toBe(trained(sniper) + 1);
    expect(answered.proficiencies.skills.stealth).toBe('trained');
  });
});
