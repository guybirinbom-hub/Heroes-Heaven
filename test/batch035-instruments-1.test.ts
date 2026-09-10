/*
 * BATCH 035 — THE INSTRUMENT LANE, CHUNK instruments-1 (WG-COMPARISON family).
 *
 * Eight findings, three shapes:
 *
 *   1. ONE SETTLE. `cultivation-order` — the ninth druid order, and the one the batch-034 note in
 *      scripts/wg-diff.mjs deliberately held back ("cultivation-order is NOT listed and still reports,
 *      which is what keeps this from becoming a rule that swallows an order whose grants were never
 *      checked"). Batch 035 checked the grants, so the `specialStat` entry is now owed.
 *
 *   2. ONE EXPERIENCE PARK. `the-oscillating-wave` — WG's granted-spell ladder is the LEGACY printing
 *      (conscious-mind-3) and ours is the remaster one (conscious-mind-9), so four of their giveSpells
 *      can never deliver. Parked in work/experience-instrument-limits.json, same lane as the-distant-
 *      grasp (b33) and the-infinite-eye (b34).
 *
 *   3. SIX HARNESS HOST MISSES, no code and no data. `wandering-reverie`, `gathered-lore`,
 *      `impostor-in-hidden-places`, `noble-branch`, `metallic-reactance`, `phlogistonic-regulator` all
 *      come back UNSUPPORTED with the reason "no class or subclass grants this feature at level 20",
 *      because classFeatureHost's owner search walks `cls.features` and `subclass.options` and nothing
 *      else. Four of the six are `extraChoices` options and two are inventor innovation modifications.
 *      The gate already records UNSUPPORTED without failing on it, so nothing is parked here — what is
 *      pinned instead is the CAUSE (the carrier each record really lives on) and, for the two whose
 *      claim is about a value reaching the sheet, the value itself on a BUILT character.
 *
 * ⚠ `--raw` is read exactly as in test/batch033-instruments.test.ts and test/batch034-instruments-1.ts:
 * a SETTLE is proved WITHOUT `--raw` for the quiet half and WITH it for the noisy half, because the
 * point is that the settled run still reports every member the settle does not name.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Two cases run wg-diff as a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content, build } from './_content';
import { deriveDefenses } from '../src/rules/derive';

const CLI_ROOT = join(__dirname, '..');
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));
const AON = 'C:/wonderers guide/aon-2e-archive/data/by-category';

type Core = Record<string, any>;

const tag = () => `${process.pid}-${Math.random().toString(36).slice(2)}`;

/** Run wg-diff against a copy of public/core.json with ONE carrier removed — batch 033's shape. */
function stuntedCore<T>(name: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b035i1-stunt-${name}-${tag()}.json`;
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

/** wg-diff has no `--ids`; `--out` is its only per-record view. id -> missing kinds, THEY-ONLY only. */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b035i1-diff-${tag()}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel, ...extra], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
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

/* ================================================================== *
 * SETTLE — cultivation-order, the ninth MAIN_DRUID_ORDER bookkeeping variable
 * ================================================================== */

describe('batch 035 instruments-1 — cultivation-order settles `specialStat` and nothing else', () => {
  /*
   * `node scripts/wg-show.mjs "Cultivation Order" --raw` leaves exactly one operation unmatched:
   * `createValue MAIN_DRUID_ORDER = "cultivation"`, type=str — which their own conditionals then read
   * straight back (`IF MAIN_DRUID_ORDER EQUALS cultivation THEN adjValue SKILL_CRAFTING {"value":"T"}`,
   * `… THEN giveSpell FOCUS`). Print makes the order a subclass, not a statistic, and ours is that
   * subclass: classes.druid.subclass.options['cultivation-order'] — grants.skills ['crafting'],
   * grantedFeats ['leshy-familiar'], focusSpells ['cornucopia'] — selected into `build.subclassId`.
   * Batch 033 settled the same single operation for flame/spore/stone and batch 034 for
   * animal/leaf/storm/untamed/wave; this is the ninth and last order.
   *
   * mutation-proof — the danger of a VERIFIED_EQUIVALENT key is that it is keyed by RECORD, so it could
   * quietly cover a real gap on the same record. The settle key stunted is 'cultivation-order' in
   * scripts/wg-diff.mjs's VERIFIED_EQUIVALENT: with the option's `grants`, `focusSpells` and
   * `grantedFeats` deleted the SETTLED run (no `--raw`) reports skill and spell straight back — and
   * still not `specialStat`, which is the one thing this entry is allowed to silence. The `--raw` run
   * on the SHIPPED data is the other half: it shows `specialStat` is present and that the registry is
   * what quiets it, not a change to the data.
   */
  // batch 035: cultivation-order#instrument
  it('cultivation-order is clear on the shipped data, and `--raw` shows the registry is what quiets it', () => {
    expect(theyOnly().has('cultivation-order')).toBe(false);
    expect(theyOnly(['--raw']).get('cultivation-order')).toEqual(['specialStat']);
  }, 240_000);

  // batch 035: cultivation-order#instrument
  it('with the cultivation-order option stunted, the record reports its real kinds again and never `specialStat`', () => {
    const stunted = stuntedCore('cultivation', (c) => {
      const o = option(c, 'cultivation-order');
      delete o.grants; delete o.focusSpells; delete o.grantedFeats;
    }, (core) => theyOnly(core));
    const missing: string[] = stunted.get('cultivation-order') ?? [];
    /* `skill` is their SKILL_CRAFTING adjValue, `spell` their order focus spell. `grantsRecord` is NOT
     * asserted, for the same reason batch 034 gave for the other five orders: an order's class feat is
     * also reachable off the option, so deleting `grantedFeats` alone does not take it away. */
    expect(missing).toEqual(expect.arrayContaining(['skill', 'spell']));
    expect(missing).not.toContain('specialStat');
  }, 240_000);

  // batch 035: cultivation-order#instrument
  it('the cultivation-order entry silences one kind only, so its two sibling findings still report', () => {
    /*
     * The record carries two other CONFIRMED findings and neither is in this registry's reach.
     * cultivation-order#anathema-sidebar is DESCRIPTION prose — wg-diff never compares it.
     * cultivation-order#leaf-membership is their `giveAbilityBlock "Leaf Order"`, judged by the
     * EXPERIENCE comparer, which reads no settle registry at all; the batch's own experience run still
     * reports it (NO-SHEET-EFFECT, 'giveAbilityBlock #34226 "Leaf Order"'). The entry names ONE kind,
     * which is the whole of its reach.
     */
    const src = readFileSync(join(CLI_ROOT, 'scripts/wg-diff.mjs'), 'utf8');
    expect(src).toContain("'cultivation-order': ['specialStat'],");
    /* The carrier the entry credits, all three halves — a settle for a dead field is a laundering. */
    const o = option(CORE, 'cultivation-order');
    expect(o.grants.skills).toEqual(['crafting']);
    expect(o.grantedFeats).toEqual(['leshy-familiar']);
    expect(o.focusSpells).toEqual(['cornucopia']);
  });
});

/* ================================================================== *
 * EXPERIENCE PARK — the-oscillating-wave, a LEGACY granted-spell ladder
 * ================================================================== */

describe('batch 035 instruments-1 — the-oscillating-wave: WG grants the legacy ladder, ours is the remaster one', () => {
  /*
   * The experience run reports NO-SHEET-EFFECT with five of fifteen ops undelivered: the
   * `giveAbilityBlock "Conservation of Energy"` (a REAL gap, owned by another family as
   * the-oscillating-wave#conservation-of-energy and fixed by a create row in this same batch) plus four
   * giveSpells — Heat Metal, Fire Shield, "Flame Vortex (legacy)" and Fiery Body. Those four are the
   * legacy printing's rungs, and adopting them would move us away from print.
   *
   * Their row is a HYBRID, which is what makes it look like a delivery gap rather than an edition
   * difference: the legacy rungs whose spell was merely RENAMED in the remaster (Burning Hands →
   * Breathe Fire, Cone of Cold → Howling Blizzard, Polar Ray → Arctic Rift, Meteor Swarm → Falling
   * Stars) picked the new name up and DO deliver; the four whose spell was REPLACED outright cannot.
   *
   * No settle registry is touched, so no mutation-proof marker is owed — an entry in
   * work/experience-instrument-limits.json is not one of the audited registries. What is owed is proof
   * that the PREMISE is real: the two mirror documents, and our record being the remaster one.
   */
  // batch 035: the-oscillating-wave#instrument
  it('the-oscillating-wave carries the remaster ladder from conscious-mind-9, rung for rung', () => {
    const cf = CORE.classFeatures['the-oscillating-wave'];
    expect(cf.aonId).toBe('conscious-mind-9');
    expect(cf.edition).toBe('remaster');
    /* The nine printed ranks, in order, followed by the two standard psi cantrips, the surface cantrip
     * and the two deeper/deepest ones — the whole of conscious-mind-9's Granted Spells block. */
    expect(option(CORE, 'the-oscillating-wave').grantedSpells).toEqual([
      'breathe-fire', 'blazing-bolt', 'fireball', 'ice-storm', 'howling-blizzard',
      'frozen-fog', 'volcanic-eruption', 'arctic-rift', 'falling-stars',
      'frostbite', 'ignition', 'thermal-stasis', 'entropic-wheel', 'redistribute-potential',
    ]);
    /* The two late rungs are ALSO a ladder on the conscious-mind record, which is what makes the 6th-
     * and 10th-level gates real rather than a level-1 dump. */
    expect(CORE.classFeatures['conscious-mind'].grantedSpells['the-oscillating-wave']).toEqual([
      { id: 'entropic-wheel', level: 6 }, { id: 'redistribute-potential', level: 10 },
    ]);
  });

  // batch 035: the-oscillating-wave#instrument
  it('the-oscillating-wave park names its lane and its scope, and does not cover the conservation-of-energy gap', () => {
    const limits = JSON.parse(readFileSync(join(CLI_ROOT, 'work/experience-instrument-limits.json'), 'utf8'));
    const e = limits.records['the-oscillating-wave'];
    expect(e).toMatchObject({ batch: 35, verdict: 'NO-SHEET-EFFECT', lane: 'wg-legacy-spell-name', class: 'INSTRUMENT' });
    expect(e._cite).toBe('// batch 035: the-oscillating-wave#instrument');
    /* The park is scoped in prose because the gate can only park a whole record: the entry must say so
     * out loud, or a reader takes it as covering the giveAbilityBlock too. */
    expect(e.refuter).toContain('conservation-of-energy');
    /* THE PREMISE, against the AoN mirror. Skipped only where the mirror is not mounted (CI), because a
     * missing mirror is no information — the same reading scripts/add-owner-question.mjs takes. */
    if (existsSync(join(AON, 'conscious-mind/conscious-mind-3.json'))) {
      const doc = (id: string) => JSON.parse(readFileSync(join(AON, 'conscious-mind', `${id}.json`), 'utf8'));
      const spells = (id: string) => {
        const t = String(doc(id).text ?? '').replace(/\s+/g, ' ');
        return t.slice(t.search(/Granted Spells/i), t.search(/Granted Spells/i) + 200);
      };
      expect(spells('conscious-mind-3')).toContain('2nd Heat Metal');
      expect(spells('conscious-mind-3')).toContain('4th Fire Shield');
      expect(spells('conscious-mind-3')).toContain('6th Flame Vortex');
      expect(spells('conscious-mind-3')).toContain('7th Fiery Body');
      expect(spells('conscious-mind-9')).toContain('2nd Blazing Bolt');
      expect(spells('conscious-mind-9')).toContain('4th Ice Storm');
      expect(spells('conscious-mind-9')).toContain('6th Frozen Fog');
      expect(spells('conscious-mind-9')).toContain('7th Volcanic Eruption');
      /* Each document names the other, so this is one record printed twice and not two records. */
      expect(doc('conscious-mind-3').remaster_id).toContain('conscious-mind-9');
      expect(doc('conscious-mind-9').legacy_id).toContain('conscious-mind-3');
    }
  });
});

/* ================================================================== *
 * HARNESS HOST MISS — six records the reference host cannot seat
 * ================================================================== */

describe('batch 035 instruments-1 — wandering-reverie, gathered-lore, impostor-in-hidden-places and noble-branch are extraChoices options', () => {
  /*
   * All four come back UNSUPPORTED with reason "no class or subclass grants this feature at level 20".
   * classFeatureHost (test/wg-experience.harness.test.tsx) resolves an owner by walking
   * `ownedAt20(db, classId, null)` and `db.classes[classId].subclass?.options` — an `extraChoices` group
   * is in neither, so a subconscious mind, an apparition and an ikon can never be judged. The gate
   * already records UNSUPPORTED without failing on it, so nothing is parked; the durable fix is a host
   * strategy in the harness, which is outside this chunk's files and is reported as a CROSS-FILE GAP.
   *
   * What is pinned here is the CAUSE, so the report's claim is falsifiable: each record is an
   * extraChoices option and is in no class's features and no subclass option, and the harness's owner
   * search really does look at neither. When the harness learns extraChoices this test fails — and the
   * right answer then is to delete the claim, not the assertion.
   */
  const EXTRA_CHOICE_HOSTED: Record<string, string> = {
    'wandering-reverie': 'psychic',
    'gathered-lore': 'psychic',
    'impostor-in-hidden-places': 'animist',
    'noble-branch': 'exemplar',
  };

  // batch 035: wandering-reverie#instrument
  it('wandering-reverie, gathered-lore, impostor-in-hidden-places and noble-branch live on extraChoices, and the host now looks there', () => {
    for (const [id, classId] of Object.entries(EXTRA_CHOICE_HOSTED)) {
      const seen: string[] = [];
      for (const [cid, cls] of Object.entries(CORE.classes) as [string, Core][]) {
        if ((cls.features ?? []).some((f: Core) => f.featureId === id)) seen.push(`features:${cid}`);
        for (const o of cls.subclass?.options ?? []) if (o.id === id) seen.push(`subclass:${cid}`);
        for (const ec of cls.extraChoices ?? []) for (const o of ec.options ?? []) if (o.id === id) seen.push(`extraChoices:${cid}`);
      }
      expect(seen).toEqual([`extraChoices:${classId}`]);
    }
    /* The comment above this block said: "When the harness learns extraChoices this test fails — and
     * the right answer then is to delete the claim, not the assertion." It learned, in this same
     * batch: the gap-instruments families gave classFeatureHost a third ownership route, so the four
     * records above are now seatable and play instead of reading UNSUPPORTED. The claim is retired and
     * replaced by its opposite, which is what now needs guarding — the route must not be removed
     * again while these records are still hosted there. The data half above is untouched. */
    // batch 035: wandering-reverie#instrument
    const harness = readFileSync(join(CLI_ROOT, 'test/wg-experience.harness.test.tsx'), 'utf8');
    /* Sliced to the REASON STRING, not to the bare sentence: the extraChoices route arrived with a
     * comment that quotes that sentence, so an indexOf on the sentence alone now stops before the
     * search body it was meant to bracket and the slice reads as empty. */
    const search = harness.slice(harness.indexOf('function classFeatureHost'), harness.indexOf("reason: 'no class or subclass grants this feature at level 20'"));
    expect(search).toContain('subclass?.options');
    expect(search).toContain('extraChoices');
  });

  // batch 035: gathered-lore
  it('gathered-lore and wandering-reverie deliver their key attribute on a BUILT psychic, which is what the host never got to see', () => {
    /*
     * Print (conscious/subconscious mind blocks): *"Key Attribute Your key attribute is Intelligence"*
     * for Gathered Lore, *"…Charisma"* for Wandering Reverie. `classes.psychic.keyAbility` is empty on
     * purpose — the subconscious mind answers it — and subclassKeyAbility (src/rules/build.ts:889-904)
     * walks `cls.extraChoices` to find it. That is WG's ATTRIBUTE_*, their CLASS_DC attribute and their
     * defineCastingSource attribute, all three at once.
     */
    const db = content();
    const group = ((db.classes.psychic as Core).extraChoices as Core[]).find((ec) => ec.id === 'subconscious-mind')!;
    expect(group.options.find((o: Core) => o.id === 'gathered-lore').keyAbility).toBe('int');
    expect(group.options.find((o: Core) => o.id === 'wandering-reverie').keyAbility).toBe('cha');
    const withPick = (id: string) => build('psychic', 20, { extraChoices: { 'subconscious-mind': [id] } });
    expect(withPick('gathered-lore').keyAbility).toBe('int');
    expect(withPick('wandering-reverie').keyAbility).toBe('cha');
  });
});

describe('batch 035 instruments-1 — metallic-reactance and phlogistonic-regulator are inventor innovation modifications', () => {
  /*
   * Both come back UNSUPPORTED for the same reason, one lane further out than the four above: an
   * armour innovation modification is not a class feature of any class, not a subclass option and not
   * an extraChoices option either. It is offered by inventorModificationOptions (src/rules/build.ts)
   * against `otherTags: ['armor-innovation-modification']` and stored on `c.inventor.modifications`,
   * which ownedFeatureIds (src/rules/derive.ts) admits and deriveDefenses then reads.
   *
   * The claim on both findings is that the RESISTANCES reach the sheet, so that is asserted on a built
   * character rather than on the harness — the strongest available answer to "the instrument says
   * UNSUPPORTED".
   */
  const inventor = (mod: string) =>
    build('inventor', 10, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: { initial: mod },
    } as never);
  const res = (mod: string, type: string) =>
    deriveDefenses(inventor(mod), content()).resistances.find((r) => r.type === type)?.value ?? 0;

  // batch 035: metallic-reactance#instrument
  it('metallic-reactance puts acid and electricity resistance on a built inventor', () => {
    /* Print (innovation-5, Metallic Reactance): *"You gain resistance equal to 3 + half your level to
     * acid and electricity damage."* At level 10 that is 3 + 5 = 8, and it is WG's two
     * `adjValue RESISTANCES = "acid|electricity, {{3+level/2}}"` ops exactly. */
    expect(CORE.classFeatures['metallic-reactance'].otherTags).toEqual(['armor-innovation-modification']);
    expect(res('metallic-reactance', 'acid')).toBe(8);
    expect(res('metallic-reactance', 'electricity')).toBe(8);
    /* …and it is the PICK that puts them there, not the class: the sibling modification gets neither. */
    expect(res('phlogistonic-regulator', 'acid')).toBe(0);
  });

  // batch 035: phlogistonic-regulator#instrument
  it('phlogistonic-regulator puts cold and fire resistance on a built inventor', () => {
    /*
     * Print (innovation-5, Phlogistonic Regulator): *"You gain resistance equal to half your level to
     * cold and fire damage."* Level 10 is chosen deliberately: the record's formula is under repair in
     * this same batch by phlogistonic-regulator#resistance-minimum (max(1,floor(level/2)) →
     * floor(level/2)), and the two agree at 5 — so this assertion is the state before AND after that
     * row and never a patched-vs-shipped delta.
     */
    expect(CORE.classFeatures['phlogistonic-regulator'].otherTags).toEqual(['armor-innovation-modification']);
    expect(res('phlogistonic-regulator', 'cold')).toBe(5);
    expect(res('phlogistonic-regulator', 'fire')).toBe(5);
    expect(res('metallic-reactance', 'cold')).toBe(0);
    /*
     * The four still recorded in work/experience-instrument-limits.json are recorded under the route
     * that blinded the harness. The entry changes NO verdict — the gate short-circuits UNSUPPORTED
     * before it consults the file (scripts/wg-batch-gate.mjs, the `unsupported.push(r.id); continue;`
     * branch) — so it is the family's ledger of WHY, not a pass. Pinned so the route is named the same
     * way for every record on it, and so a record can never be quietly re-parked under a verdict the
     * gate DOES read.
     *
     * THE TWO INNOVATION MODIFICATIONS ARE NO LONGER AMONG THEM. The gate-red group gave
     * classFeatureHost a FOURTH ownership route (test/wg-experience.harness.test.tsx,
     * `innovationModificationHost`) that seats a modification on `inventorModifications`, so both
     * records are now hosted and judged — OK, delivered by the differential, resistances and their
     * sources on the with build and none of it on the without. A park is removed the moment the
     * instrument can see the record, so the two entries are retired here and the retirement is pinned
     * below: a park that outlived its blindness is a gap in hiding.
     */
    const limits = JSON.parse(readFileSync(join(CLI_ROOT, 'work/experience-instrument-limits.json'), 'utf8'));
    const ROUTE: Record<string, string> = {
      'wandering-reverie': 'harness-host-search-no-extra-choice-route',
      'gathered-lore': 'harness-host-search-no-extra-choice-route',
      'impostor-in-hidden-places': 'harness-host-search-no-extra-choice-route',
      'noble-branch': 'harness-host-search-no-extra-choice-route',
    };
    // batch 035: metallic-reactance#instrument
    // batch 035: phlogistonic-regulator#instrument
    for (const id of ['metallic-reactance', 'phlogistonic-regulator']) {
      expect(limits.records[id], `${id} is still parked though the harness now hosts it`).toBeUndefined();
    }
    for (const [id, lane] of Object.entries(ROUTE)) {
      expect(limits.records[id]).toMatchObject({ batch: 35, verdict: 'UNSUPPORTED', lane, class: 'INSTRUMENT' });
    }
    const gate = readFileSync(join(CLI_ROOT, 'scripts/wg-batch-gate.mjs'), 'utf8');
    expect(gate).toContain("if (r.verdict === 'UNSUPPORTED') { unsupported.push(r.id); continue; }");
  });
});
