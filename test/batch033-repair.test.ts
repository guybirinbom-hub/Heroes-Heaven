import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error - plain .mjs repair script, no types
import { restoreDamageTypes } from '../scripts/repair-damage-type.mjs';
import { content } from './_content';
import { featEntries } from '../src/sheet/FeatsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 033, REPAIR lane.
 *
 * The `@Damage[…]` cleaner sometimes keeps the dice and eats the TYPE, so AoN apparition-7's
 * "**Damage** 6d10+6 bludgeoning plus Grab" shipped as "**Damage** 6d10+6 plus Grab" — a Strike with
 * a number and no damage type, which is the half a player reads resistances, weaknesses and
 * immunities against. Ten of the fourteen animist apparitions lost it the same way.
 *
 * These fixtures drive `restoreDamageTypes` — the matcher `scripts/repair-damage-type.mjs` and the
 * ratchet in `scripts/dropped-inline-check.mjs` both go through — on real sentence PAIRS taken
 * verbatim from the AoN mirror and from our shipped text. They are deliberately fixtures rather than
 * assertions on a built character's description: the overlay rows this batch emits change that
 * description, so a shipped-text assertion would flip the moment the rows land and prove nothing.
 * What is pinned here is the matcher's contract, which does not move: restore exactly the missing
 * tokens, change nothing else, and leave an already-correct sentence alone.
 */

/** Our shipped wording, from public/core-descriptions.json classFeatures/<id>.d. */
const OURS = {
  lurker:
    '**Avatar** *Tentacles from the Dark* Speed 70 feet, swim Speed 70 feet\n\n' +
    '**Melee** ⟨1⟩ grasping tentacles (reach 30 feet), **Damage** 6d10+6 plus Grab',
  crafter:
    '**Avatar** *Incarnate Dungeon* Speed 50 feet, either burrow Speed 50 feet or fly Speed 50 feet\n\n' +
    '**Melee** ⟨1⟩ dungeon trap (reach 10 feet, versatile B or P), **Damage** 6d6+6 plus Grab\n\n' +
    '**Ranged** ⟨1⟩ deadly darts (range 120 feet, versatile poison), **Damage** 6d6+6',
  shepherd:
    '**Avatar** *Avatar Will of the Winds* Speed 40 feet, fly 70 feet, ignore difficult terrain and greater difficult terrain\n\n' +
    '**Melee** ⟨1⟩ air blast (air, reach 20 feet), **Damage** 6d8+6 bludgeoning\n\n' +
    '**Ranged** ⟨1⟩ thunderclap (electricity, range 120 feet, versatile sonic), **Damage** 6d6+3 electricity',
  hoof: '- **Melee** 1 hoof (agile, magical, unholy), **Damage** 1d4+12 plus 1d6 fire;',
  /* Witness to Ancient Battles lost the label's bold markers as well as the type. */
  witness:
    '**Avatar** *General of Endless Battle* Speed 70 feet, immune to immobilized\n\n' +
    '**Melee** ⟨1⟩ final strike (agile, fatal d12, reach 15 feet), Damage 6d8+6',
};

/** The Archives' markdown for the same block, verbatim. */
const THEIRS = {
  lurker:
    '**Avatar** _Tentacles from the Dark_ Speed 70 feet, swim Speed 70 feet; **Melee** <actions string="Single Action" /> ' +
    'grasping tentacles ([reach 30 feet](/Traits.aspx?ID=684)), **Damage** 6d10+6 bludgeoning plus [Grab](/MonsterAbilities.aspx?ID=45)',
  crafter:
    '**Avatar** _Incarnate Dungeon_ Speed 50 feet, either burrow Speed 50 feet or fly Speed 50 feet; **Melee** ' +
    '<actions string="Single Action" /> dungeon trap ([reach 10 feet](/Traits.aspx?ID=684), [versatile B or P](/Traits.aspx?ID=724)), ' +
    '**Damage** 6d6+6 slashing plus [Grab](/MonsterAbilities.aspx?ID=45); **Ranged** <actions string="Single Action" /> ' +
    'deadly darts ([range 120 feet](/Traits.aspx?ID=248), [versatile poison](/Traits.aspx?ID=724)), **Damage** 6d6+6 piercing',
  shepherd:
    '**Avatar** _Will of the Winds_ Speed 40 feet, fly 70 feet, ignore [difficult terrain and greater difficult terrain](/Rules.aspx?ID=453); ' +
    '**Melee** <actions string="" /> air blast ([air](/Traits.aspx?ID=527), [reach 20 feet](/Traits.aspx?ID=684)), **Damage** 6d8+6 bludgeoning; ' +
    '**Ranged** <actions string="" /> thunderclap ([electricity](/Traits.aspx?ID=586), [range 120 feet](/Traits.aspx?ID=248), ' +
    '[versatile sonic](/Traits.aspx?ID=724)), **Damage** 6d6+3 electricity',
  hoof: 'Melee <actions string="Single Action" /> hoof ([agile](/Traits.aspx?ID=526), [magical](/Traits.aspx?ID=644), [unholy](/Traits.aspx?ID=521)), **Damage** 1d4+12 plus 1d6 fire;',
  witness:
    '**Avatar** _General of Endless Battle_ Speed 70 feet, immune to [immobilized](/Conditions.aspx?ID=81); **Melee** ' +
    '<actions string="Single Action" /> final strike ([agile](/Traits.aspx?ID=526), [fatal d12](/Traits.aspx?ID=597), ' +
    '[reach 15 feet](/Traits.aspx?ID=684)), **Damage** 6d8+6 slashing ',
  morphic:
    '<ul><li>Animal <actions string="Single Action" /> claw ([agile](/Traits.aspx?ID=526), [finesse](/Traits.aspx?ID=602)), Damage 1d6 slashing</li>' +
    '<li>Celestial <actions string="Single Action" /> spirit touch ([magical](/Traits.aspx?ID=644), [sanctified](/Traits.aspx?ID=519), [spirit](/Traits.aspx?ID=737)), Damage 1d4 spirit</li>' +
    '<li>Elements <actions string="Single Action" /> elemental current (magical), Damage 1d4; this ability deals the same damage type and gains the same elemental traits of the cantrip you gained from your heritage</li>' +
    '<li>Object <actions string="Single Action" /> striking surface (sweep), Damage 1d8 bludgeoning or slashing (chosen when you gain this feat)</li>' +
    '<li>Vegetation <actions string="Single Action" /> root ([reach](/Traits.aspx?ID=684)), Damage 1d6 bludgeoning</li></ul>',
};

/*
 * feats/morphic-strike, the only OTHER record in the corpus whose Damage sites are mixed — four carry
 * their type and the Elements one prints none on either side (AoN feat-6991: "Damage 1d4; this ability
 * deals the same damage type … of the cantrip"). It is the live case for the per-site half of refusal
 * 4: without the already-correct skip the matcher re-types the four sites that were never broken.
 */
const MORPHIC_OURS =
  '- **Animal** 1 claw (agile, finesse), Damage 1d6 slashing\n' +
  '- **Celestial** 1 spirit touch (magical, sanctified, spirit), Damage 1d4 spirit\n' +
  '- **Elements** 1 elemental current (magical), Damage 1d4; this ability deals the same damage type and gains the same elemental traits of the cantrip you gained from your heritage\n' +
  '- **Object** 1 striking surface (sweep), Damage 1d8 bludgeoning or slashing (chosen when you gain this feat)\n' +
  '- **Vegetation** 1 root (reach), Damage 1d6 bludgeoning';

type Result = { next?: string; sites?: { dice: string; type: string }[]; refuse?: string } | null;
const run = (ours: string, theirs: string): Result => restoreDamageTypes(ours, theirs) as Result;

describe('lurker-in-devouring-dark: the repair restores the printed damage type and nothing else', () => {
  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark gains "bludgeoning" and keeps every other byte of our wording', () => {
    const r = run(OURS.lurker, THEIRS.lurker);
    expect(r?.sites).toEqual([{ dice: '6d10+6', type: 'bludgeoning' }]);
    expect(r?.next).toBe(OURS.lurker.replace('6d10+6 plus Grab', '6d10+6 bludgeoning plus Grab'));
    // The repair is an INSERTION: our glyph, our de-linked "Grab" and our blank lines all survive.
    expect(r?.next?.replace(' bludgeoning', '')).toBe(OURS.lurker);
  });

  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark is untouched once it already carries its type (re-running is a no-op)', () => {
    const fixed = run(OURS.lurker, THEIRS.lurker)?.next as string;
    expect(run(fixed, THEIRS.lurker)).toBeNull();
  });
});

describe('lurker-in-devouring-dark siblings: two Strikes that roll the same dice keep their OWN types', () => {
  /*
   * The alignment proof. Crafter in the Vault rolls 6d6+6 in melee and 6d6+6 at range, and the types
   * differ (slashing / piercing), so a dice-string lookup would hand both sites the same wrong type.
   * The matcher pairs the sites BY ORDER and refuses unless the dice runs agree pairwise.
   */
  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: crafter-in-the-vault gets slashing then piercing, in order', () => {
    const r = run(OURS.crafter, THEIRS.crafter);
    expect(r?.sites).toEqual([
      { dice: '6d6+6', type: 'slashing' },
      { dice: '6d6+6', type: 'piercing' },
    ]);
    expect(r?.next).toContain('dungeon trap (reach 10 feet, versatile B or P), **Damage** 6d6+6 slashing plus Grab');
    expect(r?.next).toContain('deadly darts (range 120 feet, versatile poison), **Damage** 6d6+6 piercing');
  });

  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: shepherd-of-errant-winds, already correct, is left alone', () => {
    expect(run(OURS.shepherd, THEIRS.shepherd)).toBeNull();
  });

  /*
   * The eleventh record, and the reason the count is not the ten the finding named: witness-to-
   * ancient-battles lost the label's bold markers too, so a `**Damage**` pattern walks past a record
   * carrying exactly this defect. Our markup is ours — the repair inserts the type and leaves the
   * unbolded label exactly as it found it.
   */
  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: witness-to-ancient-battles is repaired through an UNBOLDED label', () => {
    const r = run(OURS.witness, THEIRS.witness);
    expect(r?.sites).toEqual([{ dice: '6d8+6', type: 'slashing' }]);
    expect(r?.next).toContain('final strike (agile, fatal d12, reach 15 feet), Damage 6d8+6 slashing');
    expect(r?.next).not.toContain('**Damage**');
  });
});

describe('lurker-in-devouring-dark: the refusals, because a wrong damage type is worse than a missing one', () => {
  /*
   * Where the Archives themselves print no type there is nothing to restore. AoN spell-894 prints
   * Devil Form's vordine hoof as "**Damage** 1d4+12 plus 1d6 fire" — print is the authority, so the
   * matcher leaves our identical sentence alone rather than inventing a type for it.
   */
  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: a site the Archives print untyped is not invented (devil-form hoof)', () => {
    expect(run(OURS.hoof, THEIRS.hoof)).toBeNull();
  });

  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: refuses when the two texts cannot be paired site for site', () => {
    // One Damage site of ours against a doc that prints two — the counts do not pair.
    expect(run(OURS.lurker, THEIRS.crafter)?.refuse).toMatch(/cannot be paired/);
    // Equal counts, but the dice runs disagree — the sites are not the same Strikes.
    const drifted = THEIRS.lurker.replace('6d10+6', '6d12+6');
    expect(run(OURS.lurker, drifted)?.refuse).toMatch(/not aligned/);
  });

  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: refuses when the clause after the site disagrees', () => {
    const drifted = THEIRS.lurker.replace('bludgeoning plus [Grab](/MonsterAbilities.aspx?ID=45)', 'bludgeoning and Knockdown');
    expect(run(OURS.lurker, drifted)?.refuse).toMatch(/not aligned/);
  });

  /*
   * The per-site half of refusal 4, on the one live record that exercises it. feats/morphic-strike
   * carries five Damage sites, four already typed and one the Archives print untyped on purpose — so
   * a matcher that repaired every site rather than only the holes would re-type four sentences that
   * were never broken. Nothing is returned: at every site our text already matches print.
   */
  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark lane: a MIXED record (morphic-strike) keeps its typed sites untouched', () => {
    expect(run(MORPHIC_OURS, THEIRS.morphic)).toBeNull();
  });
});

/*
 * THE REACH TEST — and the reason this lane needed a twelfth row.
 *
 * The prose lives in TWO places. Repairing public/core-descriptions.json classFeatures/<id> does not
 * touch the copy an apparition carries on the class option, and that copy is the one the player sees:
 * build.ts:8245 pushes `option.description` into `character.classChoices`, and FeatsTab's featEntries
 * renders it as the "Apparitions" card. With only the eleven classFeatures rows the card still read
 * "**Damage** 6d10+6 plus Grab" on a real built animist — measured, not assumed.
 *
 * The spec is applied to a content COPY here rather than asserted against the shipped file, so the
 * test states the same thing before and after the rows land (rule: never a patched-vs-shipped delta).
 */
type Row = { category: string; id: string; field?: string; path?: string[]; value?: unknown };
const spec = JSON.parse(readFileSync('work/.b033-rows-repair.json', 'utf8')) as {
  findings: { backfillRows?: Row[] }[];
};

/** The shipped content with this lane's overlay rows applied, as scripts/lib/apply-backfill.mjs does. */
function patched(): ContentDatabase {
  const db = structuredClone(content()) as unknown as Record<string, Record<string, Record<string, unknown>>>;
  for (const f of spec.findings)
    for (const r of f.backfillRows ?? []) {
      let target: Record<string, unknown> | undefined = db[r.category]?.[r.id];
      for (const seg of r.path ?? []) {
        if (!target) break;
        target = seg.startsWith('id=')
          ? ((target as unknown as { id?: string }[]).find((o) => o.id === seg.slice(3)) as Record<string, unknown> | undefined)
          : (target[seg] as Record<string, unknown> | undefined);
      }
      if (!target) throw new Error(`no target for ${r.category}/${r.id}`);
      target[r.field!] = r.value;
    }
  return db as unknown as ContentDatabase;
}

describe('lurker-in-devouring-dark reaches a built animist with its damage type', () => {
  const P = patched();
  const animist = () => {
    const cls = P.classes.animist;
    return buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 5,
        classId: 'animist',
        ancestryId: Object.keys(P.ancestries)[0],
        backgroundId: Object.keys(P.backgrounds)[0],
        keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
        subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
        extraChoices: { apparition: ['lurker-in-devouring-dark'] },
      },
      P,
    );
  };

  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark: the Apparitions card on the sheet prints "6d10+6 bludgeoning"', () => {
    const card = featEntries(animist(), P).find((e) => /grasping tentacles/.test(e.description ?? ''));
    expect(card).toBeDefined();
    expect(card!.description).toContain('**Damage** 6d10+6 bludgeoning plus Grab');
  });

  // batch 033: lurker-in-devouring-dark#avatar-damage-type
  it('lurker-in-devouring-dark: the classFeatures record carries the same repaired clause', () => {
    expect((P.classFeatures['lurker-in-devouring-dark'] as { description?: string }).description).toContain(
      '**Damage** 6d10+6 bludgeoning plus Grab',
    );
  });
});
