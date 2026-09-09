import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveSpeeds, ownedFeatureIds } from '../src/rules/derive';
import { recordMarkersFor } from '../src/rules/explain';
import type { ClassFeature } from '../src/rules/types';

/**
 * Batch-034, WG-comparison lane — the DATA-ROWS family.
 *
 * Every assertion reads the shipped `public/core.json` (plus `public/core-descriptions.json`) through
 * `content()` and pins the field the driver's backfill row authors, then runs it through the real
 * reader on a BUILT character wherever one exists. Nothing here diffs a patched copy against the
 * shipped one: each assertion fails today for exactly one reason — the field is absent, or still
 * carries the value print contradicts — and passes once work/.b034-rows-data-rows.json is applied.
 */
const db = () => content();
const cf = (id: string) => db().classFeatures[id] as (ClassFeature & Record<string, unknown>) | undefined;
const option = (classId: string, optionId: string) =>
  db().classes[classId]?.subclass?.options.find((o) => o.id === optionId) as
    | { description?: string; descRefs?: { label: string; key: string }[] }
    | undefined;

describe('speed-boosters moves the Speed it prints', () => {
  // batch 034: speed-boosters
  it('carries the always-on +5 as landSpeedBonus, and hyper-boosters the delta that keeps the pair at +10', () => {
    // innovation-5 §Speed Boosters: "You gain a +5-foot status bonus to your Speed, which increases to
    // a +10-foot status bonus when under the effects of Overdrive." §Hyper Boosters prints +10 as a
    // TOTAL and "You must have the speed boosters modification to select this modification" — and
    // derive.ts:5071 SUMS landSpeedBonus across owned class features, so the second number is stored as
    // the delta over the first. The Overdrive rider stays a star (situationalBonuses.ts:1408/1392).
    const armor = (mods: Record<string, string>) =>
      deriveSpeeds(build('inventor', 8, { subclassId: 'armor-innovation', inventorModifications: mods }), db()).land ?? 0;
    const base = armor({});
    expect(base, 'the harness half: an armour inventor with no modification walks at their base Speed').toBeGreaterThan(0);
    expect(cf('speed-boosters')?.landSpeedBonus).toBe(5);
    expect(cf('hyper-boosters')?.landSpeedBonus).toBe(5);
    expect(armor({ initial: 'speed-boosters' }) - base).toBe(5);
    expect(armor({ initial: 'speed-boosters', breakthrough: 'hyper-boosters' }) - base).toBe(10);
  });
});

describe('elemental-blast badges the 2-action blast it prints', () => {
  // batch 034: elemental-blast#action-cost
  it('costs 1 OR 2 actions on the class feature, which is the record the Main tab keeps', () => {
    // action-2125 prints "Single Action or Two Actions", and "If you make a 2-action Elemental Blast,
    // you gain a status bonus to the damage roll equal to your Constitution modifier" — the very line
    // derive.ts:4573 renders on the strike. The class feature fixed the cost at 1 action, and
    // MainTab.tsx:339-341 dedupes it against actions/elemental-blast BY NAME, so the wrong badge won.
    // The harness half: the action record it is deduped against already carries the printed shape.
    expect(db().actions['elemental-blast']?.actionCost).toEqual({ type: 'variable', min: 1, max: 2 });
    expect(cf('elemental-blast')?.actionCost).toEqual({ type: 'variable', min: 1, max: 2 });
  });
});

describe('way-of-the-triggerbrand prints the access it grants', () => {
  // batch 034: way-of-the-triggerbrand#combination-weapon-access
  it('names the triggerbrand in both carriers of the way text', () => {
    // way-6: "In addition to the combination weapons presented in Pathfinder Guns & Gears, you gain
    // access to the triggerbrand combination weapon." Our text replaced that with the paraphrase "You
    // gain access to combination weapons.", so the one weapon the way actually unlocks was unnamed.
    const CLAUSE = 'you gain access to the triggerbrand combination weapon';
    expect(db().items['triggerbrand'], 'the harness half: the item the clause grants access to exists').toBeTruthy();
    expect(cf('way-of-the-triggerbrand')?.description).toContain(CLAUSE);
    // The Builder renders the SUBCLASS OPTION's own copy (Builder.tsx:1872 passes `o.description`
    // through with no fallback), so the paraphrase had to be replaced in both places.
    expect(option('gunslinger', 'way-of-the-triggerbrand')?.description).toContain(CLAUSE);
  });
});

describe('beast-eidolon labels its own ability arrays', () => {
  // batch 034: beast-eidolon#stat-array-names
  it('reads Brutal Beast / Fleet Beast, not the Anger Phantom headings', () => {
    // eidolon-3 prints the two arrays as "Brutal Beast" and "Fleet Beast". Ours carried "Wrathful
    // Berserker" / "Enraged Assassin", which are eidolon-2's (Anger Phantom) headings — only the
    // labels were cross-contaminated, the numbers under them are the Beast's own (Wis 12 / Cha 10).
    // The harness half: the whole-array row must not lose what the 13 per-option overlay rows put there.
    expect((option('summoner', 'beast-eidolon') as { eidolonAbilities?: unknown })?.eidolonAbilities).toBeTruthy();
    for (const text of [cf('beast-eidolon')?.description, option('summoner', 'beast-eidolon')?.description]) {
      expect(text).toContain('**Brutal Beast** Str 18, Dex 14, Con 16, Int 8, Wis 12, Cha 10; +2 AC (+3 Dex cap)');
      expect(text).toContain('**Fleet Beast** Str 14, Dex 18, Con 16, Int 8, Wis 12, Cha 10; +1 AC (+4 Dex cap)');
      expect(text).not.toContain('Wrathful Berserker');
      expect(text).not.toContain('Enraged Assassin');
    }
  });
});

describe('the-infinite-eye shows its 4th-rank granted spell', () => {
  // batch 034: the-infinite-eye#clairvoyance-description
  it('lists Clairvoyance in the ladder and links it, in the copy the Builder renders', () => {
    // conscious-mind-8 prints "4th Clairvoyance" in the Granted Spells ladder. The option copy carried
    // the bare line "- 4th:" and no Clairvoyance descRef, so a psychic picking The Infinite Eye read a
    // blank 4th rank — while the option's own grantedSpells listed clairvoyance all along.
    const opt = option('psychic', 'the-infinite-eye');
    expect(
      (opt as { grantedSpells?: unknown[] } | undefined)?.grantedSpells,
      'the harness half: the mechanics always granted it',
    ).toContain('clairvoyance');
    expect(opt?.description).toContain('- 4th: Clairvoyance');
    expect(opt?.descRefs?.map((r) => r.label)).toContain('Clairvoyance');
    // The class-feature copy already said "4th: Clairvoyance" and still had no link for it.
    expect((cf('the-infinite-eye')?.descRefs as { label: string }[] | undefined)?.map((r) => r.label)).toContain('Clairvoyance');
  });
});

describe('improved-familiar-attunement hands over Drain Familiar', () => {
  // batch 034: improved-familiar-attunement#drain-familiar
  it('grants the free action the thesis prints, and the action record exists to be granted', () => {
    // arcane-thesis-7: "you also gain the Drain Familiar free action instead of Drain Bonded Item.
    // Drain Familiar can be used any time an ability would allow you to use Drain Bonded Item and
    // functions identically, except that you draw magic from your familiar instead of an item."
    // No drain-familiar record existed in any bucket, so the thesis handed over nothing.
    // The harness half: the grant's route to the sheet — MainTab.tsx:316 walks `grantsActions` over
    // ownedFeatureIds — is live for a wizard who chose this thesis.
    const wiz = build('wizard', 5, { extraChoices: { thesis: ['improved-familiar-attunement'] } });
    expect(
      [...ownedFeatureIds(wiz, db())],
      'the harness half: the chosen thesis is an owned class feature',
    ).toContain('improved-familiar-attunement');
    const act = db().actions['drain-familiar'];
    expect(act?.actionCost).toEqual({ type: 'free' });
    expect(act?.traits).toEqual(['arcane', 'wizard']);
    expect(act?.description).toContain('you draw magic from your familiar instead of an item');
    expect(cf('improved-familiar-attunement')?.grantsActions).toEqual(['drain-familiar']);
    // "…and FUNCTIONS IDENTICALLY" — Drain Bonded Item is once per day (action-2260), a limit stored
    // on the granter (classFeatures/arcane-bond), which MainTab.tsx:333 carries onto the action.
    expect(cf('improved-familiar-attunement')?.limitedUses).toEqual({ max: 1, per: 'day' });
  });

  // batch 034: improved-familiar-attunement#drain-familiar
  it('says on the Drain Bonded Item row that improved-familiar-attunement replaced it', () => {
    // arcane-thesis-7: "you also gain the Drain Familiar free action INSTEAD OF Drain Bonded Item."
    // Nothing suppresses a granted action a later record replaces, so the grant above leaves a wizard
    // reading BOTH free actions. `recordMarks` is the existing data lane for a clause that changes an
    // ACTION rather than a stat (types.ts:255-265): explain.ts recordMarksFor walks it over
    // ownedFeatureIds, so the note reaches the Drain Bonded Item row (MainTab.tsx:742) for exactly the
    // wizards who took this thesis — and for nobody else, which is the second half asserted here.
    const withThesis = build('wizard', 5, { extraChoices: { thesis: ['improved-familiar-attunement'] } });
    const notes = recordMarkersFor(withThesis, db(), 'action', 'drain-bonded-item').map((m) => m.note);
    expect(notes.join(' ')).toContain('instead of Drain Bonded Item');
    const other = build('wizard', 5, { extraChoices: { thesis: ['spell-substitution'] } });
    expect(
      recordMarkersFor(other, db(), 'action', 'drain-bonded-item').map((m) => m.sourceId),
      'the harness half: the mark is gated on owning THIS thesis',
    ).not.toContain('improved-familiar-attunement');
  });
});
