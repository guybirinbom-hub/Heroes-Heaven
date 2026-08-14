import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { content, build } from './_content';
import { buildCharacter, buildChoiceOptions, emptyBuild, type BuildState } from '../src/rules/build';
import { adoptedAncestryIds, eligibleFeatsForSlot } from '../src/rules/featSlots';
import { characterSenseKeys, senseGateReason } from '../src/rules/derive';
import { openChoiceOptions } from '../src/rules/openChoice';
import { featFeatGrantsFor, CHOICE_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import { featGrantedCompanions } from '../src/rules/companionGrants';
import { exhaustedGrantReason } from '../src/rules/featGrants';
import {
  scanOnlyAtLevel,
  scanDistinctAcrossTakes,
  scanComputable,
  scanSenseSpelling,
  ONLY_AT_EXEMPT,
} from '../scripts/scan-choice-sets.mjs';

const c = content();

/**
 * BUILDER CHOICE SETS — dead answers, over-wide lists, over-narrow lists, slots that never widen.
 *
 * Each block names what the OLD code produced, because a test that would pass either way is worse
 * than no test. `npm run scan:choices` is the corpus-wide instrument behind the guards at the bottom.
 */

// ─────────────────────────────────────────────────────────── "only at 1st level"
describe('a feat printing "only at 1st level" is offered only in a 1st-level slot', () => {
  const nephilim = (): BuildState => ({
    ...emptyBuild(),
    level: 20,
    ancestryId: 'human',
    classId: 'fighter',
    heritageId: 'nephilim',
  });

  it('Bestial Manifestation is in the level-1 ancestry slot and NOT the level-5 one', () => {
    const b = nephilim();
    const at = (level: number) => eligibleFeatsForSlot(b, c, { level, category: 'ancestry', idx: 0 }).map((f) => f.id);
    // Before `onlyAtLevel` existed, `f.level > p.level` was the only level test — a FLOOR — so a
    // 1st-level feat appeared in every ancestry slot the character ever gained.
    expect(at(1)).toContain('bestial-manifestation');
    expect(at(5)).not.toContain('bestial-manifestation');
    expect(at(9)).not.toContain('bestial-manifestation');
    // …and an ordinary 1st-level nephilim feat is still offered at 5, so the gate is the clause and
    // not a blanket "no 1st-level feats later".
    const ordinary = eligibleFeatsForSlot(b, c, { level: 5, category: 'ancestry', idx: 0 }).filter(
      (f) => f.level === 1 && f.onlyAtLevel == null,
    );
    expect(ordinary.length).toBeGreaterThan(0);
  });

  it('the applier lists every id it authors, so `npm run feat -- <id>` can name an owner', () => {
    // The ids are derived from the scanner at runtime, which is invisible to feat-doctor's owner
    // lookup (it greps scripts/*.mjs for the literal id). Without the written-out list all 27 reported
    // "no authoring script names this record" — an orphan warning on rows that are not orphans. The
    // applier asserts the two agree; this asserts it without running the applier.
    const src = readFileSync('scripts/apply-builder-choice-sets.mjs', 'utf8');
    const block = src.match(/const ONLY_AT_LEVEL_RECORDS = \[([\s\S]*?)\];/)![1];
    const listed = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    const a = scanOnlyAtLevel();
    expect(listed).toEqual([...a.todo, ...a.done].map((r) => r.id).sort());
  });

  it('every record printing the clause carries the field — except the one that cannot', () => {
    const a = scanOnlyAtLevel();
    expect(a.prints.length).toBeGreaterThanOrEqual(28);
    expect(a.todo.map((r) => r.id), 'printed "only at 1st level" but nothing says so').toEqual([]);
    // The exemption is a DIFFERENT defect, kept visible rather than silently skipped: nocturnal-grippli
    // ships as category `general`, general slots start at 3rd, so `onlyAtLevel: 1` would make it
    // takeable in no slot at all.
    expect(Object.keys(ONLY_AT_EXEMPT)).toEqual(['nocturnal-grippli']);
    expect(c.feats['nocturnal-grippli'].category).toBe('general');
    expect(c.feats['nocturnal-grippli'].onlyAtLevel).toBeUndefined();
  });
});

// ─────────────────────────────────────────────── "each time, choose a different …"
describe('a repeatable feat that must choose differently each time greys what it already claimed', () => {
  const twoAssurances = (answer?: string): BuildState => ({
    ...emptyBuild(),
    level: 4,
    ancestryId: 'human',
    classId: 'rogue',
    featPicks: { '1:skill:0': 'assurance', '2:skill:0': 'assurance' },
    featChoices: answer ? { '1:skill:0': answer } : {},
  });
  /** A skill this host is actually trained in — Assurance offers only those. */
  const firstTrained = Object.entries(buildCharacter(twoAssurances(), c).proficiencies.skills).find(
    ([, r]) => r !== 'untrained',
  )![0];

  it('the second Assurance cannot re-take the first one\'s skill', () => {
    const b = twoAssurances(firstTrained);
    const ch = buildCharacter(b, c);
    const def = c.feats['assurance'].choice!;
    const second = buildChoiceOptions('assurance', def, b, c, ch, '2:skill:0');
    const claimed = second.find((o) => o.value === firstTrained);
    // OLD BEHAVIOUR: `kind:'skills'` returned trainedSkillOptions untouched, so the skill came back
    // with `disabled` undefined and the player could build two Assurances on one skill.
    expect(claimed, 'the claimed skill must still be SHOWN — ruling Q27 greys, never hides').toBeTruthy();
    expect(claimed!.disabled).toMatch(/already chosen by another/i);
    // Nothing else is greyed.
    expect(second.filter((o) => o.disabled).map((o) => o.value)).toEqual([firstTrained]);
  });

  it('a take never greys its OWN answer', () => {
    const b = twoAssurances(firstTrained);
    const ch = buildCharacter(b, c);
    const def = c.feats['assurance'].choice!;
    const first = buildChoiceOptions('assurance', def, b, c, ch, '1:skill:0');
    expect(first.find((o) => o.value === firstTrained)?.disabled).toBeUndefined();
  });

  it('an unanswered first take greys nothing', () => {
    const b = twoAssurances();
    const ch = buildCharacter(b, c);
    const def = c.feats['assurance'].choice!;
    expect(buildChoiceOptions('assurance', def, b, c, ch, '2:skill:0').some((o) => o.disabled)).toBe(false);
  });

  it('the array lane works too — Terrain Stalker', () => {
    const b: BuildState = {
      ...emptyBuild(),
      level: 4,
      ancestryId: 'human',
      classId: 'ranger',
      featPicks: { '1:skill:0': 'terrain-stalker', '2:skill:0': 'terrain-stalker' },
      featChoices: { '1:skill:0': 'snow' },
    };
    const ch = buildCharacter(b, c);
    const def = c.feats['terrain-stalker'].choice!;
    const second = buildChoiceOptions('terrain-stalker', def, b, c, ch, '2:skill:0');
    expect(second.find((o) => o.value === 'snow')?.disabled).toMatch(/already chosen/i);
    expect(second.find((o) => o.value === 'rubble')?.disabled).toBeUndefined();
  });

  it('a feat WITHOUT the clause is unaffected', () => {
    // The flag is opt-in: most repeatable feats may legitimately repeat an answer, and a blanket rule
    // would have been wrong for all of them.
    const b: BuildState = {
      ...emptyBuild(),
      level: 4,
      ancestryId: 'human',
      classId: 'fighter',
      featPicks: { '1:skill:0': 'additional-lore', '2:skill:0': 'additional-lore' },
      featChoices: { '1:skill:0': 'warfare' },
    };
    const ch = buildCharacter(b, c);
    const def = c.feats['additional-lore'].choice;
    if (!def) return; // the record's shape is another lane's business
    expect(buildChoiceOptions('additional-lore', def, b, c, ch, '2:skill:0').some((o) => o.disabled)).toBe(false);
  });

  /**
   * A RATCHET ON AN HONEST NUMBER, not a claim of completeness.
   *
   * This asserted `todo` was EMPTY, and it passed — on a lane about 4% built. The detector required
   * "each time" BEFORE "a different X" and so matched 8 records where 47 print the rule; everything it
   * could not see counted as done. `npm run scan:choices` printed "TO DO 0" and this test agreed with it.
   *
   * That is the worst failure available to a measuring instrument: it reads as coverage. Two other
   * detectors in this project failed the same way on the same day (34 of 145, 6 of 40), all three by
   * matching the wording of the CONDITION rather than the outcome.
   *
   * The detector now catches both word orders. 11 records with an enumerable picker still lack the flag,
   * plus 33 whose picker cannot be enumerated — a different lane's problem. Lower the baseline as they
   * are built. If it goes UP, either a record regressed or the detector widened again; find out which
   * before changing the number.
   */
  const TODO_BASELINE = 11;

  it(`leaves at most ${TODO_BASELINE} enumerable pickers without the flag, and never more`, () => {
    const b = scanDistinctAcrossTakes();
    expect(b.done.length).toBeGreaterThanOrEqual(3);
    // Guards the guard: if the detector narrows again, this fails instead of quietly reporting zero.
    expect(b.todo.length + b.done.length + b.noPicker.length, 'the detector stopped seeing most of the corpus').toBeGreaterThanOrEqual(40);
    expect(
      b.todo.length,
      b.todo.length > TODO_BASELINE
        ? `went UP (${TODO_BASELINE} → ${b.todo.length}): ${b.todo.map((r) => r.id).join(', ')}`
        : `down to ${b.todo.length} — lower TODO_BASELINE so it cannot creep back`,
    ).toBeLessThanOrEqual(TODO_BASELINE);
  });
});

// ─────────────────────────────────────────────────────── Adopted Ancestry
describe('Adopted Ancestry offers every ancestry, and then widens the slot', () => {
  it('the picker lists all 50 with rarity, minus the character\'s own', () => {
    const def = c.feats['adopted-ancestry'].choice!;
    expect(def.kind).toBe('open');
    expect(def.from?.type).toBe('ancestry');
    const all = openChoiceOptions(def.from, c);
    // OLD BEHAVIOUR: eight hardcoded common ancestries, so kobold/hobgoblin/tengu were unreachable.
    expect(all.length).toBeGreaterThanOrEqual(50);
    expect(all.map((o) => o.id)).toContain('kobold');
    expect(all.find((o) => o.id === 'kobold')?.note).toBe('uncommon');
    expect(all.find((o) => o.id === 'human')?.note).toBeUndefined();

    const human = buildCharacter({ ...emptyBuild(), level: 3, ancestryId: 'human', classId: 'fighter' }, c);
    const forHuman = openChoiceOptions(def.from, c, { character: human });
    expect(forHuman.map((o) => o.id)).not.toContain('human');
    expect(forHuman.length).toBe(all.length - 1);
  });

  it('resolves non-empty with NO character, which is what keeps it out of the own-* family', () => {
    expect(openChoiceOptions({ type: 'ancestry', excludeOwn: true }, c).length).toBeGreaterThan(40);
  });

  it('the answer widens an ancestry slot at or after the level it was taken', () => {
    const b: BuildState = {
      ...emptyBuild(),
      level: 20,
      ancestryId: 'human',
      classId: 'fighter',
      featPicks: { '3:general:0': 'adopted-ancestry' },
      featChoices: { '3:general:0': 'kobold' },
    };
    expect(adoptedAncestryIds(b, c, 5)).toEqual(['kobold']);
    const kobold = Object.values(c.feats).filter((f) => f.category === 'ancestry' && f.traits.includes('kobold') && f.level === 1);
    expect(kobold.length).toBeGreaterThan(0);
    const at = (level: number) => new Set(eligibleFeatsForSlot(b, c, { level, category: 'ancestry', idx: 0 }).map((f) => f.id));
    // OLD BEHAVIOUR: the answer was stored and read by nothing — `adoptedAncestry` appeared nowhere in
    // src/ — so no ancestry slot ever changed, at any level.
    expect(kobold.some((f) => at(5).has(f.id))).toBe(true);
    // …and NOT before the feat was taken.
    expect(adoptedAncestryIds(b, c, 1)).toEqual([]);
    expect(kobold.some((f) => at(1).has(f.id))).toBe(false);
  });

  it('the GRANTED path works too, and never offers your own ancestry', () => {
    const b: BuildState = {
      ...emptyBuild(),
      level: 9,
      ancestryId: 'skeleton',
      classId: 'fighter',
      featPicks: { '1:ancestry:0': 'as-in-life-so-in-death' },
      grantedFeatChoices: { 'adopted-ancestry': 'tengu' },
    };
    expect(adoptedAncestryIds(b, c, 5)).toEqual(['tengu']);
    // Your own ancestry is never an answer: "choose ANOTHER ancestry".
    expect(adoptedAncestryIds({ ...b, grantedFeatChoices: { 'adopted-ancestry': 'skeleton' } }, c, 5)).toEqual([]);
  });
});

// ───────────────────────────────────────────────── versatile heritages
describe('a versatile heritage matches its feats by TRAIT as well as by id', () => {
  const host = (heritageId: string) => ({ ...emptyBuild(), level: 20, ancestryId: 'human', classId: 'fighter', heritageId }) as BuildState;
  const ancestrySlot = (heritageId: string) =>
    eligibleFeatsForSlot(host(heritageId), c, { level: 1, category: 'ancestry', idx: 0 }).map((f) => f.id);

  it('Beastbrood becomes takeable by a tiefling', () => {
    // OLD BEHAVIOUR: the heritage's id is `aon-tiefling` and its feats carry the bare `tiefling`
    // trait, so `f.traits.includes(her.id)` was false for all 16 and none was reachable by anyone.
    expect(ancestrySlot('aon-tiefling')).toContain('beastbrood');
  });

  it('all five importer-prefixed heritages gain their feats — 66 in total', () => {
    const gains: Record<string, number> = {};
    for (const h of Object.values(c.heritages).filter((x) => x.versatile)) {
      const byId = Object.values(c.feats).filter((f) => f.traits.includes(h.id));
      const byTrait = Object.values(c.feats).filter((f) => (h.traits ?? []).some((t) => f.traits.includes(t)));
      const gain = byTrait.filter((f) => !byId.includes(f)).length;
      if (gain) gains[h.id] = gain;
    }
    expect(gains).toEqual({ 'aon-aasimar': 20, 'aon-ifrit': 23, 'aon-tiefling': 16, 'aon-aphorite': 5, 'aon-ganzi': 2 });
  });

  it('NO REGRESSION: hungerseed, suli and undine gain nothing', () => {
    // The audit claimed six broken heritages including hungerseed. Measured over all 22 it is five:
    // hungerseed's own id matches 11 feats and its `oni` trait matches none, and `geniekin` (suli) and
    // `amphibious` (undine) are carried by zero feats.
    for (const h of ['hungerseed', 'suli', 'undine']) {
      const her = c.heritages[h];
      if (!her) continue;
      const byId = Object.values(c.feats).filter((f) => f.traits.includes(her.id)).map((f) => f.id);
      expect(new Set(ancestrySlot(h) ).size).toBeGreaterThan(0);
      for (const t of her.traits ?? []) {
        const extra = Object.values(c.feats).filter((f) => f.traits.includes(t) && !byId.includes(f.id));
        expect(extra.map((f) => f.id), `${h}/${t}`).toEqual([]);
      }
    }
  });
});

// ─────────────────────────────────────────── a grant the feat's own choice decides
describe('Beast Trainer grants the branch the player picked', () => {
  const orc = (answer?: string): BuildState => ({
    ...emptyBuild(),
    level: 4,
    ancestryId: 'orc',
    classId: 'fighter',
    featPicks: { '1:ancestry:0': 'beast-trainer' },
    featChoices: answer ? { '1:ancestry:0': answer } : {},
  });
  const ids = (b: BuildState) => buildCharacter(b, c).feats.map((f) => f.featId);

  it('pet → Pet, and a Tiny minion card', () => {
    const got = ids(orc('pet'));
    // OLD BEHAVIOUR: the flat table granted train-animal whichever branch was picked — a missing grant
    // and a spurious one in one act.
    expect(got).toContain('pet');
    expect(got).not.toContain('train-animal');
    expect(featGrantedCompanions(new Set(got)).map((g) => g.kind ?? g.id ?? 'pet').length).toBeGreaterThan(0);
  });

  it('train-animal → Train Animal, and NO companion', () => {
    const got = ids(orc('train-animal'));
    expect(got).toContain('train-animal');
    expect(got).not.toContain('pet');
  });

  it('unanswered keeps the grant every saved character already had', () => {
    expect(ids(orc())).toContain('train-animal');
    expect(featFeatGrantsFor('beast-trainer')).toEqual(['train-animal']);
    expect(featFeatGrantsFor('beast-trainer', 'pet')).toEqual(['pet']);
    // An unknown answer falls back rather than granting nothing.
    expect(featFeatGrantsFor('beast-trainer', 'nonsense')).toEqual(['train-animal']);
    // Every branch of the table names an option the record actually offers.
    for (const [granter, byChoice] of Object.entries(CHOICE_FEAT_GRANTS)) {
      const values = new Set((c.feats[granter]?.choice?.options ?? []).map((o) => o.value));
      for (const answer of Object.keys(byChoice)) expect(values.has(answer), `${granter}/${answer}`).toBe(true);
      for (const list of Object.values(byChoice)) for (const g of list) expect(c.feats[g], g).toBeTruthy();
    }
  });
});

// ───────────────────────────────────────────────────────── dead answers
describe('a picker whose answer nothing reads is deleted, not left live', () => {
  const DELETED = [
    'adroit-manipulation',
    'animal-senses',
    'greater-animal-senses',
    'natural-senses',
    'benefactors-resistance',
    'aqueous-dragonblood',
    'summiting-dragonblood',
    'animal-actor',
  ];

  it('all eight phantom pickers are gone', () => {
    for (const id of DELETED) expect(c.feats[id]?.choice, id).toBeUndefined();
  });

  it('…and the picker that does the work survived in each case', () => {
    // Deleting the wrong half is the failure this guards. Four are "asked twice": the surviving
    // effectChoices picker is the one carrying grants.
    for (const [id, choiceId] of [
      ['animal-senses', 'sense'],
      ['greater-animal-senses', 'sense'],
      ['natural-senses', 'sense'],
      ['benefactors-resistance', 'breath-type'],
    ] as const) {
      const ec = (c.feats[id].effectChoices ?? []).find((x) => x.id === choiceId);
      expect(ec, id).toBeTruthy();
      expect(ec!.options?.some((o) => o.grant), id).toBe(true);
    }
    // Adroit Manipulation's working picker is the DERIVED one — the redundancy fallback.
    const halfling = buildCharacter(
      {
        ...emptyBuild(),
        level: 3,
        ancestryId: 'halfling',
        classId: 'rogue',
        featPicks: { '1:ancestry:0': 'adroit-manipulation' },
      },
      c,
    );
    expect(halfling.proficiencies.skills.thievery).not.toBe('untrained');
  });

  it('no Yes/No picker is left anywhere in the corpus', () => {
    // "Do you already have a base swim Speed?" is a question the app answers for itself.
    expect(scanComputable().map((r) => `${r.cat}/${r.id}`)).toEqual([]);
  });
});

// ─────────────────────────────────────────── one answer, printed once
describe('an answer is printed once, however many pickers and takings there are', () => {
  it('a repeatable feat does not repeat its effect-choice answer per taking', () => {
    // Wormskin is `maxTakable: 3`. It has to arrive through featPicks, not `overrides.addedFeats`,
    // which dedupes by id and would leave one taking — and then this test would pass either way.
    const ch = buildCharacter(
      {
        ...emptyBuild(),
        level: 9,
        ancestryId: 'human',
        classId: 'fighter',
        featPicks: { '4:class:0': 'wormskin', '6:class:0': 'wormskin', '8:class:0': 'wormskin' },
        effectChoices: { 'wormskin:resistance': 'cold' },
      },
      c,
    );
    expect(ch.feats.filter((f) => f.featId === 'wormskin')).toHaveLength(3);
    // OLD BEHAVIOUR: resolvePick ran once per taking and pushed a row each time, so FeatsTab printed
    // "Wormskin (Cold) (Cold, Cold, Cold)".
    const picks = (ch.effectPicks ?? []).filter((p) => p.recordId === 'wormskin' && p.choiceId === 'resistance');
    expect(picks.length).toBe(1);
  });

  it('every sense is spelt exactly one way', () => {
    // `addSense` keys its Map by NAME, so two spellings of one sense print two rows for it.
    expect(scanSenseSpelling().map((r) => r.key)).toEqual([]);
  });

  it('the Feats tab suppresses a pick that only echoes the record\'s own choice label', () => {
    // The render expression FeatsTab composes, kept in step by reading the file.
    const src = readFileSync('src/sheet/FeatsTab.tsx', 'utf8');
    expect(src).toContain('pickSuffix(fc.featId, fc.choice?.label)');
    expect(src).toMatch(/const pickSuffix = \(recordId: string, own\?: string\)/);
  });
});

// ─────────────────────────────────────── narrowed, gated and prerequisite-bearing
describe('the over-wide lists', () => {
  it('Artisanal Crafter narrows Specialty Crafting to the three it names', () => {
    const lim = c.feats['artisanal-crafter'].choiceOptionLimits;
    expect(lim?.[0].target).toBe('specialty-crafting');
    expect(lim?.[0].allow.map((a) => a.value)).toEqual(['blacksmithing', 'leatherworking', 'stonemasonry']);
    expect(lim?.[0].reason).toMatch(/blacksmithing/);
    // The values it names must exist on the target, or the picker empties.
    const values = new Set((c.feats['specialty-crafting'].choice?.options ?? []).map((o) => o.value));
    for (const a of lim![0].allow) expect(values.has(a.value), a.value).toBe(true);
  });

  it('Animal Senses gates darkvision on already having low-light vision', () => {
    const sense = (c.feats['animal-senses'].effectChoices ?? []).find((x) => x.id === 'sense')!;
    const dark = sense.options!.find((o) => o.value === 'darkvision')!;
    expect(dark.requiresAnySense).toEqual(['low-light-vision', 'darkvision']);
    // …and the low-light grant is spelt the way every ancestry spells it, so it MERGES with an
    // ancestry's row instead of adding a second one.
    const low = sense.options!.find((o) => o.value === 'low-light-vision')!;
    expect(low.grant?.senses?.[0].name).toBe('low-light-vision');
  });

  it('…and the gate says NO to a normal-sighted character and YES to an elf', () => {
    const sense = (c.feats['animal-senses'].effectChoices ?? []).find((x) => x.id === 'sense')!;
    const dark = sense.options!.find((o) => o.value === 'darkvision')!;
    const senses = (ancestryId: string) =>
      characterSenseKeys(buildCharacter({ ...emptyBuild(), level: 1, ancestryId, classId: 'fighter' }, c), c);
    // OLD BEHAVIOUR: the picker rendered every option live, so the harness's normal-sighted human
    // fighter was offered Darkvision as a live pick against the feat's own printed sentence.
    expect(senseGateReason(dark.requiresAnySense, senses('human'))).toBe('Requires low light vision or darkvision.');
    expect(senseGateReason(dark.requiresAnySense, senses('elf'))).toBeUndefined();
    // The spelling is normalised on BOTH sides, so a grant written with a space still satisfies it.
    expect(senseGateReason(['low-light-vision'], new Set(['low-light-vision']))).toBeUndefined();
    expect(senseGateReason(['low-light vision'], new Set(['low-light-vision']))).toBeUndefined();
    // An answer already stored is never greyed — a pick must not vanish from under the player, and a
    // gate must not invalidate itself once its own grant lands.
    expect(senseGateReason(dark.requiresAnySense, senses('human'), true)).toBeUndefined();
    // An ungated option is never touched.
    expect(senseGateReason(undefined, new Set())).toBeUndefined();
  });

  it('the Builder mounts that gate rather than re-deriving one', () => {
    const src = readFileSync('src/builder/Builder.tsx', 'utf8');
    expect(src).toContain('senseGateReason(');
    expect(src).toContain('characterSenseKeys(featPrereqChar, content)');
  });

  it('Armor Proficiency is called out as wasted for a fighter and NOT for anyone with armor left', () => {
    const at = (classId: string, level = 3) =>
      exhaustedGrantReason(c.feats['armor-proficiency'], buildCharacter({ ...emptyBuild(), level, ancestryId: 'human', classId }, c));
    // OLD BEHAVIOUR: the row was live and inert — a general feat slot spent on nothing, with no label
    // on the row to explain it, and `builder.eligibleHosts` happily listed the fighter.
    expect(at('fighter')).toMatch(/already trained in light, medium and heavy armor/);
    expect(at('wizard')).toBeUndefined(); // untrained in all three
    expect(at('cleric')).toBeUndefined(); // light + medium; heavy is still open
    // …and it is scoped to the cascade, never to feats at large.
    expect(exhaustedGrantReason(c.feats['toughness'], buildCharacter({ ...emptyBuild(), level: 3, ancestryId: 'human', classId: 'fighter' }, c))).toBeUndefined();
    expect(exhaustedGrantReason(undefined, { proficiencies: { defenses: {} } })).toBeUndefined();
  });

  it('the builder both FILTERS it (Q21) and explains it (Q27)', () => {
    const src = readFileSync('src/builder/Builder.tsx', 'utf8');
    // Q21 — "wasted across your whole career" is the filtered row. `featIneligible` is what
    // FilterableSelect's default-on "Hide ineligible" removes.
    expect(src).toMatch(/const featIneligible = \(f: Feat\) => \{[\s\S]{0,400}?if \(noOpWhy\(f\)\) return true;/);
    // Q27 — once revealed, the row is dimmed AND says why. Both halves, or it is half-built.
    expect(src).toContain('const noOpWhyRow = noOpWhy(f);');
    expect(src).toContain('const unmet = !pre.met || dedBlocked || !!noOpWhyRow;');
    expect(src).toContain('(dedBlockedWhyRow ?? noOpWhyRow)');
    // …and the toggle that reveals it no longer claims to be about prerequisites, which Armor
    // Proficiency does not have (`prerequisites: []`) and a blocked dedication meets in full.
    const fsel = readFileSync('src/sheet/FilterableSelect.tsx', 'utf8');
    expect(fsel).not.toMatch(/title=\{hideInel \? 'Show options whose prerequisites/);
    expect(fsel).toContain("'Show options you can’t take here'");
  });

  it('Bounce Boost carries the prerequisite its text prints', () => {
    expect(c.feats['bounce-boost'].prerequisites).toEqual(['Trained in Athletics']);
  });

  it('Bestial Manifestation describes each attack, and the description matches the strike', () => {
    const opts = c.feats['bestial-manifestation'].choice!.options!;
    // OLD BEHAVIOUR: four bare words at a pick the feat says can never be retrained.
    for (const o of opts) expect(o.description, o.value).toMatch(/^1d\d /);
    for (const s of c.feats['bestial-manifestation'].grantedStrikes ?? []) {
      const o = opts.find((x) => x.value === s.choiceValue)!;
      expect(o.description!.startsWith(`1${s.die} ${s.damageType}`), o.value).toBe(true);
    }
  });
});
