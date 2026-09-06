import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Batch-030, WG-comparison lane — the DATA-ROWS family.
 *
 * Sixteen findings, fifteen of which are one authored field on one shipped record. Every assertion
 * below reads `public/core.json` through `content()` and pins the field the driver's backfill row
 * writes, so the test fails today for exactly one reason (the field is absent or wrong) and passes
 * once the row lands. The two behavioural cases patch the field IN MEMORY instead of asserting a
 * patched-vs-shipped delta, so they prove the reader does what the row is for and do not flip.
 */
const db = () => content();
const feat = (id: string) => db().feats[id] as Record<string, unknown> | undefined;
const item = (id: string) => db().items[id] as Record<string, unknown> | undefined;

/** A content copy with one field patched onto one feat — the shipped db is cached and shared. */
function withFeatField(id: string, field: string, value: unknown): ContentDatabase {
  const base = db();
  return { ...base, feats: { ...base.feats, [id]: { ...base.feats[id], [field]: value } } } as ContentDatabase;
}

function buildWith(dbase: ContentDatabase, classId: string, level: number, over: Partial<BuildState>) {
  const cls = dbase.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(dbase.ancestries)[0],
      backgroundId: Object.keys(dbase.backgrounds)[0],
      keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    dbase,
  );
}

describe('grasping-corpses marks Mobbing Assault', () => {
  // batch 030: grasping-corpses
  it('carries the off-guard rider as an action mark on the row the necrologist uses', () => {
    // "A creature that is damaged by your horde's Mobbing Assault is off-guard until the beginning of
    // your next turn" (AoN feat-7966) is printed ABOUT another record's action, so the only surface
    // that can carry it is that action's row — MainTab renders 'action' marks for every row.
    expect(db().actions['mobbing-assault']).toBeTruthy();
    const marks = feat('grasping-corpses')?.recordMarks as { on: string; id: string; note: string }[] | undefined;
    expect(marks?.map((m) => `${m.on}:${m.id}`)).toEqual(['action:mobbing-assault']);
    expect(marks?.[0].note).toMatch(/off-guard/i);
  });
});

describe('defensive-stratagem marks Devise a Stratagem', () => {
  // batch 030: defensive-stratagem
  it('names the third stratagem option and its Strike restriction at the point of choice', () => {
    // The +1 half already ships in situationalBonuses; the option itself and "You can't attempt to
    // Strike the target until the start of your next turn" (AoN feat-5956) are a COST, which no
    // situational entry can carry, so they go on the Devise a Stratagem row.
    expect(db().actions['devise-a-stratagem']).toBeTruthy();
    const marks = feat('defensive-stratagem')?.recordMarks as { on: string; id: string; note: string }[] | undefined;
    expect(marks?.map((m) => `${m.on}:${m.id}`)).toEqual(['action:devise-a-stratagem']);
    expect(marks?.[0].note).toMatch(/can't attempt to Strike/i);
  });
});

describe('instinctive-maneuvers marks Relinquish Control', () => {
  // batch 030: instinctive-maneuvers
  it('adds the four maneuvers to the Relinquish Control entry', () => {
    // "you add Grapple, Reposition, Shove, and Trip to the list of actions you can take" (AoN
    // feat-7136). Relinquish Control prints a CLOSED list, so the extension is not a modifier and
    // has no home but a 'feature' mark on that feat's own entry.
    const marks = feat('instinctive-maneuvers')?.recordMarks as { on: string; id: string; note: string }[] | undefined;
    expect(marks?.map((m) => `${m.on}:${m.id}`)).toEqual(['feature:relinquish-control']);
    for (const a of ['Grapple', 'Reposition', 'Shove', 'Trip']) expect(marks?.[0].note).toContain(a);
  });
});

describe('transcribe-moment casting profile', () => {
  // batch 030: transcribe-moment
  it('is arcane and Intelligence-keyed, so a non-caster Scrollmaster stops casting it occult', () => {
    // "You gain the Transcribe Moment focus spell" (AoN feat-2235) with no tradition of its own;
    // without a profile build.ts falls through to 'occult' and the class's first key attribute.
    expect(feat('transcribe-moment')?.spellcastingGrant).toEqual({ tradition: 'arcane', keyAbility: 'int', proficiency: 'trained' });
  });

  // batch 030: transcribe-moment
  it('makes the fighter Scrollmaster focus entry arcane/int rather than occult/dex', () => {
    const patched = withFeatField('transcribe-moment', 'spellcastingGrant', { tradition: 'arcane', keyAbility: 'int', proficiency: 'trained' });
    const ch = buildWith(patched, 'fighter', 8, { featPicks: { '8:class': 'transcribe-moment' } });
    const focus = ch.spellcasting.find((s) => s.type === 'focus');
    expect(focus?.tradition).toBe('arcane');
    expect(focus?.keyAbility).toBe('int');
  });
});

describe('arcane-breadth targets the wizard archetype pool', () => {
  // batch 030: arcane-breadth
  it('names the wizard-dedication-casting entry, as its five siblings do', () => {
    // "Increase the spell slots you gain from WIZARD ARCHETYPE FEATS by 1…" (AoN feat-5111).
    // Untargeted, slotEntryFor lands the slots on the character's own class caster instead.
    expect(feat('arcane-breadth')?.spellSlotBonus).toEqual({ perRank: 1, exceptHighest: 2, entryId: 'wizard-dedication-casting' });
    // The shape is the siblings', unchanged.
    expect((feat('occult-breadth')?.spellSlotBonus as { entryId: string }).entryId).toBe('bard-dedication-casting');
  });
});

describe('cantrip-supremacy gives the Hedge Mage keepsake 10 more cantrips', () => {
  // batch 030: cantrip-supremacy
  it('carries the archetype-scoped cantrip bonus the record shipped without', () => {
    // "Add 10 additional cantrips to your keepsake. You can also prepare 10 additional cantrips from
    // your keepsake each day." (AoN feat-9332). The entryId is the ARCHETYPE entry, not
    // `<classId>-casting`, so cantripBonusFor skips it and the class cantrip cap is untouched.
    expect(feat('cantrip-supremacy')?.spellSlotBonus).toEqual({ entryId: 'hedge-mage-dedication-casting', cantrips: 10 });
  });
});

describe('selfless-parry rewrites Dueling Parry and Dueling Riposte', () => {
  // batch 030: selfless-parry
  it('marks both target feats and promises the holder no AC bonus of their own', () => {
    // "allies adjacent to you gain a +1 circumstance bonus to AC" (AoN feat-6315) — the bonus lands
    // on ALLIES, so this is deliberately a 'feature' mark and NOT a situational AC entry.
    const marks = feat('selfless-parry')?.recordMarks as { on: string; id: string; note: string }[] | undefined;
    expect(marks?.map((m) => `${m.on}:${m.id}`)).toEqual(['feature:dueling-parry', 'feature:dueling-riposte']);
    expect(marks?.[0].note).toMatch(/allies adjacent to you/i);
    expect(marks?.[1].note).toMatch(/critically fails a Strike against an ally/i);
  });
});

describe('kaiju-stance Shattering Earth keeps its fatal die', () => {
  // batch 030: kaiju-stance#fatal
  it('stores the trait in the hyphen form every fatal reader anchors on', () => {
    // "…have the backswing, fatal d12, reach, and unarmed traits" (AoN feat-7110). Stored as the
    // space form "fatal d12" it matches neither /^fatal-(d\d+)$/ (derive.ts:4555) nor
    // /^fatal(?:-aim)?-(d\d+)$/ (derive.ts:4264), so the Strike showed no fatal crit die at all.
    const strike = (db().stances!['kaiju-stance'] as { strikes: { traits: string[] }[] }).strikes[0];
    expect(strike.traits).toEqual(['backswing', 'fatal-d12', 'reach', 'unarmed']);
    expect(strike.traits.some((t) => /^fatal-(d\d+)$/.test(t))).toBe(true);
  });
});

describe('thoughtsense upgrades while the psyche is Unleashed', () => {
  // batch 030: thoughtsense
  it('keeps the standing vague sense and adds an imprecise one behind the toggle', () => {
    // "While your Psyche is Unleashed, your thoughtsense upgrades to an imprecise sense" (AoN
    // feat-8330). addSense keeps the better acuity, so the imprecise entry supersedes the vague one
    // only while the toggle is on.
    expect(feat('thoughtsense')?.senses).toEqual([{ name: 'thoughtsense', range: 30, acuity: 'vague' }]);
    expect(feat('thoughtsense')?.whileActive).toEqual([{ state: 'unleash-psyche', senses: [{ name: 'thoughtsense', range: 30, acuity: 'imprecise' }] }]);
  });
});

describe('apparition-magic targets the animist archetype pool', () => {
  // batch 030: apparition-magic
  it('names the animist-dedication-casting entry so a non-caster gets the slots at all', () => {
    // "You gain 1 additional spell slot from ANIMIST ARCHETYPE FEATS…" (AoN feat-7223). Untargeted,
    // the bonus reaches the class caster (or, for a martial, nothing).
    expect(feat('apparition-magic')?.spellSlotBonus).toEqual({ perRank: 1, exceptHighest: 2, entryId: 'animist-dedication-casting' });
  });
});

describe('sanguine-transference is learned as a grave spell', () => {
  // batch 030: sanguine-transference
  it('grants the focus spell the feat prints', () => {
    // "You learn the sanguine transference grave spell." (AoN feat-9128). focusSpells is the lane
    // all seven sibling necromancer grave feats use; the Focus Point follows from the spell's own
    // `focus` trait, so no focusPoolBonus is authored.
    expect(feat('sanguine-transference')?.focusSpells).toEqual(['sanguine-transference']);
    expect((db().spells['sanguine-transference'].traits ?? []).includes('focus')).toBe(true);
  });

  // batch 030: sanguine-transference
  it('puts the spell in the necromancer focus entry once the grant exists', () => {
    const patched = withFeatField('sanguine-transference', 'focusSpells', ['sanguine-transference']);
    const ch = buildWith(patched, 'necromancer', 8, { featPicks: { '8:class': 'sanguine-transference' } });
    const focus = ch.spellcasting.find((s) => s.type === 'focus');
    expect(Object.values(focus?.repertoire ?? {}).flat()).toContain('sanguine-transference');
  });
});

describe('boost-summons rewrites the Boost Eidolon spell', () => {
  // batch 030: boost-summons
  it('writes the extra target onto the spell the summoner reads', () => {
    // "When you cast Boost Eidolon, in addition to your eidolon, it also targets your summoned
    // creatures within 60 feet." (AoN feat-2916). RecordMarker.on is 'action'|'condition'|'feature',
    // so a spell rider can only travel as a spellNote.
    expect(feat('boost-summons')?.spellNotes).toEqual([
      { spellId: 'boost-eidolon', note: 'When you cast Boost Eidolon, in addition to your eidolon, it also targets your summoned creatures within 60 feet.' },
    ]);
  });
});

describe('ilverani-purist shifts the Sense Motive degree', () => {
  // batch 030: ilverani-purist
  it('models the crit-failure-to-failure shift on the Perception action', () => {
    // "When you attempt to Sense the Motive of a non-elf humanoid creature and you roll a critical
    // failure, you fail instead." (AoN feat-8136). Sense Motive is a Perception action, so the shift
    // stars Perception and marks the action row — the shape thorough-search already ships.
    const shifts = feat('ilverani-purist')?.degreeShifts as { shift: string; actions?: string[]; perception?: boolean }[] | undefined;
    expect(shifts?.length).toBe(1);
    expect(shifts?.[0].shift).toBe('critFailToFail');
    expect(shifts?.[0].actions).toEqual(['sense-motive']);
    expect(shifts?.[0].perception).toBe(true);
    expect(db().actions['sense-motive']).toBeTruthy();
  });
});

describe('watchers-armband grants its innate Ring of Truth', () => {
  // batch 030: watchers-armband#innate-spell
  it('carries the once-per-day 3rd-rank occult innate spell', () => {
    // "In addition, you can cast Ring of Truth once per day as an innate 3rd-rank occult spell."
    // (AoN equipment-3986). The item's existing once-per-day counter belongs to Find the Plant, a
    // separate activation, so the spell carries its own usesPerDay.
    expect(item('watchers-armband')?.innateSpells).toEqual([{ spellId: 'ring-of-truth', tradition: 'occult', rank: 3, usesPerDay: 1 }]);
    expect(db().spells['ring-of-truth'].rank).toBe(3);
  });
});

describe('dweomerveil asks its tradition at daily preparations', () => {
  // batch 030: dweomerveil#daily-choice
  it('flags the tradition choice as daily so Rest asks it again each morning', () => {
    // "Each day during daily preparations… select one tradition of magic… until your next daily
    // preparations." (AoN equipment-3225). askedAtDailyPrep returns false without `daily`, so the
    // pick was a permanent per-instance select instead of a morning question.
    const choice = item('dweomerveil')?.choice as { daily?: boolean; flag: string; options: unknown[] } | undefined;
    expect(choice?.daily).toBe(true);
    // The rest of the shipped choice is unchanged — this row re-emits the whole field.
    expect(choice?.flag).toBe('veilTradition');
    expect(choice?.options).toHaveLength(4);
  });
});
