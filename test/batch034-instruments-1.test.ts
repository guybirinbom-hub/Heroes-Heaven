/*
 * BATCH 034 — THE INSTRUMENT LANE, CHUNK instruments-1 (WG-COMPARISON family).
 *
 * Nine findings, one shape between eight of them: the comparison lands on `classFeatures/<id>`, and
 * for a subclass option or an extra-choice option that record is a prose stub whose whole mechanic
 * lives on `classes.<cls>.subclass.options[<same id>]` / `extraChoices[].options[<same id>]`. Batch 033
 * taught that walk for skills, lores, spells, feats and deeds. Two carriers were still not in it and
 * are added here:
 *
 *   · `skillChoice` (+ `skillChoiceLore`) — the option's SKILL PICK, which is the printed "**Way Skill**
 *     Deception or Intimidation" / "one Intelligence-based skill of your choice" clause asked as a
 *     question. wg-values now asserts it in the `choice-skill|` lane; wg-identity now names its answers
 *     in the `options` bucket. THREE options in core.json carry it.
 *   · `keyAbility` — the option that SETS the character's key attribute, which is three of their
 *     operations at once (ATTRIBUTE_*, CLASS_DC's attribute, and the casting source's attribute).
 *     EIGHT options carry it; only the four psychic ones also credit spellcasting, because the rogue's
 *     rackets have no casting block for a key attribute to key.
 *
 * The rest are settles, each scoped to the ONE member their side names rather than to a bucket or a
 * set, so every other member of the same record keeps reporting.
 *
 * A teach is legitimate only while the comparer still reports a record whose carrier is GONE, so every
 * teach below runs the REAL comparer as a node child against a STUNTED copy of public/core.json and
 * checks the flag comes straight back.
 *
 * ⚠ `--raw` is read carefully here, exactly as in test/batch033-instruments.test.ts. A TEACH is proved
 * WITH `--raw`, which bypasses the settle registries so a pass cannot come from something being
 * quieted. A SETTLE is proved WITHOUT `--raw` for the quiet half and WITH it for the noisy half,
 * because the point of those cases is that the settled run still reports every member the settle does
 * not name.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs an instrument as a real node child — fine alone, several times slower under the
 * full suite, where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));

type Core = Record<string, any>;

const tag = () => `${process.pid}-${Math.random().toString(36).slice(2)}`;

/** Run a comparer against a copy of public/core.json with ONE carrier removed — batch 033's shape. */
function stuntedCore<T>(name: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b034i1-stunt-${name}-${tag()}.json`;
  const copy: Core = JSON.parse(JSON.stringify(CORE));
  mutate(copy);
  expect(JSON.stringify(copy)).not.toBe(JSON.stringify(CORE));   // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(copy));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/**
 * The same, WITHOUT the "the stunt must bite" assertion — for a copy patched to the state a pending
 * DATA row will create. Once the driver applies that row the patch is a no-op, and a bite assertion
 * would turn the test into a patched-vs-shipped delta that flips on the day the row lands.
 */
function patchedCore<T>(name: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b034i1-patch-${name}-${tag()}.json`;
  const copy: Core = JSON.parse(JSON.stringify(CORE));
  mutate(copy);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(copy));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** The subclass / extra-choice option object of an id — the carrier most cases here stunt. */
function option(core: Core, id: string): Core {
  for (const cls of Object.values(core.classes ?? {}) as Core[]) {
    for (const o of (cls.subclass?.options ?? []) as Core[]) if (o.id === id) return o;
    for (const ec of (cls.extraChoices ?? []) as Core[]) for (const o of (ec.options ?? []) as Core[]) if (o.id === id) return o;
  }
  throw new Error(`no subclass/extraChoice option carrier for ${id}`);
}

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--verbose', ...extra]);
const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, '--verbose', ...extra]);

/** wg-diff has no `--ids`; `--out` is its only per-record view. id -> missing kinds, THEY-ONLY only. */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b034i1-diff-${tag()}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

describe('batch 034 instruments-1 — empiricism-methodology: the methodology skill PICK lives on the class option', () => {
  // batch 034: empiricism-methodology
  it('empiricism-methodology: wg-values credits skillChoice in the choice-skill lane, and reports it MISSING without it', () => {
    /*
     * Print (AoN methodology-6, Empiricism): *"You are trained in one Intelligence-based skill of your
     * choice."* Ours is `classes.investigator.subclass.options['empiricism-methodology'].skillChoice =
     * ['arcana','crafting','occultism','society']` with `skillChoiceLore: true` — trained at
     * build.ts:3627-3643, counted at build.ts:1141, prompted at build.ts:1248-1250 and drawn as a
     * visible select at src/builder/shared.tsx:3256-3290. Its sibling methodologies carry a FIXED
     * `grants.skills` instead, which is why the batch-033 option walk read them and missed this one.
     *
     * mutation-proof — stunts the taught carrier `skillChoice` on the investigator subclass option;
     * the settle key is the `choice-skill|<skill>` lane in scripts/wg-values.mjs's `ourAssertions`.
     * All three of their trained skills must come straight back as MISSING.
     */
    expect(values('empiricism-methodology', ['--raw'])).toMatch(/1 agree on every one/);
    const out = stuntedCore('emp-values', (c) => { delete option(c, 'empiricism-methodology').skillChoice; },
      (core) => values('empiricism-methodology', ['--raw', ...core]));
    expect(out).toMatch(/MISSING\s+skill\|arcana\s+theirs=trained\s+ours=\(nothing\)/);
    expect(out).toMatch(/MISSING\s+skill\|crafting\s+theirs=trained\s+ours=\(nothing\)/);
    expect(out).toMatch(/MISSING\s+skill\|occultism\s+theirs=trained\s+ours=\(nothing\)/);
  }, 180_000);

  // batch 034: empiricism-methodology
  it('empiricism-methodology: wg-identity names the pick\'s answers, and the Lore branch is its own credit', () => {
    /*
     * Their side is `select from:CUSTOM "Select a Skill"` whose branches are Arcana / Crafting /
     * Occultism / Lore, so the four land in the `options` bucket. `skillChoice` answers the first three
     * and `skillChoiceLore` the fourth (the Lore-subject branch build.ts:3627-3640 accepts).
     *
     * ⚠ Their list omits Society, which print's *"one Intelligence-based skill"* allows — WG encoding
     * LESS than print. Ours offers it and correctly reports nothing for it: the bucket only ever asks
     * whether THEIR names have a counterpart on ours.
     *
     * mutation-proof — stunts the two taught carriers `skillChoice` and `skillChoiceLore` on the
     * investigator subclass option; the settle key is the `options` bucket of scripts/wg-identity.mjs's
     * `ourIdentities`. The second stunt removes the Lore branch ALONE, which is what shows
     * `skillChoiceLore` is doing its own work rather than riding on `skillChoice`.
     */
    expect(identity('empiricism-methodology', ['--raw'])).toMatch(/1 match on every one/);
    const both = stuntedCore('emp-ident-both', (c) => {
      const o = option(c, 'empiricism-methodology');
      delete o.skillChoice; delete o.skillChoiceLore;
    }, (core) => identity('empiricism-methodology', ['--raw', ...core]));
    expect(both).toMatch(/options\s+theirs-not-ours=\[arcana, crafting, occultism, lore\]/);
    const loreOnly = stuntedCore('emp-ident-lore', (c) => { delete option(c, 'empiricism-methodology').skillChoiceLore; },
      (core) => identity('empiricism-methodology', ['--raw', ...core]));
    expect(loreOnly).toMatch(/options\s+theirs-not-ours=\[lore\]/);
    expect(loreOnly).toMatch(/ours=\[arcana, crafting, occultism, society\]/);
  }, 180_000);
});

describe('batch 034 instruments-1 — way-of-the-pistolero: the Way Skill pick and the misspelt deed', () => {
  // batch 034: way-of-the-pistolero
  it('way-of-the-pistolero: the Deception-or-Intimidation pick is credited from the option skillChoice', () => {
    /*
     * Print (AoN way-2): *"Way Skill Deception or Intimidation"*. Ours is
     * `classes.gunslinger.subclass.options['way-of-the-pistolero'].skillChoice = ['deception',
     * 'intimidation']`; classFeatures/way-of-the-pistolero carries only `grantsActions:
     * ['raconteurs-reload']`, which is the whole of the misread. Their two branches are shaped as
     * variables (SKILL_DECEPTION / SKILL_INTIMIDATION) and pair with our bare skill names through
     * `contains()`, the two-way substring match.
     *
     * mutation-proof — stunts the taught carrier `skillChoice` on the gunslinger subclass option; the
     * settle key is the `options` bucket of scripts/wg-identity.mjs's `ourIdentities`.
     */
    const out = stuntedCore('pist-skill', (c) => { delete option(c, 'way-of-the-pistolero').skillChoice; },
      (core) => identity('way-of-the-pistolero', ['--raw', ...core]));
    expect(out).toMatch(/options\s+theirs-not-ours=\[skilldeception, skillintimidation\]/);
  }, 180_000);

  // batch 034: way-of-the-pistolero
  it('way-of-the-pistolero: the advanced deed carries the REMASTER name, and that is what closes the grants gap', () => {
    /*
     * NOT a WG typo — the remaster renames the deed, and OURS is the side that still prints the legacy
     * name. AoN way-2 (Guns & Gears Remastered, the doc classFeatures/way-of-the-pistolero claims as its
     * aonId) embeds the advanced deed as `<document id="action-912" />`, and action-912 is titled
     * "Pistoler's Retort" with `legacy_id: ["action-3681"]`; action-3681 ("Pistolero's Retort", the
     * un-remastered Guns & Gears) carries the matching `remaster_id: ["action-912"]`. Our own catalogue
     * says the same thing about itself: actions/pistolers-retort IS action-912 under the remaster name,
     * while classFeatures/pistoleros-retort — the record the way actually grants — is action-3681. The
     * way's two other deeds are both remaster records (ten-paces action-911, grim-swagger action-913),
     * so this one record is the odd one out. The fix is the DATA row in
     * work/.b034-rows-instruments-1.json (name/aonId/edition → the remaster deed), not a settle.
     *
     * ASSERTED ON A PATCHED COPY, never as a patched-vs-shipped delta: the row has not landed yet, so
     * this checks the state the row creates (which is also the state after it lands) plus the carrier
     * scope, and nothing that flips the day the driver applies it.
     */
    const patch = (c: Core) => { c.classFeatures['pistoleros-retort'].name = "Pistoler's Retort"; };
    expect(patchedCore('pist-renamed', patch, (core) => identity('way-of-the-pistolero', ['--raw', ...core])))
      .toMatch(/1 match on every one/);
    /* …and the credit still comes from the CARRIER, not from the rename: strip `featureIds` on the same
     * patched copy and all three deeds return. */
    const out = stuntedCore('pist-deeds', (c) => { patch(c); delete option(c, 'way-of-the-pistolero').featureIds; },
      (core) => identity('way-of-the-pistolero', ['--raw', ...core]));
    expect(out).toMatch(/grants\s+theirs-not-ours=\[tenpaces, pistolersretort, grimswagger\]/);
  }, 180_000);

  // batch 034: way-of-the-pistolero
  it('way-of-the-pistolero: the granted deed is the record the remaster prints, and no instrument limit parks it', () => {
    /*
     * The EXPERIENCE half of the same fact. The harness judges a `giveAbilityBlock` by NAME, so their
     * "Pistoler's Retort" reads `undelivered` today — a REAL undelivered grant, because the record we
     * grant is the legacy one. The first pass parked it in work/experience-instrument-limits.json under
     * lane `wg-misspelled-ability-block`; that park was removed with the premise it rested on, and this
     * pins it removed so it cannot come back without a re-read.
     *
     * The rest is asserted against the DATA rather than any prose: the deed the option grants, and the
     * two catalogue records that prove which printing each name belongs to.
     */
    const limits = JSON.parse(readFileSync(join(CLI_ROOT, 'work/experience-instrument-limits.json'), 'utf8'));
    expect(limits.records['way-of-the-pistolero']).toBeUndefined();
    const deeds = (option(CORE, 'way-of-the-pistolero').featureIds as Core[]).map((f) => `${f.id}@${f.level}`);
    expect(deeds).toEqual(['ten-paces@1', 'pistoleros-retort@9', 'grim-swagger@15']);
    /* The remaster deed and the legacy deed, both shipped, each under its own printing's name. */
    expect(CORE.actions['pistolers-retort']).toMatchObject({ name: "Pistoler's Retort", aonId: 'action-912' });
    expect(CORE.actions['pistoleros-retort']).toMatchObject({ name: "Pistolero's Retort", aonId: 'action-3681' });
    /* The siblings the way grants are the REMASTER records, which is why the third one being legacy is
     * the defect rather than a house style. */
    expect(CORE.classFeatures['ten-paces'].aonId).toBe('action-911');
    expect(CORE.classFeatures['grim-swagger'].aonId).toBe('action-913');
  });
});

describe('batch 034 instruments-1 — precise-discipline: a subconscious mind SETS the key attribute', () => {
  // batch 034: precise-discipline
  it('precise-discipline: the option keyAbility credits classDc, attribute and spellcasting, and none of them without it', () => {
    /*
     * Print (AoN subconscious-mind-5's sibling, and the record's own text): *"Key Attribute Your key
     * attribute is Intelligence."* The psychic chooses its key attribute with its subconscious mind, so
     * `classes.psychic.keyAbility` is [] and `classDc` is "trained" on purpose; the answer is
     * `extraChoices['subconscious-mind'].options['precise-discipline'].keyAbility = 'int'`, walked by
     * subclassKeyAbility (build.ts:889-901), pushed as the level-1 boost (build.ts:1327), made the
     * character's keyAbility (build.ts:3378/3393) which deriveClassDc reads (derive.ts:669), and fed to
     * the casting entry (build.ts:4249).
     *
     * mutation-proof — stunts the taught carrier `keyAbility` on the psychic extra-choice option; the
     * settle key is the option walk in scripts/wg-diff.mjs's `ourKindsOf`. All three kinds must come
     * back, and the untouched sibling emotional-acceptance must NOT move — a blanket credit would take
     * the sibling with it.
     */
    expect(theyOnly().has('precise-discipline')).toBe(false);
    const m = stuntedCore('psy-key', (c) => { delete option(c, 'precise-discipline').keyAbility; },
      (core) => theyOnly(core));
    expect(m.get('precise-discipline')).toEqual(['classDc', 'attribute', 'spellcasting']);
    expect(m.has('emotional-acceptance')).toBe(false);
  }, 240_000);

  // batch 034: emotional-acceptance#instrument
  it('emotional-acceptance: the spellcasting half needs the class casting block, and only that half moves without it', () => {
    /*
     * Print (AoN subconscious-mind-5, Emotional Acceptance): *"Key Attribute Your key attribute is
     * Charisma. Psyche Action Restore the Mind"*. Their `defineCastingSource
     * PSYCHIC:::SPONTANEOUS-REPERTOIRE:::OCCULT:::ATTRIBUTE_CHA` is answered by
     * `classes.psychic.spellcasting`, not by the option — the option only says which attribute keys it.
     * So the teach credits `spellcasting` ONLY when the owning class has a casting block, which is why
     * the rogue's four rackets (avenger, mastermind, ruffian, scoundrel) carry the same `keyAbility`
     * field and credit no casting at all.
     *
     * mutation-proof — stunts the class casting block instead of the option; the settle key is the same
     * option walk in scripts/wg-diff.mjs's `ourKindsOf`. `spellcasting` must return ALONE, with
     * `classDc` and `attribute` still credited off the option — which is what shows the `cls?.spellcasting`
     * guard is doing its own work rather than being carried by the keyAbility read.
     */
    expect(theyOnly().has('emotional-acceptance')).toBe(false);
    const m = stuntedCore('psy-casting', (c) => { delete c.classes.psychic.spellcasting; }, (core) => theyOnly(core));
    expect(m.get('emotional-acceptance')).toEqual(['spellcasting']);
    expect(m.get('precise-discipline')).toEqual(['spellcasting']);
    /* The control group: same field, no casting block, credited nothing then and nothing now. */
    for (const id of ['avenger', 'mastermind', 'ruffian', 'scoundrel']) {
      expect(option(CORE, id).keyAbility).toBeTruthy();
      expect(CORE.classes.rogue.spellcasting).toBeUndefined();
    }
  }, 240_000);
});

describe('batch 034 instruments-1 — elemental-blast: the die count is a class table, not a record field', () => {
  // batch 034: elemental-blast#instrument
  it('elemental-blast reports no missing kind, and the off-record carrier the entry names is real', () => {
    /*
     * Print (AoN action-2125): *"The element determines the damage die, damage type, and range (for a
     * ranged blast)."* Their `createValue KINETICIST_BLAST_DICE = 1` is the die TALLY, whose two halves
     * are `deriveBlastStrikes`'s class ladder in src/rules/derive.ts and `blastDiceBonus` on
     * feats/improved-elemental-blast — a ladder keyed by CLASS plus a field on ANOTHER record, so the
     * record itself carries nothing either walk could find.
     *
     * OFF_RECORD_CARRIERS is not one of the audited settle registries (`--raw` does not bypass it), so
     * no mutation-proof marker is owed here — the same reading as test/batch033-closer.test.ts. What IS
     * owed is proof that the entry is PER ID and that the carrier it names is real, both below: put
     * `specialStat` on a FILE row in REGISTRY_KINDS instead and the ladder would be credited to every
     * id in derive.ts.
     */
    expect(theyOnly().has('elemental-blast')).toBe(false);
    const src = readFileSync(join(CLI_ROOT, 'scripts/wg-diff.mjs'), 'utf8');
    expect(src).toContain("'elemental-blast': ['specialStat'],");
    /* The carrier, both halves. If either goes, the entry's reason is gone and this fails. */
    expect(CORE.feats['improved-elemental-blast'].blastDiceBonus).toBe(1);
    const derive = readFileSync(join(CLI_ROOT, 'src/rules/derive.ts'), 'utf8');
    expect(derive).toMatch(/\[5,\s*9,\s*13,\s*17\]\.filter/);
  }, 240_000);
});

describe('batch 034 instruments-1 — elemental-instinct: the element is a stored ANSWER, not a granted record', () => {
  // batch 034: elemental-instinct#instrument
  it('elemental-instinct: the grantsRecord settle names their six element blocks only, and the choice it credits is real', () => {
    /*
     * Print (AoN instinct-7, Elemental): *"Select an element from the Elemental Instincts table to be
     * your instinct's element. If your element offers multiple damage types, choose one of those type
     * when you select your element."* WG has no choice flag in its vocabulary, so it hands the answer
     * over as six `giveAbilityBlock` blocks ("Kinetic Element (Air)" … "(Wood)"); ours is
     * `classFeatures/elemental-instinct.choice {flag:'instinctElement'}`, whose options carry each
     * element's own `grant.whileActive` resistances. There is no record on our side to pair with.
     *
     * mutation-proof — stunts the settle keys 'elemental-instinct' in wg-diff's VERIFIED_EQUIVALENT and
     * in wg-identity's SETTLED_IDENTITIES by running both comparers under `--raw`, the registries' own
     * bypass, and then stunts the PREMISE (the `choice` the entries credit) to show `ours` really is the
     * flag: with the choice deleted `ours=[(nothing)]` and the record's whole option list reports too.
     */
    expect(theyOnly().has('elemental-instinct')).toBe(false);
    expect(theyOnly(['--raw']).get('elemental-instinct')).toEqual(['grantsRecord']);
    expect(identity('elemental-instinct')).toMatch(/1 match on every one/);
    expect(identity('elemental-instinct', ['--raw'])).toMatch(
      /grants\s+theirs-not-ours=\[kineticelementair, kineticelementearth, kineticelementfire, kineticelementmetal, kineticelementwater, kineticelementwood\]/,
    );
    const out = stuntedCore('ei-choice', (c) => { delete c.classFeatures['elemental-instinct'].choice; },
      (core) => identity('elemental-instinct', ['--raw', ...core]));
    expect(out).toMatch(/ours=\[\(nothing\)\]/);
  }, 240_000);

  // batch 034: elemental-instinct#instrument
  it('elemental-instinct: the resistance settle answers the wording, and wg-diff still guards the carrier', () => {
    /*
     * Print (AoN instinct-7, Raging Resistance): *"You resist the damage dealt by attacks and abilities
     * of elemental creatures of your chosen element, as well as creatures made of your element,
     * regardless of the damage type. You also resist damage dealt by attacks, spells, and abilities
     * with your elemental trait."* Both rows are carried per element on
     * `choice.options[].grant.whileActive[].resistances` — twelve entries — and WG writes the whole
     * first sentence as ONE unnamed RESISTANCES string, emitted twice identically. There is no type
     * name in it to match, so nothing may be added: authoring a resistance for their sentence would
     * double-count the two rows the player already gets.
     *
     * ⚠ THE LIMIT OF THIS SETTLE, stated rather than hidden. Their resistance set has exactly ONE
     * member, so settling it silences this record's whole `set|resistances` row — unlike decay-instinct
     * and spirit-instinct, whose sets have a NAMED member that keeps reporting beside the clause. The
     * carrier is therefore guarded by the OTHER instrument, and that is what the stunt below asserts.
     *
     * mutation-proof — stunts the carrier `grant.whileActive` on every option of the record's choice;
     * the settle key is 'elemental-instinct' in wg-values's SETTLED_VALUES. wg-values goes quiet (the
     * limit above), and wg-diff reports `defense` for the same stunt, so a deleted carrier is still
     * caught by the gate rather than by nobody.
     */
    expect(values('elemental-instinct')).toMatch(/1 agree on every one/);
    const stunt = (c: Core) => { for (const o of c.classFeatures['elemental-instinct'].choice.options) delete o.grant.whileActive; };
    expect(stuntedCore('ei-res-values', stunt, (core) => values('elemental-instinct', core))).toMatch(/1 agree on every one/);
    expect(stuntedCore('ei-res-diff', stunt, (core) => theyOnly(core)).get('elemental-instinct')).toEqual(['defense']);
  }, 240_000);
});

describe('batch 034 instruments-1 — spirit-instinct: an undead-damage clause with no type name', () => {
  // batch 034: spirit-instinct#instrument
  it('spirit-instinct: the settle names their unnameable clause only, and void keeps reporting', () => {
    /*
     * Print (AoN instinct-12, Spirit — Raging Resistance): *"You resist void damage, as well as damage
     * dealt by the attacks and abilities of undead creatures, regardless of the damage type."* Ours is
     * `classFeatures/spirit-instinct.whileActive[0].resistances` = void 3+Con and 'all damage from
     * undead' 3+Con, the second carrying WG's own sentence word for word in its sibling `condition`
     * field — which is what the IWR breakdown prints to the player. `void` already matches; a
     * damage-SOURCE clause has no type name, so each side invents a phrase for it.
     *
     * mutation-proof — stunts the settle key 'spirit-instinct' in wg-values's SETTLED_VALUES by
     * deleting the record's OTHER (named) resistance from a content copy: `void` must come straight
     * back as a SET-GAP, which is what shows the settle drops their one clause and not the set. Then
     * stunts the whole carrier, which must also still report.
     */
    expect(values('spirit-instinct')).toMatch(/1 agree on every one/);
    const noVoid = stuntedCore('spirit-void', (c) => {
      const w = c.classFeatures['spirit-instinct'].whileActive[0];
      w.resistances = w.resistances.filter((r: Core) => r.type !== 'void');
    }, (core) => values('spirit-instinct', core));
    expect(noVoid).toMatch(/SET-GAP\s+set\|resistances\s+theirs=void\s+ours=all damage from undead/);
    const noCarrier = stuntedCore('spirit-carrier', (c) => { delete c.classFeatures['spirit-instinct'].whileActive; },
      (core) => values('spirit-instinct', core));
    expect(noCarrier).toMatch(/SET-GAP\s+set\|resistances\s+theirs=void\s+ours=\(nothing\)/);
  }, 180_000);
});

describe('batch 034 instruments-1 — vanguard-of-roaring-waters and monarch-of-the-fey-courts are apparition options', () => {
  // batch 034: vanguard-of-roaring-waters#instrument
  it('vanguard-of-roaring-waters: the apparition spells are credited from the animist extraChoices option', () => {
    /*
     * Print (AoN apparition text): **Apparition Skills** Mountain Lore, River Lore; ten apparition
     * spells from Rousing Splash to Wrathful Storm; **Vessel Spell** River Carving Mountains. Ours is
     * `classes.animist.extraChoices['apparition'].options['vanguard-of-roaring-waters']` —
     * grants.lores, loreProgression 8/16, ten grantedSpells and focusSpells — while the classFeatures
     * record of the same id is bare but for `otherTags: ['animist-apparition']`.
     *
     * No teach and no settle is owed for this finding: the batch-033 option-carrier walk already reads
     * every one of those fields, so the record is quiet on all three comparers today. What is pinned is
     * that the credit is LIVE rather than incidental.
     *
     * mutation-proof — stunts the carrier `grantedSpells` on the animist extra-choice option; all ten
     * apparition spells must return, with the vessel focus spell (a different field) still credited.
     */
    expect(identity('vanguard-of-roaring-waters', ['--raw'])).toMatch(/1 match on every one/);
    const out = stuntedCore('vanguard-spells', (c) => { delete option(c, 'vanguard-of-roaring-waters').grantedSpells; },
      (core) => identity('vanguard-of-roaring-waters', ['--raw', ...core]));
    expect(out).toMatch(/spells\s+theirs-not-ours=\[rousingsplash, hydraulicpush, mist, crashingwave, hydraulictorrent, controlwater, personalocean, dancingfountain, whirlpool, wrathfulstorm\]/);
    expect(out).toMatch(/ours=\[rivercarvingmountains\]/);
  }, 180_000);

  // batch 034: monarch-of-the-fey-courts#instrument
  it('monarch-of-the-fey-courts: the Art and Fey Lore ladder is credited rung by rung from the option', () => {
    /*
     * Print (AoN apparition text): **Apparition Skills** Art Lore, Fey Lore, with the animist's
     * apparition ladder raising them at 8th and 16th — WG's `createValue SKILL_LORE_ART = T` plus
     * `adjValue = E` at level 8 and `= M` at 16. Ours is the option's `grants.lores ['art','fey']` and
     * `loreProgression [{8,expert},{16,master}]`, folded in through maxRank at build.ts:3617-3624.
     *
     * As with vanguard above, this finding needs no teach and no settle — the batch-033 walk reads the
     * fields and the record is quiet. The rung-by-rung assertion is what separates "read the carrier"
     * from "excuse the record", so it is what the stunt checks.
     *
     * mutation-proof — stunts the carrier `grants.lores` on the animist extra-choice option; both
     * Lores must return at BOTH rungs.
     */
    expect(values('monarch-of-the-fey-courts', ['--raw'])).toMatch(/1 agree on every one/);
    const out = stuntedCore('monarch-lores', (c) => { delete option(c, 'monarch-of-the-fey-courts').grants.lores; },
      (core) => values('monarch-of-the-fey-courts', ['--raw', ...core]));
    expect(out).toMatch(/MISSING\s+skill\|lore:art\s+theirs=expert/);
    expect(out).toMatch(/MISSING\s+skill\|lore:art\s+theirs=master/);
    expect(out).toMatch(/MISSING\s+skill\|lore:fey\s+theirs=expert/);
    expect(out).toMatch(/MISSING\s+skill\|lore:fey\s+theirs=master/);
  }, 180_000);
});
