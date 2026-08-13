import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { recordMarkersFor, statHasSituational, explainStat } from '../src/rules/explain';
import { DEGREE_SHIFT_TEXT, FEAT_SITUATIONAL, type DegreeShift } from '../src/rules/situationalBonuses';
import { findUmbrellaIds } from '../src/data';
import type { Character, ContentDatabase, SaveId } from '../src/rules/types';

/**
 * The second half of the `degreeShifts` verification pass — the ITEM-heavy slice, plus the monk's
 * Path to Perfection. Same rule as the file next door: the printed text is right and the authored
 * value was wrong, so every assertion here is a correction to OUR data.
 *
 * ⚠ One test per SHAPE, not per record. Each of these is a mistake that is cheap to repeat on the
 * next record of the same shape, so wherever the shape has a population the test walks the whole
 * corpus rather than the sampled record — three of them below are corpus-wide invariants that no
 * future authoring run can violate without failing here.
 *
 * The shapes, and the records that taught them:
 *  A. "the triggering X" written on a record that prints no Trigger  (monkey-pin, mesmerizing-opal,
 *     shark-tooth-charm — all plain `Activate ⟨1⟩` items)
 *  B. a trigger that names ONE save track, starred on all three      (iron-medallion, star-of-cynosure,
 *     the three stormshards)
 *  C. `skills: ['all']` for a CLOSED candidate set                   (artistic-perfection, possibility-tome)
 *  D. a clause printed under a later GRADE, authored onto the unreachable family head
 *                                                                    (bravos-brew, juggernaut-mutagen)
 *  E. a save the PLAYER chose, starred on all three                  (path-to-perfection)
 *  F. a gate the engine cannot test, dropped from `when`             (desolation-locket-major,
 *     the-vision, hunters-hagbook, monkey-pin)
 *  G. only one of Q2's two surfaces reached                          (eye-of-enlightenment,
 *     matchmaker-fulu, possibility-tome, skinstitch-salve, the-vision, monkey-pin)
 *  H. the two halves of ONE record naming different statistics       (savior-spike, shark-tooth-charm)
 *  I. a two-rung "failure or critical failure → success" clause      (reckless-abandon)
 */
const db = () => content();

/** Every shift authored on one record, whichever collection it lives in. */
function shiftsOf(con: ContentDatabase, bucket: string, id: string): DegreeShift[] {
  const rec = (con as unknown as Record<string, Record<string, { degreeShifts?: DegreeShift[] }>>)[bucket]?.[id];
  return rec?.degreeShifts ?? [];
}

/** Every record in the database carrying a shift, as `[bucket, id, record]`. */
function allShiftRecords(con: ContentDatabase): [string, string, Record<string, unknown>][] {
  const out: [string, string, Record<string, unknown>][] = [];
  for (const [bucket, records] of Object.entries(con as unknown as Record<string, unknown>)) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
    for (const [id, rec] of Object.entries(records as Record<string, Record<string, unknown>>)) {
      if (rec && typeof rec === 'object' && Array.isArray(rec.degreeShifts) && rec.degreeShifts.length) out.push([bucket, id, rec]);
    }
  }
  return out;
}

/** A character carrying one item, in use — the state `degreeShiftRecords` requires of an item. */
const withItem = (itemId: string, classId = 'fighter', level = 10): Character => {
  const base = build(classId, level);
  return { ...base, inventory: [{ itemId, qty: 1, invested: true, equipped: true, worn: true }] } as unknown as Character;
};

const withFeat = (classId: string, level: number, featId: string): Character => {
  const base = build(classId, level);
  return { ...base, feats: [...base.feats, { featId, source: 'test', level: 1 }] } as Character;
};

/** The situational lines one record puts on a stat, as the player reads them. */
const linesFrom = (c: Character, con: ContentDatabase, ref: Parameters<typeof explainStat>[2], sourceId: string) =>
  (explainStat(c, con, ref).situational ?? []).filter((s) => s.sourceId === sourceId).map((s) => s.text);

/**
 * Only the DEGREE-SHIFT lines a record puts on a stat.
 *
 * ⚠ `statHasSituational` is the wrong instrument for "the shift does not reach this row": three of
 * these items ALSO ship an ordinary `+1 item` entry, and one of them (Grappling Vine) legitimately
 * stars Athletics for a different clause of the same item. Asking whether the row has any star at
 * all would have read that correct bonus as the defect still being present.
 */
const shiftLinesFrom = (c: Character, con: ContentDatabase, ref: Parameters<typeof explainStat>[2], sourceId: string) =>
  linesFrom(c, con, ref, sourceId).filter((t) => Object.values(DEGREE_SHIFT_TEXT).some((w) => t.includes(w)));

/* ══ SHAPE A ══════════════════════════════════════════════════════════════════════════════════════
 * Three talismans were authored from one template — `when: 'on the triggering …'` — and only the
 * first one's shape was ever read against its text. A `Activate ⟨1⟩` item has no Trigger line, so
 * the note pointed the player at something the item does not have, and "the triggering check" is
 * also the one wording that cannot be checked against anything: it names no skill, save or action.
 *
 * Corpus-wide, because the template is what did the damage, not the three records.
 * ============================================================================================== */
describe('“the triggering …” is only said by a record that prints a Trigger', () => {
  it('no authored trigger claims a Trigger line its own text does not have', () => {
    const con = db();
    const offenders: string[] = [];
    for (const [bucket, id, rec] of allShiftRecords(con)) {
      const text = String(rec.description ?? '');
      for (const sh of rec.degreeShifts as DegreeShift[]) {
        if (/\btriggering\b/i.test(sh.when) && !/\btrigger\b/i.test(text)) offenders.push(`${bucket}/${id}: ${sh.when}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('and the three activated talismans now name what they actually do', () => {
    const con = db();
    // Each is `Activate ⟨1⟩` with no Trigger. What the word "triggering" was standing in for is
    // different in all three, which is why one template could never have been right for them.
    expect(shiftsOf(con, 'items', 'monkey-pin')[0]?.when).toMatch(/until the end of your turn/i);
    expect(shiftsOf(con, 'items', 'mesmerizing-opal')[0]?.when).toMatch(/Deception check to Feint/i);
    expect(shiftsOf(con, 'items', 'shark-tooth-charm')[0]?.when).toMatch(/Acrobatics check to Escape/i);
    // savior-spike is the one of the three that DOES print "Trigger You attempt to Grab an Edge",
    // so its wording is correct and must not be swept up by the correction.
    expect(shiftsOf(con, 'items', 'savior-spike')[0]?.when).toMatch(/triggering attempt to Grab an Edge/i);
  });
});

/* ══ SHAPE B ══════════════════════════════════════════════════════════════════════════════════════
 * `targetMatches` reads `detail: 'all'` as all three save rows unconditionally. Q2's `['all']` is for
 * a clause that applies to saves GENERALLY; a Trigger line that names one track is the opposite, and
 * the two extra stars promise a rescue on rolls the item cannot be activated for at all.
 * ============================================================================================== */
describe('a trigger that names one save track does not star the other two', () => {
  it('no entry stars all three saves while its own trigger names exactly one', () => {
    const con = db();
    const TRACKS: SaveId[] = ['fortitude', 'reflex', 'will'];
    const offenders: string[] = [];
    for (const [bucket, id, rec] of allShiftRecords(con)) {
      for (const sh of rec.degreeShifts as DegreeShift[]) {
        if (!(sh.saves ?? []).includes('all')) continue;
        const named = TRACKS.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(sh.when));
        if (named.length === 1) offenders.push(`${bucket}/${id}: “${sh.when}” but saves ['all']`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the two Will talismans star Will alone', () => {
    const con = db();
    // "Trigger You attempt a Will save against a fear effect" / "…against a mental spell". The second
    // even REQUIRES master Will proficiency, so it cannot be activated off another track.
    for (const id of ['iron-medallion', 'star-of-cynosure']) {
      const c = withItem(id);
      const on = (save: SaveId) => shiftLinesFrom(c, con, { kind: 'save', save }, id).length;
      expect(`${id}: will ${on('will')}, reflex ${on('reflex')}, fortitude ${on('fortitude')}`).toBe(
        `${id}: will 2, reflex 0, fortitude 0`,
      );
    }
  });

  it('and all three stormshard grades name the basic Fortitude save their own Effect calls for', () => {
    const con = db();
    // Our shipped text has the save type stripped to "( save)" by an import defect, which is why the
    // type could not be read out of the app — it is `@Check[fortitude|basic]` in the Foundry source
    // and "DC 20 basic Fortitude save" on AoN. A whole family authored from unreadable text is the
    // shape here: fixing one grade and not its siblings is the same defect with a smaller blast area.
    for (const id of ['stormshard', 'stormshard-greater', 'stormshard-major']) {
      const shifts = shiftsOf(con, 'items', id);
      expect(`${id}: ${shifts.map((s) => (s.saves ?? []).join('+')).join(' / ')}`).toBe(`${id}: fortitude`);
    }
  });
});

/* ══ SHAPE C ══════════════════════════════════════════════════════════════════════════════════════
 * `skills: ['all']` stars all sixteen skill rows plus every Lore. It is right only where the text's
 * candidate set is genuinely unbounded. Where the record ENUMERATES its skills — and in one case
 * enumerates them in its own `choice` block, two fields on one record contradicting each other — the
 * wildcard promises the relic on rows it can never reach.
 * ============================================================================================== */
describe('the skill wildcard is used only where the text leaves the skill open', () => {
  it('a record that enumerates its own choice options does not then star every skill', () => {
    const con = db();
    // Artistic Perfection: "Your relic enhances your skill with Crafting or Performance. (Choose
    // one.)" — its `choice` block already offered exactly those two, so `['all']` made the record
    // disagree with itself. This is the assertion that keeps the two fields tied together.
    const rec = con.items['artistic-perfection'] as unknown as {
      choice?: { options?: { value: string }[] };
      degreeShifts?: DegreeShift[];
    };
    const offered = (rec.choice?.options ?? []).map((o) => o.value).sort();
    expect(offered.length).toBeGreaterThan(0);
    expect(shiftsOf(con, 'items', 'artistic-perfection')[0]?.skills?.slice().sort()).toEqual(offered);

    const c = withItem('artistic-perfection');
    const on = (skill: string) => shiftLinesFrom(c, con, { kind: 'skill', skill } as never, 'artistic-perfection').length;
    expect(`crafting ${on('crafting')}, performance ${on('performance')}, athletics ${on('athletics')}, stealth ${on('stealth')}`).toBe(
      'crafting 1, performance 1, athletics 0, stealth 0',
    );
  });

  it('a closed list in prose is written out rather than widened to the wildcard', () => {
    const con = db();
    // "Choose one skill: Arcana, Crafting, Medicine, Nature, Occultism, Religion, Society, or a
    // single subcategory of Lore." `lore` stays a wildcard because the SUBJECT is the player's; the
    // eight named skills are not.
    const skills = shiftsOf(con, 'items', 'possibility-tome')[0]?.skills ?? [];
    expect(skills).toContain('lore');
    expect(skills).not.toContain('all');
    const c = withItem('possibility-tome');
    expect(shiftLinesFrom(c, con, { kind: 'skill', skill: 'occultism' }, 'possibility-tome').length).toBe(1);
    expect(shiftLinesFrom(c, con, { kind: 'skill', skill: 'thievery' }, 'possibility-tome')).toEqual([]);
  });

  it('and the wildcard survives where the text really does leave the skill open', () => {
    const con = db();
    // The Eye of Enlightenment's Requirements let any of six knowledge skills be the one you roll,
    // and the Sash of Books names none at all — narrowing these would be the opposite defect.
    for (const id of ['eye-of-enlightenment', 'sash-of-books']) {
      expect(`${id}: ${shiftsOf(con, 'items', id)[0]?.skills?.join(',')}`).toBe(`${id}: all`);
    }
  });
});

/* ══ SHAPE D ══════════════════════════════════════════════════════════════════════════════════════
 * A graded item family has an unpriced SUMMARY row at its head. `findUmbrellaIds` hides those from
 * every picker, and `degreeShifts` is not one of `UMBRELLA_MECHANICAL_FIELDS`, so an entry authored
 * there is unreachable — it looks done and does nothing. Worse, the clause it carried belongs to a
 * LATER grade, so if the head ever became reachable the lesser grade would inherit an 11th-level
 * benefit.
 * ============================================================================================== */
describe('a clause printed under a later grade does not sit on the unreachable family head', () => {
  const FAMILIES: [string, string[]][] = [
    // head, the grades whose own paragraph prints the clause
    ['bravos-brew', ['bravos-brew-greater']],
    ['juggernaut-mutagen', ['juggernaut-mutagen-greater', 'juggernaut-mutagen-major']],
  ];

  it('the head is hidden by findUmbrellaIds and carries no shift', () => {
    const con = db();
    const umbrella = findUmbrellaIds(con.items as unknown as Record<string, unknown>);
    for (const [head] of FAMILIES) {
      expect(`${head} hidden: ${umbrella.has(head)}`).toBe(`${head} hidden: true`);
      expect(`${head} shifts: ${shiftsOf(con, 'items', head).length}`).toBe(`${head} shifts: 0`);
    }
  });

  it('and the grades that print it carry it, so nothing was lost by the removal', () => {
    const con = db();
    for (const [, grades] of FAMILIES) {
      for (const id of grades) expect(`${id}: ${shiftsOf(con, 'items', id).length > 0}`).toBe(`${id}: true`);
    }
  });
});

/* ══ SHAPE E ══════════════════════════════════════════════════════════════════════════════════════
 * "Choose your Fortitude, Reflex, or Will saving throw… When you roll a success on THE CHOSEN saving
 * throw, you get a critical success instead." The answer is not in the record — it is on the
 * character — and `saves` could not say that, so the entry was authored `['all']` and told a monk who
 * had spent the pick on Fortitude that Reflex and Will crit on a success too.
 *
 * `savesFromChoice` names the build answer instead; this is the test that the lane resolves it.
 * ============================================================================================== */
describe('a save the player chose is starred on that row and no other', () => {
  const monk = (level: number, picks: (SaveId | null)[]) => build('monk', level, { pathToPerfection: picks });

  it('the pick reaches the character, not only the proficiency it raised', () => {
    // The ranks alone cannot say WHICH save was the 7th-level pick once two of them are master —
    // buildFromCharacter's own recovery calls the order approximate — so the answers travel too.
    const c = monk(11, ['will', 'fortitude', null]);
    expect(c.pathToPerfection).toEqual(['will', 'fortitude', null]);
    expect(c.proficiencies.saves.will).toBe('master');
    expect(c.proficiencies.saves.fortitude).toBe('master');
  });

  it('stars the chosen save and leaves the other two alone', () => {
    const con = db();
    const c = monk(7, ['will', null, null]);
    expect(shiftsOf(con, 'classFeatures', 'path-to-perfection')[0]?.saves).toBeUndefined();
    expect(statHasSituational(c, { kind: 'save', save: 'will' }, con)).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'reflex' }, con)).toBe(false);
    expect(statHasSituational(c, { kind: 'save', save: 'fortitude' }, con)).toBe(false);
    // The note the player reads is still the record's own trigger.
    expect(linesFrom(c, con, { kind: 'save', save: 'will' }, 'path-to-perfection').join(' ')).toMatch(
      new RegExp(DEGREE_SHIFT_TEXT.successToCrit, 'i'),
    );
  });

  it('the second tier stars the second pick — the rows do not swap or double up', () => {
    const con = db();
    const c = monk(11, ['fortitude', 'reflex', null]);
    const fort = linesFrom(c, con, { kind: 'save', save: 'fortitude' }, 'path-to-perfection');
    const reflex = linesFrom(c, con, { kind: 'save', save: 'reflex' }, 'second-path-to-perfection');
    expect(fort.length).toBe(1);
    expect(reflex.length).toBe(1);
    // Neither feature reaches the row the other one's pick claimed, and Will — unpicked — has neither.
    expect(linesFrom(c, con, { kind: 'save', save: 'reflex' }, 'path-to-perfection')).toEqual([]);
    expect(linesFrom(c, con, { kind: 'save', save: 'fortitude' }, 'second-path-to-perfection')).toEqual([]);
    expect(statHasSituational(c, { kind: 'save', save: 'will' }, con)).toBe(false);
  });

  it('an unanswered pick stars nothing rather than everything', () => {
    const con = db();
    const c = monk(7, [null, null, null]);
    for (const save of ['fortitude', 'reflex', 'will'] as SaveId[]) {
      expect(`${save}: ${statHasSituational(c, { kind: 'save', save }, con)}`).toBe(`${save}: false`);
    }
  });
});

/* ══ SHAPE F ══════════════════════════════════════════════════════════════════════════════════════
 * `degreeShiftRecords` pushes an item the moment it is equipped/worn/invested — there is no affix
 * test, no activation test and no frequency test. So any gate the text puts on the shift can live in
 * exactly one place: `when`, which is printed verbatim in the note. Dropped from there, the star
 * reads as a standing property of owning the item.
 * ============================================================================================== */
describe('a gate the engine cannot test is carried by the trigger', () => {
  const GATED: [string, RegExp, string][] = [
    ['desolation-locket-major', /affixed to your armor/i, 'a spellheart affixed to a WEAPON gets an aura and no shift'],
    ['the-vision', /once per day/i, 'the whole effect is inside a once-per-day activation'],
    ['hunters-hagbook', /coven spell/i, 'the save must be against a coven spell, and costs ending a spell from the book'],
    ['monkey-pin', /until the end of your turn/i, 'the shift covers every Climb to end of turn, not one check'],
  ];

  it('each names its own gate', () => {
    const con = db();
    for (const [id, gate, why] of GATED) {
      const when = shiftsOf(con, 'items', id)[0]?.when ?? '';
      expect(`${id} (${why}): ${gate.test(when)}`).toBe(`${id} (${why}): true`);
    }
  });

  it('and the gate reaches the player, because the note prints the trigger verbatim', () => {
    const con = db();
    const c = withItem('desolation-locket-major');
    const line = linesFrom(c, con, { kind: 'save', save: 'will' }, 'desolation-locket-major').join(' | ');
    expect(line).toMatch(/affixed to your armor/i);
  });
});

/* ══ SHAPE G ══════════════════════════════════════════════════════════════════════════════════════
 * Ruling Q2 is "both" — the skill AND the action. One `degreeShifts` entry fans out to both surfaces
 * so they cannot drift, which only works if the entry NAMES the action its own text names. Six of
 * these named the action in prose inside `when` (or not even there) and marked no action row, so the
 * player looking at Recall Knowledge, Make an Impression or Battle Medicine saw nothing.
 * ============================================================================================== */
describe('one entry reaches both surfaces ruling Q2 names', () => {
  const BOTH: [string, string, string][] = [
    // item, a skill it stars, the action row it must mark
    ['eye-of-enlightenment', 'arcana', 'recall-knowledge'],
    ['matchmaker-fulu', 'diplomacy', 'make-an-impression'],
    ['possibility-tome', 'occultism', 'recall-knowledge'],
    ['skinstitch-salve', 'medicine', 'treat-wounds'],
    ['the-vision', 'lore:warfare', 'recall-knowledge'],
    ['monkey-pin', 'athletics', 'climb'],
    ['mesmerizing-opal', 'deception', 'feint'],
    ['shark-tooth-charm', 'acrobatics', 'escape'],
    ['savior-spike', 'acrobatics', 'grab-an-edge'],
  ];

  it('every corrected record stars its skill and marks its action', () => {
    const con = db();
    for (const [id, skill, action] of BOTH) {
      const c = withItem(id);
      const starred = statHasSituational(c, { kind: 'skill', skill } as never, con);
      const marked = recordMarkersFor(c, con, 'action', action).some((m) => m.sourceId === id);
      expect(`${id}: skill ${starred} / action ${marked}`).toBe(`${id}: skill true / action true`);
    }
  });

  it('a second named activity gets its own mark, not just the first one', () => {
    const con = db();
    // "Trigger You Treat Wounds OR USE BATTLE MEDICINE." Battle Medicine is a curated action row on
    // every sheet, so the second activity had a place to be marked and nothing marking it.
    const c = withItem('skinstitch-salve');
    expect(recordMarkersFor(c, con, 'action', 'battle-medicine').some((m) => m.sourceId === 'skinstitch-salve')).toBe(true);
  });

  it('and the mark carries the same wording the skill row got, from the one entry', () => {
    const con = db();
    const c = withItem('matchmaker-fulu');
    const mark = recordMarkersFor(c, con, 'action', 'make-an-impression').find((m) => m.sourceId === 'matchmaker-fulu');
    expect(mark?.note).toContain(DEGREE_SHIFT_TEXT.critFailToFail);
    expect(linesFrom(c, con, { kind: 'skill', skill: 'diplomacy' }, 'matchmaker-fulu').join(' ')).toContain(
      DEGREE_SHIFT_TEXT.critFailToFail,
    );
  });
});

/* ══ SHAPE H ══════════════════════════════════════════════════════════════════════════════════════
 * The worst of the set: a shift starred on a statistic the item's text never rolls. Each of these
 * items ALSO ships a `situational` +1 for the same activation, and that half was right all along —
 * so one printed sentence was starring two disjoint pairs of rows, and the player looking up the
 * number found the bonus without the shift, or the shift without the bonus.
 * ============================================================================================== */
describe('both halves of one activation name the same statistics', () => {
  const stats = (targets: { kind: string; detail?: string }[]) =>
    targets.filter((t) => t.kind === 'skill' || t.kind === 'save').map((t) => `${t.kind}:${t.detail}`);

  it('the +1 and the degree shift agree, record by record', () => {
    const con = db();
    for (const id of ['savior-spike', 'shark-tooth-charm', 'monkey-pin', 'desolation-locket-major']) {
      const bonusStats = new Set((FEAT_SITUATIONAL[id] ?? []).flatMap((b) => stats(b.targets as never)));
      const shiftStats = new Set(
        shiftsOf(con, 'items', id).flatMap((sh) => [
          ...(sh.skills ?? []).map((d) => `skill:${d}`),
          ...(sh.saves ?? []).map((d) => `save:${d}`),
        ]),
      );
      expect(shiftStats.size).toBeGreaterThan(0);
      const stray = [...shiftStats].filter((s) => !bonusStats.has(s));
      expect(`${id}: ${stray.join(', ') || 'none'}`).toBe(`${id}: none`);
    }
  });

  it('the Shark-Tooth Charm no longer stars Athletics or the Swim action', () => {
    const con = db();
    // The words "Swim" and "Athletics" appear nowhere in the item, in either printing.
    const c = withItem('shark-tooth-charm');
    expect(shiftLinesFrom(c, con, { kind: 'skill', skill: 'athletics' }, 'shark-tooth-charm')).toEqual([]);
    expect(statHasSituational(c, { kind: 'skill', skill: 'athletics' }, con)).toBe(false);
    expect(recordMarkersFor(c, con, 'action', 'swim').some((m) => m.sourceId === 'shark-tooth-charm')).toBe(false);
  });

  it('the Savior Spike stars the Reflex save Grab an Edge really offers', () => {
    const con = db();
    // "You must succeed at your choice of an Acrobatics check or a Reflex save" — the shift has to
    // reach both, because either is the roll the item was activated for.
    const c = withItem('savior-spike');
    expect(shiftLinesFrom(c, con, { kind: 'save', save: 'reflex' }, 'savior-spike').length).toBe(2);
    expect(shiftLinesFrom(c, con, { kind: 'skill', skill: 'acrobatics' }, 'savior-spike').length).toBe(2);
    expect(shiftLinesFrom(c, con, { kind: 'skill', skill: 'athletics' }, 'savior-spike')).toEqual([]);
  });

  it('and a shift on a roll the lane cannot target is withdrawn, not aimed at a neighbour', () => {
    const con = db();
    // Grappling Vine: "Make an attack roll as you would when using a grappling hook, but if you roll
    // a critical failure ON THE CHECK to secure the vine, you get a failure instead." An attack roll
    // has no `DegreeShift` target, and the Athletics star it carried was borrowed from the item's
    // separate Climb clause — a row this sentence never touches.
    expect(shiftsOf(con, 'items', 'grappling-vine')).toEqual([]);
    const c = withItem('grappling-vine');
    expect(shiftLinesFrom(c, con, { kind: 'skill', skill: 'athletics' }, 'grappling-vine')).toEqual([]);
    // The Climb clause's own +1 status is a DIFFERENT sentence of the same item and stays starred —
    // withdrawing the shift must not take the working half of the record with it.
    expect(linesFrom(c, con, { kind: 'skill', skill: 'athletics' }, 'grappling-vine').join(' ')).toMatch(/Climb/i);
  });
});

/* ══ SHAPE I ══════════════════════════════════════════════════════════════════════════════════════
 * The fourth record of the two-rung shape, and the twin of the goblin feat the file next door
 * covers: "if you roll a failure OR CRITICAL FAILURE on a saving throw against a harmful effect, you
 * get a success instead." Authored `failToSuccess` alone, the star told a player who had just
 * critically failed that the rule did not reach them.
 * ============================================================================================== */
describe('Reckless Abandon carries both rungs of its own sentence', () => {
  it('failToSuccess AND critFailToSuccess, over one trigger', () => {
    const con = db();
    const shifts = shiftsOf(con, 'feats', 'reckless-abandon');
    expect(shifts.map((s) => s.shift)).toEqual(['failToSuccess', 'critFailToSuccess']);
    expect(new Set(shifts.map((s) => s.when)).size).toBe(1);
  });

  it('and the crit-failure rung reaches the save row in words', () => {
    const con = db();
    const c = withFeat('barbarian', 15, 'reckless-abandon');
    const lines = linesFrom(c, con, { kind: 'save', save: 'fortitude' }, 'reckless-abandon').join(' | ');
    expect(lines).toContain(DEGREE_SHIFT_TEXT.critFailToSuccess);
    expect(lines).toContain(DEGREE_SHIFT_TEXT.failToSuccess);
  });
});
