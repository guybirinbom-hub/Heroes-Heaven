import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { recordMarkersFor, statHasSituational, explainStat } from '../src/rules/explain';
import { DEGREE_SHIFT_TEXT, FEAT_SITUATIONAL, type DegreeShift } from '../src/rules/situationalBonuses';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * The `degreeShifts` authoring pass shipped 308 records, and an independent verification pass read a
 * sample of them back against their printed text. The authored value lost in every confirmed case —
 * these are corrections to OUR data, not to the rules.
 *
 * ⚠ One test per SHAPE of defect, not per record. Every one of these is a mistake that is easy to
 * make again on the next record of the same shape, and a per-record assertion would guard only the
 * one record that happened to be sampled. Where a shape has several instances, the test walks them
 * all rather than picking the sampled one.
 *
 * The shapes:
 *   1. a two-rung "failure OR critical failure → success" clause, which no value could say
 *   2. a clause that states both directions in one sentence, shipped with only the good half
 *   3. a shift printed under a LATER section, authored onto the level-1 record that names it
 *   4. a shift that names its tracks, starred on all three anyway
 *   5. a shift starred on a statistic the text never rolls
 *   6. a named Lore starred through the `lore` wildcard, which matches every Lore
 *   7. the skill half missing where only the action was marked (ruling Q2 / principle D)
 *   8. an actions list narrowed to the one action the text used as an example
 *   9. a condition belonging to a NEIGHBOURING clause copied onto the shift
 *  10. a qualifier the text puts on the trigger, dropped from it
 */
const db = () => content();

const withFeat = (classId: string, level: number, featId: string): Character => {
  const base = build(classId, level);
  return { ...base, feats: [...base.feats, { featId, source: 'test', level: 1 }] } as Character;
};

/** Every shift authored on one record, whichever collection it lives in. */
function shiftsOf(con: ContentDatabase, bucket: string, id: string): DegreeShift[] {
  const rec = (con as unknown as Record<string, Record<string, { degreeShifts?: DegreeShift[] }>>)[bucket]?.[id];
  return rec?.degreeShifts ?? [];
}

/** The situational lines one record puts on a stat, as the player reads them. */
const linesFrom = (c: Character, con: ContentDatabase, ref: Parameters<typeof explainStat>[2], sourceId: string) =>
  (explainStat(c, con, ref).situational ?? []).filter((s) => s.sourceId === sourceId).map((s) => s.text);

/* ══ SHAPE 1 ═══════════════════════════════════════════════════════════════════════════════════════
 * "when you roll a failure OR CRITICAL FAILURE … you get a success instead."
 *
 * Four records print it and all four were authored `failToSuccess` alone, so a player who had just
 * critically failed read a star saying the rule did not reach them. The two values a reader reaches
 * for are wrong in opposite directions, which is why the enum grew instead:
 *   `failToSuccess` alone — silently drops the worse half, the one the player most needs
 *   `oneBetter`           — moves the crit failure only to a failure, AND invents success → crit
 * ============================================================================================== */
describe('a two-rung failure-or-critical-failure clause carries both rungs', () => {
  // Keyed by the two-degree wording each one prints. reckless-abandon (the non-goblin twin) prints
  // the same sentence and belongs here the moment it is corrected too.
  const TWO_RUNG: [string, string][] = [
    ['feats', 'cooperative-soul'],
    ['feats', 'reckless-abandon-goblin'],
    ['feats', 'commitment-to-protection'],
  ];

  it('each carries failToSuccess AND critFailToSuccess over the same trigger', () => {
    const con = db();
    for (const [bucket, id] of TWO_RUNG) {
      const shifts = shiftsOf(con, bucket, id);
      const kinds = shifts.map((s) => s.shift);
      expect(`${id}: ${kinds.join('+') || 'NOTHING AUTHORED'}`).toBe(`${id}: ${['failToSuccess', 'critFailToSuccess'].join('+')}`);
      // Same trigger on both rungs — they are one printed sentence, and two `when` strings would read
      // as two separate rules the player has to tell apart.
      expect(new Set(shifts.map((s) => s.when)).size).toBe(1);
    }
  });

  it('none of them is oneBetter, which would invent a success → critical success upgrade', () => {
    const con = db();
    for (const [bucket, id] of TWO_RUNG) {
      for (const sh of shiftsOf(con, bucket, id)) expect(`${id}: ${sh.shift}`).not.toBe(`${id}: oneBetter`);
    }
  });

  it('the crit-failure rung reaches the sheet in words, not as a raw enum', () => {
    const con = db();
    // Cooperative Soul is actions-only, so its whole surface is the Aid marker — if the second entry
    // did not render there it would exist nowhere.
    const c = withFeat('fighter', 5, 'cooperative-soul');
    const marks = recordMarkersFor(c, con, 'action', 'aid').filter((m) => m.sourceId === 'cooperative-soul');
    expect(marks.map((m) => m.value).sort()).toEqual(['crit fail → success', 'fail → success']);
    expect(marks.some((m) => m.note?.includes('a critical failure is a success instead'))).toBe(true);
  });

  it('the new wording cannot be read as any other shift', () => {
    // A player who reads "a critical failure is a failure instead" on a record that upgrades them to a
    // success is worse off than one who reads nothing, so no two phrases may collide.
    const phrases = Object.values(DEGREE_SHIFT_TEXT);
    expect(new Set(phrases).size).toBe(phrases.length);
    expect(DEGREE_SHIFT_TEXT.critFailToSuccess).not.toBe(DEGREE_SHIFT_TEXT.critFailToFail);
  });
});

/* ══ SHAPE 2 ═══════════════════════════════════════════════════════════════════════════════════════
 * One sentence, two results. Round 10 caught Dragon's Presence and the even-tempered tanuki shipping
 * the upgrade half and hiding the downgrade; the same shape kept turning up with the SECOND half
 * missing whichever direction it ran in.
 * ============================================================================================== */
describe('a two-sided degree clause carries both halves', () => {
  const BOTH_HALVES: [string, string, string[]][] = [
    // "If you succeed … you critically succeed instead; SIMILARLY, if you fail … you critically fail
    // instead." The downgrade sat in situationalBonuses.ts prose under a comment saying the enum
    // could not say it — true when written, and false since `failToCritFail` landed.
    ['feats', 'conceited-mindset', ['successToCrit', 'failToCritFail']],
    // "if you roll a failure, you get a success instead, AND if you roll a success, you get a critical
    // success instead" — the own-faith clause. Only the success half was authored.
    ['feats', 'student-of-the-canon', ['critFailToFail', 'successToCrit', 'failToSuccess']],
    // "If you have a different ability that would improve the save in this way … a critical failure
    // becomes a failure." Five siblings author both halves; this was the one that did not.
    ['feats', 'well-groomed', ['successToCrit', 'critFailToFail']],
    // Trigger: "You fail OR CRITICALLY FAIL a Fortitude saving throw." Effect: both rungs.
    ['items', 'breastplate-of-the-mountain', ['failToSuccess', 'critFailToFail']],
    // "if you roll a success … critical success instead; if you roll a critical failure … failure
    // instead" — two enumerated rungs, authored as one blanket `oneBetter` that also promised
    // failure → success, a rung the text never grants.
    ['backgrounds', 'nocturnal-navigator', ['successToCrit', 'critFailToFail']],
  ];

  it('every record whose text states two results states them both', () => {
    const con = db();
    for (const [bucket, id, expected] of BOTH_HALVES) {
      const kinds = shiftsOf(con, bucket, id).map((s) => s.shift);
      expect(`${bucket}/${id}: ${kinds.join('+') || 'NOTHING AUTHORED'}`).toBe(`${bucket}/${id}: ${expected.join('+')}`);
    }
  });

  it('both halves reach the same stat row, so neither is the only news the player gets', () => {
    const con = db();
    const c = withFeat('fighter', 5, 'conceited-mindset');
    const lines = linesFrom(c, con, { kind: 'save', save: 'will' }, 'conceited-mindset');
    expect(lines.some((t) => t.startsWith('a success is a critical success instead'))).toBe(true);
    expect(lines.some((t) => t.startsWith('a failure is a critical failure instead'))).toBe(true);
  });

  it('the downgrade is no longer ALSO stated as prose beside its number', () => {
    // It rode along inside the +2's trigger string while the structured field said nothing. One rule,
    // two registries, nothing keeping them in step — the drift `degreeShifts` exists to end.
    const con = db();
    const c = withFeat('fighter', 5, 'conceited-mindset');
    const bonusLines = linesFrom(c, con, { kind: 'save', save: 'will' }, 'conceited-mindset').filter((t) => t.includes('+2 circumstance'));
    expect(bonusLines.length).toBe(1);
    expect(bonusLines[0]).not.toContain('critical failure');
  });

  it('a blanket oneBetter is not used where the text enumerates its rungs', () => {
    // Nocturnal Navigator was the case: `oneBetter` renders "your degree of success is one step
    // better", which promises a failure becomes a success. Its text says nothing about a failure.
    const con = db();
    const c = build('fighter', 3, { backgroundId: 'nocturnal-navigator' });
    const lines = linesFrom(c, con, { kind: 'skill', skill: 'survival' }, 'nocturnal-navigator');
    expect(lines.some((t) => t.includes('one step better'))).toBe(false);
    expect(lines.length).toBe(2);
  });
});

/* ══ SHAPE 3 ═══════════════════════════════════════════════════════════════════════════════════════
 * A subclass record whose description runs every doctrine from 1st to 19th. `ownedFeatureIds` adds
 * the chosen subclass id with NO level check, and `DegreeShift` has no level field, so a clause taken
 * from a later section could not be gated even in principle.
 * ============================================================================================== */
describe('a shift printed under a later section does not reach a 1st-level character', () => {
  const UMBRELLAS: [string, string, string, number][] = [
    // umbrella (level 1) · the level-gated child that really carries it · the level it starts
    ['cleric', 'warpriest', 'fifth-doctrine-warpriest', 15],
    ['cleric', 'battle-creed', 'major-creed', 13],
  ];

  it('the umbrella record carries no shift of its own', () => {
    const con = db();
    for (const [, umbrella] of UMBRELLAS) {
      expect(`${umbrella}: ${shiftsOf(con, 'classFeatures', umbrella).length}`).toBe(`${umbrella}: 0`);
    }
  });

  it('the Fortitude star appears at the printed level and not before', () => {
    const con = db();
    for (const [classId, umbrella, , level] of UMBRELLAS) {
      const early = build(classId, level - 1, { subclassId: umbrella });
      const on = build(classId, level, { subclassId: umbrella });
      // Named in the message rather than asserted bare, so a failure says WHICH doctrine and level.
      expect(`${umbrella}@${level - 1}: ${statHasSituational(early, { kind: 'save', save: 'fortitude' }, con)}`).toBe(`${umbrella}@${level - 1}: false`);
      expect(`${umbrella}@${level}: ${statHasSituational(on, { kind: 'save', save: 'fortitude' }, con)}`).toBe(`${umbrella}@${level}: true`);
    }
  });

  it('and the player is told the rule ONCE at that level, not twice', () => {
    const con = db();
    for (const [classId, umbrella, child, level] of UMBRELLAS) {
      const c = build(classId, level, { subclassId: umbrella });
      const lines = (explainStat(c, con, { kind: 'save', save: 'fortitude' }).situational ?? []).filter((s) =>
        s.text.includes('a success is a critical success instead'),
      );
      expect(`${umbrella}: ${lines.length} line(s) from ${lines.map((l) => l.sourceId).join(',')}`).toBe(`${umbrella}: 1 line(s) from ${child}`);
    }
  });
});

/* ══ SHAPE 4 ═══════════════════════════════════════════════════════════════════════════════════════
 * Q2's `saves: ['all']` is for a clause that applies to saves GENERALLY. A clause whose only referent
 * is a two-track reroll is not save-general, and the third star describes a roll that cannot happen.
 * ============================================================================================== */
describe('a shift that names its save tracks leaves the others alone', () => {
  it('Unshakable Grit stars Fortitude and Will, never Reflex', () => {
    const con = db();
    // Its own text names no save; the narrowing words are in its sole referent, which is also its
    // printed prerequisite — Grit and Tenacity triggers on "You fail a Fortitude or Will save".
    for (const sh of shiftsOf(con, 'feats', 'unshakable-grit')) expect(sh.saves).toEqual(['fortitude', 'will']);
    const c = withFeat('fighter', 9, 'unshakable-grit');
    expect(statHasSituational(c, { kind: 'save', save: 'fortitude' }, con)).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'will' }, con)).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'reflex' }, con)).toBe(false);
  });
});

/* ══ SHAPE 5 ═══════════════════════════════════════════════════════════════════════════════════════
 * The shift landed on a statistic the item never rolls, while the one it does roll stayed bare.
 * ============================================================================================== */
describe('a shift stars the statistic the text actually rolls', () => {
  it('the Breastplate of the Mountain stars Fortitude, not Athletics', () => {
    const con = db();
    // Its activation triggers on a Fortitude saving throw. The word "Athletics" appears nowhere in
    // the item; the Shove clause it might be mistaken for reduces forced movement and is not a roll.
    for (const sh of shiftsOf(con, 'items', 'breastplate-of-the-mountain')) {
      expect(sh.saves).toEqual(['fortitude']);
      expect(sh.skills).toBeUndefined();
    }
    const base = build('fighter', 15);
    const worn = { ...base, inventory: [{ itemId: 'breastplate-of-the-mountain', qty: 1, invested: true, equipped: true }] } as unknown as Character;
    expect(statHasSituational(worn, { kind: 'save', save: 'fortitude' }, con)).toBe(true);
    expect(statHasSituational(worn, { kind: 'skill', skill: 'athletics' }, con)).toBe(false);
  });
});

/* ══ SHAPE 6 ═══════════════════════════════════════════════════════════════════════════════════════
 * `targetMatches` reads a bare `lore` as EVERY `lore:*` row. That wildcard is the only shape that can
 * work for "a Lore skill you're trained in" — the registry cannot enumerate subjects it does not
 * know. A feat that NAMES its Lore is the opposite case.
 * ============================================================================================== */
describe('a feat that names one Lore stars that Lore, not every Lore', () => {
  it('Commitment to Protection stars Warfare Lore alone', () => {
    const con = db();
    for (const sh of shiftsOf(con, 'feats', 'commitment-to-protection')) expect(sh.skills).toEqual(['lore:warfare']);
    const c = withFeat('fighter', 9, 'commitment-to-protection');
    expect(statHasSituational(c, { kind: 'skill', skill: 'lore:warfare' } as never, con)).toBe(true);
    // Any other Lore the character owns is a row this rule provably cannot reach.
    expect(statHasSituational(c, { kind: 'skill', skill: 'lore:academia' } as never, con)).toBe(false);
  });

  it('and the wildcard is still used where the subject is the player’s to choose', () => {
    const con = db();
    // Unmistakable Lore: "a Lore subcategory you are trained in" — no subject to name, so `lore` is
    // right there and narrowing it would be the opposite defect.
    expect(shiftsOf(con, 'feats', 'unmistakable-lore')[0]?.skills).toEqual(['lore']);
  });
});

/* ══ SHAPE 7 ═══════════════════════════════════════════════════════════════════════════════════════
 * Ruling Q2 / principle D: star every skill that could perform the named action. An entry with only
 * `actions` is DROPPED by `authoredSituational` ("an actions-only shift is carried entirely by its
 * markers"), so the skill rows are not merely unstarred — the rule is absent from them.
 * ============================================================================================== */
describe('every skill the text says can perform the action is starred', () => {
  it('Crystal Keeper stars all four Decipher Writing skills, and still marks the action', () => {
    const con = db();
    const c = withFeat('fighter', 5, 'crystal-keeper-dedication');
    for (const skill of ['arcana', 'occultism', 'religion', 'society']) {
      expect(`${skill}: ${statHasSituational(c, { kind: 'skill', skill } as never, con)}`).toBe(`${skill}: true`);
    }
    expect(recordMarkersFor(c, con, 'action', 'decipher-writing').some((m) => m.sourceId === 'crystal-keeper-dedication')).toBe(true);
  });
});

/* ══ SHAPE 8 ═══════════════════════════════════════════════════════════════════════════════════════
 * `actions` has no `['all']` sentinel, so an unnamed action row simply stays bare. Narrowing the list
 * to the one action the text used as a parenthetical EXAMPLE silently drops the rest.
 * ============================================================================================== */
describe('an actions list covers every action the trigger covers', () => {
  it('Megafauna Veterinarian marks all four hands-on Medicine actions', () => {
    const con = db();
    // "any of Medicine's trained and untrained uses … if the subject of your care is your megafauna
    // and you roll a success on YOUR CHECK". Treat Wounds is the example in the sentence about which
    // proficiency RANK you use, not the subject of the shift.
    const c = withFeat('ranger', 9, 'megafauna-veterinarian');
    for (const action of ['treat-wounds', 'treat-disease', 'treat-poison', 'administer-first-aid']) {
      const marked = recordMarkersFor(c, con, 'action', action).some((m) => m.sourceId === 'megafauna-veterinarian');
      expect(`${action}: ${marked}`).toBe(`${action}: true`);
    }
  });

  it('a second printed trigger gets its own entry rather than sharing the first one’s', () => {
    const con = db();
    // Emerald Boughs Accustomation's "Furthermore" sentence is a different action (Recall Knowledge)
    // under a different trigger; Empathy Incarnate's Gather Information clause likewise. Both were
    // carried as prose, which stars the skill and never marks the action row.
    const emerald = withFeat('fighter', 5, 'emerald-boughs-accustomation');
    expect(recordMarkersFor(emerald, con, 'action', 'recall-knowledge').some((m) => m.sourceId === 'emerald-boughs-accustomation')).toBe(true);
    expect(recordMarkersFor(emerald, con, 'action', 'subsist').some((m) => m.sourceId === 'emerald-boughs-accustomation')).toBe(true);

    const empathy = withFeat('bard', 9, 'empathy-incarnate');
    const gather = recordMarkersFor(empathy, con, 'action', 'gather-information').find((m) => m.sourceId === 'empathy-incarnate');
    expect(gather?.value).toBe('crit fail → fail');
  });

  it('and neither states its rule twice, in the lane and in prose', () => {
    // Both clauses lived in `FEAT_SITUATIONAL` as prose, in wordings the shipped drift check does not
    // match ("critical failure becomes a failure", "you can't critically fail"). Now that the lane
    // carries them, a surviving prose copy would be the same one-rule-two-registries state the field
    // exists to end — and the two copies would disagree the moment either is edited.
    const PROSE = /critical failure becomes a failure|can'?t critically fail|becomes a critical success/i;
    for (const id of ['emerald-boughs-accustomation', 'empathy-incarnate']) {
      const stated = (FEAT_SITUATIONAL[id] ?? []).filter((b) => PROSE.test(`${b.when} ${b.bonus}`)).map((b) => b.bonus);
      expect(`${id}: ${stated.join(' / ') || 'lane only'}`).toBe(`${id}: lane only`);
    }
  });

  it('each of their lane entries still reads as its own rule on the skill row', () => {
    const con = db();
    // Emerald Boughs states crit-fail → fail under TWO different triggers (Subsist, and Recall
    // Knowledge about cultural practices), so two lines here is the correct answer, not a duplicate.
    // What must never happen is two lines with the same trigger.
    const c = withFeat('fighter', 5, 'emerald-boughs-accustomation');
    const lines = linesFrom(c, con, { kind: 'skill', skill: 'society' } as never, 'emerald-boughs-accustomation');
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines.filter((t) => /Recall Knowledge about cultural practices/i.test(t)).length).toBe(1);
  });
});

/* ══ SHAPE 9 ═══════════════════════════════════════════════════════════════════════════════════════
 * A condition that governs a NEIGHBOURING clause, copied onto the shift. `when` is printed verbatim
 * in the note, so an invented gate tells the player the rule is off when it is on.
 * ============================================================================================== */
describe('a condition from a neighbouring clause does not gate the shift', () => {
  it('Cliffscale Lizardfolk’s climb upgrade is not gated on going barefoot', () => {
    const con = db();
    // "…and AS LONG AS YOU AREN'T WEARING FOOTWEAR, you can use the sticky pads on your feet to climb,
    // leaving your hands free. ADDITIONALLY, if you roll a success on an Athletics check to climb, you
    // get a critical success instead." Foundry implements it with an `action:climb` predicate and no
    // footwear predicate; the app already treats the Combat Climber grant in that sentence as
    // unconditional for the same reason.
    const shifts = shiftsOf(con, 'heritages', 'cliffscale-lizardfolk');
    expect(shifts.length).toBe(1);
    expect(shifts[0].when).not.toMatch(/footwear|hands stay free/i);

    // The hands-free rule keeps its real footwear condition — it moved nowhere, it was only ever the
    // shift that borrowed it.
    const c = build('fighter', 3, { ancestryId: 'lizardfolk', heritageId: 'cliffscale-lizardfolk' });
    const marks = recordMarkersFor(c, con, 'action', 'climb').filter((m) => m.sourceId === 'cliffscale-lizardfolk');
    expect(marks.some((m) => /not wearing footwear/i.test(m.note ?? ''))).toBe(true);
    expect(marks.some((m) => m.value === 'success → crit success')).toBe(true);
  });
});

/* ══ SHAPE 10 ══════════════════════════════════════════════════════════════════════════════════════
 * The mirror image of shape 9: a qualifier the text DOES put on the trigger, dropped on the way in.
 * `DegreeShift.when` is documented as "the trigger, printed verbatim in the note", so a trigger that
 * is missing its own restriction over-promises in exactly the words the player reads.
 * ============================================================================================== */
describe('the trigger keeps every restriction its own sentence puts on it', () => {
  const TRIGGERS: [string, string, RegExp, string][] = [
    // "…to Balance on narrow surfaces or uneven ground WITHIN FORESTS … ONE OF THESE Acrobatics
    // checks" — anaphoric, so the shift inherits the terrain.
    ['heritages', 'rite-of-passage', /within forests/i, 'the forest terrain the clause is scoped to'],
    // "a Fortitude save AFFECTED BY THIS BONUS", and the bonus covers three saves — the third, to
    // REMOVE sickened, was missing while the +2 beside it listed all three.
    ['heritages', 'irongut-goblin', /remove the sickened condition/i, 'the save to remove sickened'],
    // "However, you gain NONE OF THESE BENEFITS against effects originating from alghollthus."
    ['feats', 'alghollthu-bound', /alghollthu/i, 'the carve-out that revokes the shift'],
    // "Choose one of the saving throws you selected for path to perfection OR SECOND PATH TO
    // PERFECTION" — the trigger named only the first, and was byte-identical to another feature's.
    ['classFeatures', 'third-path-to-perfection', /second path to perfection/i, 'the second source of the pick'],
  ];

  it('each names the restriction its printed text states', () => {
    const con = db();
    for (const [bucket, id, needle, what] of TRIGGERS) {
      const shifts = shiftsOf(con, bucket, id);
      expect(`${bucket}/${id}: ${shifts.length}`).not.toBe(`${bucket}/${id}: 0`);
      const carried = shifts.every((s) => needle.test(s.when));
      expect(`${bucket}/${id}: ${carried ? 'ok' : `MISSING ${what}`}`).toBe(`${bucket}/${id}: ok`);
    }
  });

  it('Third Path’s trigger is no longer a copy of Path to Perfection’s', () => {
    const con = db();
    // They are different features with different picks and different shifts; one string for both told
    // a monk their crit-fail protection sat on whichever save they chose eight levels earlier.
    const third = shiftsOf(con, 'classFeatures', 'third-path-to-perfection')[0]?.when;
    const first = shiftsOf(con, 'classFeatures', 'path-to-perfection')[0]?.when;
    expect(third).not.toBe(first);
  });

  it('and a gate that differs between two entries is not flattened onto both', () => {
    const con = db();
    // Vicious Critique: the Success outcome GRANTS the upgrade half ("As critical success, but…"),
    // stripping only the crit-fail half. Both entries had been given the crit-success gate.
    const [up, down] = shiftsOf(con, 'feats', 'vicious-critique');
    expect(up.shift).toBe('successToCrit');
    expect(down.shift).toBe('critFailToFail');
    expect(up.when).toMatch(/success or critical success/i);
    expect(down.when).not.toMatch(/success or critical success/i);
  });
});
