import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveSpeeds } from '../src/rules/derive';
import type { Character, ClassFeature, IwrEntry, ModeDef } from '../src/rules/types';

/**
 * Batch-033, WG-comparison lane — the DATA-ROWS family.
 *
 * Every assertion reads `public/core.json` (plus `public/core-descriptions.json`) through
 * `content()` and pins the field the driver's backfill row authors, then — wherever a reader exists
 * — runs that field through the real derive on a BUILT character. Nothing here diffs a patched copy
 * against the shipped one, so no assertion flips direction when the rows land: each fails today for
 * exactly one reason (the field is absent, or still carries the value print contradicts) and passes
 * once the row from work/.b033-rows-data-rows.json is applied.
 */
const db = () => content();
const cf = (id: string) => db().classFeatures[id] as (ClassFeature & Record<string, unknown>) | undefined;

describe('skin-hard-as-horn keeps the immanence limits on the resistance it grants', () => {
  // batch 033: skin-hard-as-horn
  it('carries the printed clause in `condition`, the one IWR field the breakdown renders', () => {
    // ikon-15: "When your skin houses your divine spark, you gain resistance to the attuned damage
    // type equal to half your level. This resistance doesn't apply against critical hits." Both
    // qualifiers rode in a `note` key that IwrEntry does not declare and the resistance loop
    // (src/rules/derive.ts:2701-2729) never reads, so the number was annotated with nothing.
    const opts = cf('skin-hard-as-horn')?.choice?.options ?? [];
    expect(opts.map((o) => o.value)).toEqual(['bludgeoning', 'piercing', 'slashing']); // the harness half
    for (const o of opts) {
      const r = (o.grant?.resistances ?? [])[0] as (IwrEntry & { note?: string }) | undefined;
      expect(r?.condition).toBe('only while your divine spark is in this ikon (immanence), and never against critical hits');
      expect(r?.note).toBeUndefined();
    }

    // …and the clause reaches the IWR breakdown: `condition` is what derive puts beside the value.
    const base = build('exemplar', 8, { extraChoices: { ikon: ['skin-hard-as-horn'] } });
    const morning: Character = { ...base, dailyChoices: { 'skin-hard-as-horn:attunedDamageType': 'bludgeoning' } };
    const defs = deriveDefenses(morning, db());
    expect(defs.resistances.some((r) => r.type === 'bludgeoning')).toBe(true); // still counted, not withheld
    expect(defs.sources['resistance:bludgeoning']?.some((s) => /never against critical hits/.test(s.condition ?? ''))).toBe(true);
  });
});

describe('fey-eidolon delivers Fey Gift Spells', () => {
  // batch 033: fey-eidolon#fey-gift-spells
  it('widens the summoner repertoire to the arcane list', () => {
    // eidolon-8: "When you add spells to your repertoire, you can choose from the primal list as well
    // as spells that have the illusion or mental traits that appear on the arcane spell list."
    // Neither side modelled it, so `spellListTraditions` was empty for the one eidolon that exists
    // for this widening.
    const ch = build('summoner', 5, { subclassId: 'fey-eidolon' });
    expect(ch.subclassId).toBe('fey-eidolon'); // the harness half
    // batch 033: fey-eidolon#fey-gift-spells
    // The 033-resume row re-emitted this same field with the TRAIT half of the clause — the widening
    // landed all-or-nothing, so the picker offered every arcane spell where print offers the
    // illusion-or-mental slice. The tradition this `it` is about is unchanged; the narrowing itself is
    // proved on a built fey summoner in
    // test/batch033-resume-eidolon-languages-and-traits-…-narrowing.test.ts.
    expect(cf('fey-eidolon')?.spellListAdditions).toEqual({ traditions: ['arcane'], traits: ['illusion', 'mental'] });
    expect(ch.spellListTraditions?.some((t) => Array.isArray(t.traditions) && t.traditions.includes('arcane'))).toBe(true);
  });
});

describe('alchemical-sciences-methodology is current Player Core 2 content, not legacy', () => {
  // batch 033: alchemical-sciences-methodology#edition-aonid
  it('points at the remaster methodology so the hide-legacy filter keeps it', () => {
    // We ship methodology-5 verbatim (Player Core 2 pg. 103) while the record pointed at the APG's
    // methodology-1, whose own remaster_id is ["methodology-5"], and was tagged edition 'legacy'.
    // applyEditionFilter (src/rules/build.ts:3131-3145) drops 'legacy' records when hide-legacy is
    // on, taking this record's Quick Tincture grant and the investigator subclass control with it.
    const rec = cf('alchemical-sciences-methodology');
    expect(rec?.source?.book).toBe('Pathfinder Player Core 2'); // the harness half
    expect(rec?.grantsActions).toContain('quick-tincture'); // …and what the filter would remove
    expect(rec?.aonId).toBe('methodology-5');
    expect(rec?.edition).toBe('remaster');
  });
});

describe('light-mortar-innovation asks for its modification exactly once', () => {
  // batch 033: light-mortar-innovation#duplicate-modification-choice
  it('drops the inert record-level choice, leaving the tiered inventor picker as the only control', () => {
    // innovation-4: "Choose one initial light mortar modification to apply to your innovation" — ONE
    // pick. The record's own `choice` (flag lightMortarModification, marked inert) rendered a second
    // control beside the live inventorModificationOptions picker, and only the live one writes
    // build.inventorModifications, so the two could disagree.
    // The harness half: the three modifications the deleted choice listed are still offered, by the
    // tag the live picker reads.
    for (const id of ['contained-shrapnel', 'enhanced-shrapnel', 'spring-loaded'])
      expect(cf(id)?.otherTags).toContain('light-mortar-innovation-modification');
    expect(cf('light-mortar-innovation')?.choice).toBeUndefined();
  });
});

describe('curse-of-creeping-ashes cursebound 4 moves the Speed number', () => {
  // batch 033: curse-of-creeping-ashes#speed-penalty
  it('carries the -10 status penalty on the mode and folds it into land Speed', () => {
    // mystery-20: "Cursebound 4 You take a -10-foot status penalty to all your Speeds as your limbs
    // begin to crumble like ash." The mode carried the fire weakness and the ranged-attack penalty
    // only, and its note told the player to apply the Speed penalty by hand — but 'speed' is a
    // ModeTargetKind read at src/rules/derive.ts:5224.
    const mode = (db() as unknown as { modes: Record<string, ModeDef> }).modes['curse-of-creeping-ashes-4'];
    expect(mode.modifiers.some((m) => m.target === 'attack' && m.value === -2)).toBe(true); // the harness half
    // batch 033: curse-of-creeping-ashes#speed-penalty
    // The 033-resume row widened this same modifier with `detail: 'all'` — print says "ALL your
    // Speeds", and a detail-less speed modifier means the walking one alone (src/rules/modes.ts:135).
    // The land Speed this `it` is about is unaffected; the fly/climb/swim/burrow half is proved in
    // test/batch033-resume-otherworldly-and-curse-rows-…-speed-line-.test.ts.
    expect(mode.modifiers).toContainEqual({ value: -10, type: 'status', target: 'speed', detail: 'all' });
    expect(mode.note).not.toMatch(/by hand/);

    const base = build('oracle', 6);
    const walking = deriveSpeeds(base, db()).land ?? 0;
    expect(walking).toBeGreaterThan(10); // the harness half: there is a Speed to reduce
    const cursed = deriveSpeeds({ ...base, activeModes: [mode] } as Character, db());
    expect(cursed.land).toBe(walking - 10);
  });
});

describe('otherworldly-protection resists what print says', () => {
  /** A level-8 inventor whose armor innovation carries the modification. */
  const protectedInventor = (): Character =>
    build('inventor', 8, { subclassId: 'armor-innovation', inventorModifications: { initial: 'otherworldly-protection' } });

  // batch 033: otherworldly-protection#void-healing-swap
  it('keeps the void resistance counted for a character without void healing', () => {
    // The record's own (remaster) description, and AoN innovation-1: "You gain resistance equal to
    // 3 + half your level to void damage, or to vitality damage if you have void healing (such as if
    // you're a dhampir)." We shipped a flat [void, spirit] pair with no branch, so a dhampir inventor
    // read a resistance that never applies.
    const rs = (cf('otherworldly-protection')?.resistances ?? []) as IwrEntry[];
    const gains = rs.find((r) => r.type === 'void');
    expect(gains?.value).toBe('3+floor(@actor.level/2)'); // the harness half: the number is unchanged
    // batch 033: otherworldly-protection#void-healing-swap
    // The 033-resume row replaced this prose `condition` with the real branch — the caveat was
    // readable but the number never swapped, and wg-values still saw a SET-GAP (theirs=vitality).
    // `whenVoidHealing` (src/rules/types.ts:527) is the gate; the swap itself is proved on a built
    // dhampir in test/batch033-resume-otherworldly-and-curse-rows-…-speed-line-.test.ts.
    expect(gains?.whenVoidHealing).toBe(false);
    expect(gains?.condition).toBeUndefined();
    const defs = deriveDefenses(protectedInventor(), db());
    expect(defs.resistances.find((r) => r.type === 'void')?.value).toBe(7);
  });

  // batch 033: otherworldly-protection#sanctified-resistance
  it('adds the sanctified resistance, gated on the creature trait the sheet already holds', () => {
    // "If you are sanctified … this resistance applies to unholy damage (if you are sanctified holy)
    // or holy damage (if you are sanctified unholy), regardless of what other traits the damage has."
    // Ours carried no sanctification lane at all. `whenCreatureTrait` is the IwrEntry gate the
    // resistance loop already honours (src/rules/derive.ts:2708-2709), resolved through
    // creatureTraitsOf — which is where a deity's sanctification is recorded.
    const rs = (cf('otherworldly-protection')?.resistances ?? []) as IwrEntry[];
    expect(rs.find((r) => r.type === 'unholy')?.whenCreatureTrait).toBe('holy');
    expect(rs.find((r) => r.type === 'holy')?.whenCreatureTrait).toBe('unholy');

    const unsanctified = deriveDefenses(protectedInventor(), db());
    expect(unsanctified.resistances.some((r) => r.type === 'unholy')).toBe(false);
    const holy: Character = { ...protectedInventor(), chosenCreatureTraits: [{ trait: 'holy', source: 'test deity' }] };
    expect(deriveDefenses(holy, db()).resistances.find((r) => r.type === 'unholy')?.value).toBe(7);
  });
});

describe('red-mantis-magic-school shows the player its whole curriculum', () => {
  // batch 033: red-mantis-magic-school#curriculum-description
  it('lists every printed curriculum spell in the subclass option the Builder renders', () => {
    // arcane-school-23 prints all 19 curriculum spells. The option copy the picker renders read
    // "- **2nd** , Mist / - **3rd** , Paralyze / … / - **9th**", six names deleted, while descRefs
    // still listed all 16 labels. src/data/index.ts writes the repaired description onto the
    // classFeature record only, never onto this nested option, so this is what the player reads.
    const opt = db().classes.wizard?.subclass?.options.find((o) => o.id === 'red-mantis-magic-school');
    expect(opt?.descRefs?.length).toBeGreaterThan(0); // the harness half: the labels were never lost
    for (const line of [
      '- **2nd** Invisibility, Mist',
      '- **3rd** Clairaudience, Paralyze',
      '- **4th** Clairvoyance, Translocate',
      '- **5th** Hallucination, Illusory Scene',
      '- **8th** Disappearance, Unrelenting Observation',
      '- **9th** Phantasmagoria',
    ])
      expect(opt?.description).toContain(line);
  });
});

describe('angel-eidolon prints the remaster Hallowed Strikes', () => {
  // batch 033: angel-eidolon#hallowed-strikes-text
  it('describes the holy trait and the spirit damage, not pre-remaster good damage', () => {
    // eidolon-1: "Your eidolon's unarmed Strikes gain the holy trait and deal 1 extra spirit damage
    // to unholy creatures and creatures with weakness to holy." Our description still carried the
    // pre-remaster sentence, which contradicts print on the trait, the damage type and the targets.
    const opt = db().classes.summoner?.subclass?.options.find((o) => o.id === 'angel-eidolon');
    // The harness half: the one copy that was already right is untouched by this row.
    expect(opt?.eidolonAbilities?.[0]?.text).toMatch(/gain the holy trait and deal 1 extra spirit damage/);
    const text = cf('angel-eidolon')?.description ?? '';
    expect(text).toMatch(/unarmed Strikes gain the holy trait and deal 1 extra spirit damage to unholy creatures and creatures with weakness to holy/);
    expect(text).not.toMatch(/extra 1 good damage/);
    // The nonlethal clause print states in the same paragraph must survive the rewrite.
    expect(text).toMatch(/nonlethal attacks with its unarmed attacks without taking the usual/);
  });
});
