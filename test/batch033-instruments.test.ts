/*
 * BATCH 033 — THE INSTRUMENT LANE (WG-COMPARISON family).
 *
 * ONE root cause covers 38 of the family's 41 findings. Three comparers credited a class's option list
 * to the feature the class DECLARES as its carrier (`subclass.featureId`, `extraChoices[].featureId`)
 * and never to the OPTION RECORD ITSELF — which is the record the comparison actually lands on. Every
 * witch patron, druid order, gunslinger way, summoner eidolon, investigator methodology, wizard arcane
 * school and animist apparition is a prose stub in `classFeatures` whose whole mechanic lives on
 * `classes.<cls>.subclass.options[<same id>]` / `extraChoices[].options[<same id>]`, so reading the stub
 * alone reported delivered mechanics as absent.
 *
 * A teach is legitimate only while the comparer still reports a record whose carrier is GONE. Every case
 * below therefore runs the REAL comparer as a node child against a STUNTED copy of public/core.json (or
 * of src/rules/advancement.ts) and checks the flag comes straight back.
 *
 * ⚠ Read `--raw` carefully in this file. A TEACH is proved with `--raw`, which bypasses the settle
 * registries so a pass cannot come from something being quieted. A SETTLE is proved WITHOUT `--raw`,
 * because the whole point of those cases is that the settled run still reports every member the settle
 * does not name.
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

/**
 * Run a comparer against a copy of public/core.json with ONE carrier removed. Same shape as batch 032's
 * `stuntedLane`, one layer in: these carriers live in the shipped content, not in a TypeScript table.
 *
 * `--core` is the comparers' own anti-laundering hook. wg-values and wg-diff shipped it; wg-identity did
 * NOT until this batch, which is why the option-carrier teach could not be mutation-proofed there at all
 * — a stunt run silently re-read the shipped content and reported nothing, which reads exactly like a
 * teach that works.
 */
function stuntedCore<T>(tag: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b033-stunt-${tag}.json`;
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

/** The subclass / extra-choice option object of an id — the carrier every case here stunts. */
function option(core: Core, id: string): Core {
  for (const cls of Object.values(core.classes ?? {}) as Core[]) {
    for (const o of (cls.subclass?.options ?? []) as Core[]) if (o.id === id) return o;
    for (const ec of (cls.extraChoices ?? []) as Core[]) for (const o of (ec.options ?? []) as Core[]) if (o.id === id) return o;
  }
  throw new Error(`no subclass/extraChoice option carrier for ${id}`);
}

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--verbose', ...extra]);
const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, '--verbose', ...extra]);

describe('batch 033 instruments — the option carrier a class DECLARES but the record OWNS', () => {
  // batch 033: the-resentment#patron-skill
  it('the-resentment: the witch patron skill is credited from the option, and reported without it', () => {
    /*
     * Printed (AoN patron-14, The Resentment): the patron's **Patron Skill** is Occultism. Ours is
     * `classes.witch.subclass.options['the-resentment'].grants.skills = ['occultism']`; classFeatures/
     * the-resentment is a prose stub, which is the whole of the misread.
     *
     * mutation-proof — stunts the taught carrier `grants.skills` on the witch subclass option. Delete it
     * and the record must go straight back to `MISSING skill|occultism`.
     */
    expect(values('the-resentment', ['--raw'])).toMatch(/compared 1 records with at least one comparable value; 1 agree on every one/);
    const out = stuntedCore('resentment-skills', (c) => { delete option(c, 'the-resentment').grants.skills; },
      (core) => values('the-resentment', ['--raw', ...core]));
    expect(out).toMatch(/MISSING\s+skill\|occultism\s+theirs=trained\s+ours=\(nothing\)/);
  }, 180_000);

  // batch 033: way-of-the-drifter#instrument-skill
  it('way-of-the-drifter: the gunslinger Way Skill is credited from the option, and reported without it', () => {
    /*
     * Printed (AoN way-1, Way of the Drifter): **Way Skill** Acrobatics. Ours is
     * `classes.gunslinger.subclass.options['way-of-the-drifter'].grants.skills = ['acrobatics']`.
     *
     * mutation-proof — stunts the taught carrier `grants.skills` on the gunslinger subclass option; the
     * MISSING skill|acrobatics flag the finding reproduced must come back unchanged.
     */
    const out = stuntedCore('drifter-skills', (c) => { delete option(c, 'way-of-the-drifter').grants.skills; },
      (core) => values('way-of-the-drifter', ['--raw', ...core]));
    expect(out).toMatch(/MISSING\s+skill\|acrobatics\s+theirs=trained\s+ours=\(nothing\)/);
  }, 180_000);

  // batch 033: steward-of-stone-and-fire#instrument
  it('steward-of-stone-and-fire: the apparition Lore ladder is asserted RUNG BY RUNG, not just trained', () => {
    /*
     * Printed (AoN apparition-11, Steward of Stone and Fire): **Apparition Skills** Mountain Lore,
     * Volcano Lore, with the animist's apparition ladder raising them at 8th and 16th. Ours is the
     * option's `grants.lores` plus `loreProgression [{level:8,rank:'expert'},{level:16,rank:'master'}]`,
     * folded in through maxRank at build.ts:3617-3624.
     *
     * The rung-by-rung assertion is the property that separates "read the carrier" from "excuse the
     * record": a ladder that stops short of the printed rank must still report DIFFERENT rather than be
     * credited wholesale.
     *
     * mutation-proof — stunts the taught carrier `loreProgression` by TRUNCATING it to the 8th-level rung
     * rather than deleting it, which is the stunt a wholesale teach would survive: master must return.
     */
    expect(values('steward-of-stone-and-fire', ['--raw'])).toMatch(/1 agree on every one/);
    const out = stuntedCore('steward-ladder', (c) => { option(c, 'steward-of-stone-and-fire').loreProgression = [{ level: 8, rank: 'expert' }]; },
      (core) => values('steward-of-stone-and-fire', ['--raw', ...core]));
    expect(out).toMatch(/DIFFERENT\s+skill\|lore:mountain\s+theirs=master/);
    expect(out).toMatch(/DIFFERENT\s+skill\|lore:volcano\s+theirs=master/);
  }, 180_000);

  // batch 033: flame-order#instrument
  it('flame-order: the druid order focus spell is credited from the option, and reported without it', () => {
    /*
     * Printed (AoN druidic-order-5, Flame): the order grants the **Wildfire** order spell and the Fire
     * Lung feat. Ours keeps both on `classes.druid.subclass.options['flame-order']` — `focusSpells`
     * ['wildfire'] and `grantedFeats` ['fire-lung'] — while classFeatures/flame-order is a prose stub.
     *
     * mutation-proof — stunts the taught carrier `focusSpells` on the druid subclass option; the
     * `spells theirs-not-ours=[wildfire]` flag must come back.
     */
    const out = stuntedCore('flame-focus', (c) => { delete option(c, 'flame-order').focusSpells; },
      (core) => identity('flame-order', ['--raw', ...core]));
    expect(out).toMatch(/spells\s+theirs-not-ours=\[wildfire\]/);
  }, 180_000);

  // batch 033: flame-order#instrument
  it('flame-order: the option feat grant reads grantedFeats, the field options actually carry', () => {
    /*
     * The dead-field half. `creditOptions` read `o.grants?.feats` — a key NO option in core.json carries
     * — so the DECLARING selector under-read too. The real field is `grantedFeats`.
     *
     * mutation-proof — stunts the taught carrier `grantedFeats` on the druid subclass option. If the
     * reader had stayed on the phantom `grants.feats` this stunt would change nothing and the case would
     * fail; it passes only because the credit really comes from `grantedFeats`.
     */
    expect(option(CORE, 'flame-order').grants?.feats).toBeUndefined();
    expect(option(CORE, 'flame-order').grantedFeats).toContain('fire-lung');
    const out = stuntedCore('flame-feats', (c) => { delete option(c, 'flame-order').grantedFeats; },
      (core) => identity('flame-order', ['--raw', ...core]));
    expect(out).toMatch(/grants\s+theirs-not-ours=\[firelung\]/);
  }, 180_000);

  // batch 033: red-mantis-magic-school
  it('red-mantis-magic-school: the arcane school initial AND advanced school spells are both credited', () => {
    /*
     * Printed (AoN arcane-school-23, Red Mantis Magic School): the school grants **Debilitating Terror** as its
     * initial school spell and **Shroud of the Mantis** as its advanced one. `advancedFocusSpell` was in
     * no option reader at all before this batch — only `focusSpells` was — so half of every arcane
     * school's spell grant was invisible.
     *
     * mutation-proof — stunts BOTH taught carriers on the wizard subclass option; both names must return
     * together, which is what shows the advanced-spell read is doing its own work.
     */
    const out = stuntedCore('mantis-spells', (c) => {
      const o = option(c, 'red-mantis-magic-school');
      delete o.focusSpells; delete o.advancedFocusSpell;
    }, (core) => identity('red-mantis-magic-school', ['--raw', ...core]));
    expect(out).toMatch(/spells\s+theirs-not-ours=\[debilitatingterror, shroudofthemantis\]/);
  }, 180_000);

  // batch 033: way-of-the-sniper
  it('way-of-the-sniper: the level-gated deeds are credited from the option featureIds', () => {
    /*
     * Printed (AoN way-3, Way of the Sniper): One Shot, One Kill at 1st, Vital Shot at 9th and Ghost Shot
     * at 15th. Ours keeps them on the gunslinger subclass option's `featureIds`, level-gated, matching
     * WG's gates exactly.
     *
     * mutation-proof — stunts the taught carrier `featureIds` on the gunslinger subclass option; all
     * three deeds must return. `ours=[coveredreload]` stays, which shows the record's OWN grantsActions
     * are still read and the stunt removed only the taught carrier.
     */
    const out = stuntedCore('sniper-features', (c) => { delete option(c, 'way-of-the-sniper').featureIds; },
      (core) => identity('way-of-the-sniper', ['--raw', ...core]));
    expect(out).toMatch(/grants\s+theirs-not-ours=\[oneshotonekill, vitalshot, ghostshot\]/);
  }, 180_000);

  // batch 033: way-of-the-vanguard
  it('way-of-the-vanguard: wg-diff credits the option KINDS, and drops them when the option is stripped', () => {
    /*
     * The same carrier map in the kind-differ. `--out` is the only per-record view wg-diff has, so the
     * case reads the record's own row out of the emitted JSON rather than the summary.
     *
     * mutation-proof — stunts the taught carriers `grants` and `featureIds` on the gunslinger subclass
     * option. The `skill` kind must disappear from OUR side while `grantsRecord` (which the record itself
     * still carries) stays, and the untouched sibling way-of-the-sniper must not move — a blanket teach
     * would take the sibling with it.
     */
    const read = (out: string) => {
      /* wg-diff buckets its rows (theyOnly / disagree / weOnly / agree / …) and a record can appear in
       * more than one, so collect OUR kinds across every bucket rather than trusting the first hit. */
      const data = JSON.parse(readFileSync(join(CLI_ROOT, out), 'utf8')) as Core;
      const rows = (Object.values(data) as Core[]).flatMap((v) => (Array.isArray(v) ? v : []));
      const of = (id: string) =>
        [...new Set(rows.filter((r: Core) => r?.id === id).flatMap((r: Core) => (r.ourKinds ?? []) as string[]))].sort();
      return { vanguard: of('way-of-the-vanguard'), sniper: of('way-of-the-sniper') };
    };
    const shippedOut = 'work/.b033-diff-shipped.json';
    runScript('wg-diff.mjs', ['--out', shippedOut]);
    const shipped = read(shippedOut);
    rmSync(join(CLI_ROOT, shippedOut), { force: true });
    expect(shipped.vanguard).toEqual(expect.arrayContaining(['skill', 'grantsRecord']));

    const stuntOut = 'work/.b033-diff-stunt.json';
    stuntedCore('vanguard-kinds', (c) => {
      const o = option(c, 'way-of-the-vanguard');
      delete o.featureIds; delete o.grants;
    }, (core) => runScript('wg-diff.mjs', ['--out', stuntOut, ...core]));
    const stunted = read(stuntOut);
    rmSync(join(CLI_ROOT, stuntOut), { force: true });
    expect(stunted.vanguard).not.toContain('skill');
    expect(stunted.vanguard).toContain('grantsRecord');
    expect(stunted.sniper).toEqual(shipped.sniper);
  }, 300_000);
});

describe('batch 033 instruments — carriers that are not on a subclass option at all', () => {
  // batch 033: battle-creed
  it('battle-creed: the advancement table a SUBCLASS owns, not only the rows that name it in source', () => {
    /*
     * src/rules/advancement.ts is keyed `<classId>` AND `<subclassId>`, and a subclass key is a COMPLETE
     * table that REPLACES the class default (the file's own note names "warpriest, battle-creed"). Its
     * rows carry the printed CLAUSE in `source` ('initial-creed', 'major-creed', 'true-creed'), never the
     * subclass id, so `advancementBySource.get('battle-creed')` was empty and three saves the table
     * raises exactly as printed reported MISSING.
     *
     * The teach is deliberately bounded: ONLY a table key that is also a subclass-option id is credited,
     * so a class-keyed table ('druid', 'cleric') is credited to nobody and keeps reporting.
     *
     * mutation-proof — stunts the taught carrier by deleting the will/master@15 row from a copy of
     * advancement.ts and pointing the comparer's own `--advancement` hook at it; that save must return.
     */
    expect(values('battle-creed', ['--raw'])).toMatch(/1 agree on every one/);
    const rel = 'work/.b033-stunt-advancement.ts';
    const text = readFileSync(join(CLI_ROOT, 'src/rules/advancement.ts'), 'utf8');
    const table = /\n {2}'?battle-creed'?:\s*\[([\s\S]*?)\n {2}\],/.exec(text)!;
    const patched = text.replace(table[0], table[0].replace(/\n[^\n]*track: 'will'[^\n]*master[^\n]*/g, ''));
    expect(patched).not.toBe(text);
    writeFileSync(join(CLI_ROOT, rel), patched);
    try {
      expect(values('battle-creed', ['--raw', '--advancement', rel]))
        .toMatch(/MISSING\s+save\|will\s+theirs=master\s+ours=\(nothing\)/);
    } finally {
      rmSync(join(CLI_ROOT, rel), { force: true });
    }
  }, 180_000);

  // batch 033: ligneous-instinct#instrument
  it('ligneous-instinct: a rage-gated Raging Resistance lives on whileActive, which the set collector skipped', () => {
    /*
     * Printed (AoN instinct-16, Ligneous — Raging Resistance): *"You resist piercing and slashing damage,
     * but you gain weakness to fire equal to 3 + your Constitution modifier"*. Raging Resistance is
     * state-gated by construction, so every instinct authors it as `whileActive [{state:'rage',
     * minLevel:9, resistances:[…], weaknesses:[…]}]`, read by ownedWhileActive/activeStateGrants in
     * derive.ts into the same IWR source list a flat field feeds. The SET collector read only the flat
     * fields, so all eight instincts that carry one reported `ours=(nothing)`.
     *
     * mutation-proof — stunts the taught carrier `whileActive[0].weaknesses`; the fire SET-GAP must
     * return while the resistances half, untouched, keeps matching.
     */
    expect(values('ligneous-instinct', ['--raw'])).toMatch(/1 agree on every one/);
    const out = stuntedCore('ligneous-whileactive', (c) => { delete c.classFeatures['ligneous-instinct'].whileActive[0].weaknesses; },
      (core) => values('ligneous-instinct', ['--raw', ...core]));
    expect(out).toMatch(/SET-GAP\s+set\|weaknesses\s+theirs=fire\s+ours=\(nothing\)/);
  }, 180_000);

  // batch 033: curse-of-the-mortal-warrior#instrument
  it('curse-of-the-mortal-warrior: a mode gated on the record carries the save penalty nobody read', () => {
    /*
     * Printed (AoN mystery-13, the Battle mystery's Curse of the Mortal Warrior): *"Cursebound 2 You take
     * a –1 status penalty to saving throws against spells."*, and at Cursebound 4 that *"status penalty to
     * saving throws against spells increases to –2"*. Ours authors that as
     * `modes['curse-of-the-mortal-warrior-2'..'-4'].modifiers`, gated `feats:['curse-of-the-mortal-warrior']`.
     * The modes loop already read a mode's resistances and weaknesses; its `modifiers` were read by
     * nobody, so six save rows reported MISSING against numbers we carry exactly.
     *
     * A `target:'save'` modifier is expanded into all three tracks because WG splits the one printed
     * sentence into SAVE_FORT / SAVE_REFLEX / SAVE_WILL — the same reasoning the item-shaped `pe.saves`
     * scalar already uses. Compared by MAGNITUDE, so a mode carrying the WRONG number still reports.
     *
     * mutation-proof — stunts the taught carrier `modifiers` on every cursebound mode of this curse; all
     * six rows must return.
     */
    expect(values('curse-of-the-mortal-warrior', ['--raw'])).toMatch(/1 agree on every one/);
    const out = stuntedCore('mortal-warrior-modes', (c) => {
      for (const [k, m] of Object.entries(c.modes ?? {}) as [string, Core][]) {
        if (k.startsWith('curse-of-the-mortal-warrior')) delete m.modifiers;
      }
    }, (core) => values('curse-of-the-mortal-warrior', ['--raw', ...core]));
    for (const track of ['fortitude', 'reflex', 'will']) {
      expect(out).toMatch(new RegExp(`MISSING\\s+save\\|${track}\\s+theirs=1\\s+ours=\\(nothing\\)`));
      expect(out).toMatch(new RegExp(`MISSING\\s+save\\|${track}\\s+theirs=2\\s+ours=\\(nothing\\)`));
    }
  }, 180_000);
});

describe('batch 033 instruments — the three settles, each scoped to what it actually answers', () => {
  // batch 033: decay-instinct#instrument-resistances
  it('decay-instinct: the settle answers ONE unnameable clause and still reports a deleted poison', () => {
    /*
     * Printed (AoN instinct-15, Decay — Raging Resistance): *"You resist poison damage, as well as damage
     * dealt by the attacks and abilities of creatures with the fungus trait, regardless of the damage
     * type."* We carry both entries on `whileActive`, with the same 3+Con value WG uses. The whileActive
     * teach made `poison` match; what is left is that a damage-SOURCE clause has no type NAME, so each
     * side invents a phrase — theirs the whole printed sentence, ours a short label with the sentence in
     * `note`, which is what the IWR breakdown prints to the player. There is no name to reconcile.
     *
     * mutation-proof — the settle names ONE member of the set rather than `set|resistances`. Stunt the
     * OTHER member: delete the POISON entry from decay-instinct's whileActive and run WITHOUT `--raw`,
     * i.e. with the settle live. It must still report. A whole-set settle here was measured to report
     * nothing at all in this exact case, which is the "silence the NEXT difference of that kind on that
     * record, unread" trap the registry's own header warns about.
     */
    expect(values('decay-instinct')).toMatch(/1 agree on every one/);
    const out = stuntedCore('decay-poison', (c) => {
      const wa = c.classFeatures['decay-instinct'].whileActive[0];
      wa.resistances = (wa.resistances as Core[]).filter((x) => x.type !== 'poison');
    }, (core) => values('decay-instinct', core));
    expect(out).toMatch(/SET-GAP\s+set\|resistances\s+theirs=poison\s/);
  }, 180_000);

  // batch 033: witness-to-ancient-battles#instrument
  it('witness-to-ancient-battles: the settle answers ONE spelling and still reports a deleted spell', () => {
    /*
     * Their tenth apparition spell keys as `weaponofjudgement`; ours is `weaponofjudgment`, which is how
     * AoN apparition-13 (four occurrences) and both spell records in the mirror print it. Adopting theirs
     * would move us AWAY from print, so the difference is settled rather than fixed.
     *
     * mutation-proof — the settle names ONE spell rather than the `spells` bucket. Stunt a DIFFERENT
     * member: delete `ghostly-weapon` from the option's grantedSpells and run WITHOUT `--raw`. It must
     * report, and `weaponofjudgement` must stay settled in the same output. A bucket-wide settle here was
     * measured to report nothing at all in this exact case.
     */
    expect(identity('witness-to-ancient-battles')).toMatch(/1 match on every one/);
    const out = stuntedCore('witness-drop', (c) => {
      const o = option(c, 'witness-to-ancient-battles');
      o.grantedSpells = (o.grantedSpells as string[]).filter((s) => s !== 'ghostly-weapon');
    }, (core) => identity('witness-to-ancient-battles', core));
    expect(out).toMatch(/spells\s+theirs-not-ours=\[ghostlyweapon\]/);
    expect(out).not.toMatch(/weaponofjudgement/);
  }, 180_000);

  // batch 033: school-of-thassilonian-rune-magic#instrument
  it('school-of-thassilonian-rune-magic: the settle is a bucket because the record is NEVER OWNED', () => {
    /*
     * Printed (AoN arcane-school-25): *"you must choose one of the seven sins to specialize in. You add
     * your sin's spells and initial school spells to your curriculum."* WG puts that seven-branch select
     * on the SCHOOL row. Ours puts it on `classFeatures/runelord` — otherTags ['class-archetype',
     * 'wizard-arcane-school'], the record the wizard Arcane School picker actually offers — whose
     * effectChoices 'sin' options grant the seven initial school spells at build.ts:4104-4127.
     *
     * This is the one settle here that is legitimately bucket-wide, and the reason is an OWNERSHIP fact
     * rather than a wording one: no reading of this record could ever deliver those spells, so no member
     * of its `spells` bucket is answerable. The stunt is therefore on the ownership claim itself.
     *
     * mutation-proof — stunts the settle's premise instead of a carrier, because the record HAS no
     * carrier: assert the id is an option of no class, and that the record the spells really hang on
     * (runelord) is a wizard subclass option that carries them. If either ever changes, the settle's
     * reason is gone and this fails.
     */
    const optionIds = (Object.values(CORE.classes ?? {}) as Core[]).flatMap((cls) => [
      ...((cls.subclass?.options ?? []) as Core[]).map((o) => o.id),
      ...((cls.extraChoices ?? []) as Core[]).flatMap((ec) => ((ec.options ?? []) as Core[]).map((o) => o.id)),
    ]);
    expect(optionIds).not.toContain('school-of-thassilonian-rune-magic');
    expect(CORE.classFeatures['school-of-thassilonian-rune-magic'].otherTags).toBeUndefined();
    expect(optionIds).toContain('runelord');
    expect(CORE.classFeatures.runelord.otherTags).toContain('wizard-arcane-school');
    const sin = (CORE.classFeatures.runelord.effectChoices as Core[]).find((c) => (c.id ?? c.flag) === 'sin')!;
    expect((sin.options as Core[]).flatMap((o) => o.grant?.focusSpells ?? [])).toContain('cutting-eye');
  }, 180_000);

  // batch 033: armor-innovation#instrument-control
  it('armor-innovation: the Power Suit / Subterfuge Suit picker is real, it is just not on the record', () => {
    /*
     * Printed (AoN innovation-1, Armor): *"Choose one of the sets of statistics on Table 2–2: Innovation
     * Armor Statistics for your innovation armor"*. Their `select from:CUSTOM` offers Power Suit /
     * Subterfuge Suit; ours is the same two-option PopupSelect titled "Armor base statistics", rendered
     * in the "Armor base" SubCard of src/builder/shared.tsx and answered into `build.inventorArmorStats`.
     * Every other option reader starts from a field on a record, so a pick whose whole state is a
     * BuildState field reads as offered by nobody — which is what OFF_RECORD_OPTIONS names, one picker at
     * a time, with 'path-to-perfection' as its precedent.
     *
     * Pinned against the real control rather than the map, so the entry cannot outlive the picker it
     * describes: if the two option values ever stop being rendered there, this fails.
     */
    const shared = readFileSync(join(CLI_ROOT, 'src/builder/shared.tsx'), 'utf8');
    expect(shared).toMatch(/title="Armor base statistics"/);
    expect(shared).toMatch(/value: 'power-suit', label: 'Power Suit'/);
    expect(shared).toMatch(/value: 'subterfuge-suit', label: 'Subterfuge Suit'/);
    expect(shared).toMatch(/inventorArmorStats: v as 'power-suit' \| 'subterfuge-suit'/);
    expect(identity('armor-innovation')).not.toMatch(/options\s+theirs-not-ours/);
  }, 180_000);
});

describe('batch 033 instruments — the comparers did not regress outside batch 033', () => {
  // batch 033: school-of-kalistrade
  it('school-of-kalistrade and its neighbours agree, and batch 031/032 records are untouched', () => {
    /*
     * Blast radius, measured rather than asserted. The option-carrier teaches moved batch 033 only:
     * wg-values went from 31 records to adjudicate to 2 and wg-identity from 28 unmatched to 5, while
     * both comparers' batch-031 and batch-032 output stayed byte-identical.
     *
     * The five records still reporting in batch 033 belong to other families or are real gaps
     * (light-mortar-innovation, armor-innovation's `items` half, otherworldly-protection, spore-order,
     * dragon-eidolon), which is what shows the teaches did not launder the packet.
     */
    expect(identity('school-of-kalistrade,school-of-rooted-wisdom,school-of-the-boundary,school-of-the-reclamation', ['--raw']))
      .toMatch(/checked 4 records that grant a NAMED thing; 4 match on every one/);
    expect(identity('spore-order', ['--raw'])).toMatch(/grants\s+theirs-not-ours=\[leaforder\]/);
  }, 180_000);
});
