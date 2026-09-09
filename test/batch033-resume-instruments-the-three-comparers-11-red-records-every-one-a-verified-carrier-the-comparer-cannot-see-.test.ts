/*
 * BATCH 033 (RESUME) — THE INSTRUMENT LANE, second pass: eleven red records, every one a carrier the
 * comparer could not see.
 *
 * The batch's first instrument pass fixed the OPTION-CARRIER blind spot (a class's option list credited
 * only to the feature the class DECLARES). What was left on the gate was the same shape one storey down:
 * a mechanic that ships, in a place no comparer reads —
 *
 *   · a MODE's `modifiers` array (both mode readers walked grantedStrikes / IWR / senses / speeds / size
 *     and neither walked the bucket that holds every plain number a mode applies),
 *   · the barbarian instincts' `RAGE_DAMAGE` tiers table in src/rules/derive.ts,
 *   · the whole advancement.ts table a SUBCLASS OPTION owns (its rows name the printed clause in
 *     `source`, never the subclass, so the `source` scan credited the doctrine with nothing),
 *
 * plus five records whose difference is real but is not a gap: their engine's own bookkeeping variable
 * (MAIN_DRUID_ORDER), a pick print does not offer (derived-value-not-a-pick), and a carrier that lives
 * on another record entirely.
 *
 * A teach or a settle is legitimate only while the comparer still reports the record whose carrier is
 * GONE. Every case below therefore runs the REAL comparer as a node child against a STUNTED copy of the
 * carrier — public/core.json through `--core`, or the TypeScript table through `--modes` /
 * `--advancement` / `--derive`, the anti-laundering hooks added to wg-diff.mjs in this pass for exactly
 * that reason — and checks the flag comes straight back.
 *
 * ⚠ `--raw` bypasses the settle registries. A TEACH is proved with it (so a pass cannot come from
 * something being quieted); a SETTLE is proved WITHOUT it, because the point of those cases is that the
 * settled run still reports every member the settle does not name.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content, build } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { effectiveUses } from '../src/rules/featUses';
import type { Character, ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

type Core = Record<string, any>;
const CORE: Core = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));

/* ------------------------------------------------------------------ running the comparers */

/**
 * wg-diff has no `--ids`: it is corpus-wide by construction (its denominators are the point). So it is
 * run to a file and indexed by record id, which also makes the WE-ONLY / AGREE bucket a record landed in
 * part of the assertion rather than something a grep has to infer.
 */
function diffRows(args: string[] = [], tag = 'base'): Map<string, Core> {
  const rel = `work/.b033r-diff-${tag}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...args]);
    const j: Core = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    const idx = new Map<string, Core>();
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) for (const r of j[bucket] as Core[]) idx.set(r.id, { ...r, bucket });
    return idx;
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const missingOf = (idx: Map<string, Core>, id: string): string[] => (idx.get(id)?.missing ?? []) as string[];
const ourKindsOf = (idx: Map<string, Core>, id: string): string[] => (idx.get(id)?.ourKinds ?? []) as string[];

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--verbose', ...extra]);
const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, '--verbose', ...extra]);

/** Run something against a copy of public/core.json with one carrier removed. */
function stuntedCore<T>(tag: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b033r-stunt-${tag}.json`;
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
 * …and against a copy of a TypeScript table with one carrier removed. Written as `.txt` so no tool in
 * the repo compiles or type-checks a deliberately broken table; the comparers read these files as TEXT.
 */
function stuntedSource<T>(tag: string, srcRel: string, flag: string, edit: (s: string) => string, run: (arg: string[]) => T): T {
  const rel = `work/.b033r-stunt-${tag}.txt`;
  const original = readFileSync(join(CLI_ROOT, srcRel), 'utf8');
  const stunted = edit(original);
  expect(stunted).not.toBe(original);                             // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), stunted);
  try {
    return run([flag, rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** The modes in core.json gated on a record — the bucket the oracle curses live in. */
const modesGatedOn = (core: Core, id: string): Core[] =>
  Object.values(core.modes ?? {}).filter((m: Core) => (m?.feats ?? []).some((f: string) => f === id || String(f).startsWith(`${id}:`))) as Core[];

/* ================================================================== *
 * TEACH — a mode's `modifiers`, which neither mode reader walked
 * ================================================================== */

describe('curse-of-creeping-ashes and curse-of-the-mortal-warrior — the oracle cursebound modes carry their numbers in `modifiers`', () => {
  // batch 033: curse-of-creeping-ashes#speed-penalty
  it('curse-of-creeping-ashes: the Cursebound attack and Speed penalties are credited, and reported without them', () => {
    /*
     * AoN mystery-20 (Ash), Cursebound 2: *"Swirling ash imposes a -2 circumstance penalty to ranged
     * attack rolls you make."*; Cursebound 4: *"You take a -10-foot status penalty to all your Speeds
     * as your limbs begin to crumble like ash."* Ours ships both on
     * modes/curse-of-creeping-ashes-2..4, gated `feats: ['curse-of-creeping-ashes']` — a bucket that
     * already reaches the sheet and that wg-diff's modes loop never read, so the record reported
     * missing=[weapon,speed] against carriers it has.
     *
     * mutation-proof — stunts the taught carrier `modifiers` on every mode gated on this record.
     */
    expect(missingOf(diffRows(['--raw'], 'ashes-shipped'), 'curse-of-creeping-ashes')).toEqual([]);
    const stunted = stuntedCore('ashes-modifiers', (c) => { for (const m of modesGatedOn(c, 'curse-of-creeping-ashes')) m.modifiers = []; },
      (core) => diffRows(['--raw', ...core], 'ashes-stunt'));
    expect(missingOf(stunted, 'curse-of-creeping-ashes').sort()).toEqual(['speed', 'weapon']);
  });

  // batch 033: curse-of-the-mortal-warrior#instrument
  it('curse-of-the-mortal-warrior: the save penalty is credited, and reported without it', () => {
    /*
     * AoN mystery-13 (Battle), section "Curse of the Mortal Warrior" — Cursebound 2: *"You take a -1
     * status penalty to saving throws against spells."*, Cursebound 4: *"Your status penalty to saving
     * throws against spells increases to -2."* (mystery-16 is Flames, a different curse: the record's
     * own aonParentId is mystery-13.) wg-values.mjs already reads exactly these modifiers by name —
     * wg-diff was the
     * only blind side, which is why this record failed KINDS on `save` while its VALUES row was clean.
     *
     * mutation-proof — stunts `modifiers` on the four curse-of-the-mortal-warrior modes.
     */
    expect(missingOf(diffRows(['--raw'], 'mortal-shipped'), 'curse-of-the-mortal-warrior')).toEqual([]);
    const stunted = stuntedCore('mortal-modifiers', (c) => { for (const m of modesGatedOn(c, 'curse-of-the-mortal-warrior')) m.modifiers = []; },
      (core) => diffRows(['--raw', ...core], 'mortal-stunt'));
    expect(missingOf(stunted, 'curse-of-the-mortal-warrior')).toEqual(['save']);
  });

  // batch 033: curse-of-creeping-ashes#speed-penalty
  it('curse-of-creeping-ashes: wg-values asserts the Speed penalty on the track the modifier names, and no other', () => {
    /*
     * The VALUES half. Their side splits the one printed sentence into SPEED / SPEED_FLY / SPEED_CLIMB /
     * SPEED_BURROW / SPEED_SWIM, so all five read `theirs=-10 ours=(nothing)`. The modifier carries no
     * `detail`, and src/rules/modes.ts:135 resolves a detail-less speed modifier as `land` — so when
     * this test was written the teach closed speed|land and the other four tracks KEPT REPORTING, and
     * that was asserted here so the row landing would be what closed them rather than this teach
     * quietly having done it.
     *
     * ⚠ THE ROW LANDED, in this same batch. resume-data-rows' row on modes/curse-of-creeping-ashes-4
     * .modifiers carries `detail: 'all'` — verbatim print, mystery-20 Cursebound 4 *"a −10-foot status
     * penalty to all your Speeds"* — so all five tracks are now answered and the four-track assertion
     * has done its job: it caught the moment the row arrived. Flipped to the closed state, which is
     * what the comment above promised would happen.
     *
     * mutation-proof — stunts the taught carrier: drop the target:'speed' modifier and speed|land goes
     * straight back to `ours=(nothing)`.
     */
    const shipped = values('curse-of-creeping-ashes', ['--raw']);
    // batch 033: curse-of-creeping-ashes#speed-penalty
    for (const track of ['land', 'fly', 'climb', 'burrow', 'swim']) expect(shipped).not.toMatch(new RegExp(`MISSING\\s+speed\\|${track}`));
    const out = stuntedCore('ashes-speed', (c) => {
      for (const m of modesGatedOn(c, 'curse-of-creeping-ashes')) m.modifiers = (m.modifiers ?? []).filter((mod: Core) => mod.target !== 'speed');
    }, (core) => values('curse-of-creeping-ashes', ['--raw', ...core]));
    expect(out).toMatch(/MISSING\s+speed\|land\s+theirs=-10\s+ours=\(nothing\)/);
  });
});

/* ================================================================== *
 * TEACH — the instincts' rage damage, read from the table that delivers it
 * ================================================================== */

describe('decay-instinct and ligneous-instinct — the additional damage from Rage lives in derive.ts, not on the record', () => {
  // batch 033: decay-instinct#rotting-rage-damage-scaling
  it('decay-instinct: RAGE_DAMAGE credits the weapon kind, and the record reports without it', () => {
    /*
     * Their `setValue RAGE_DAMAGE 6 / 10 / 18` named a variable this comparer had no kind for, so it
     * fell to the `unmapped` fallback. It is the same lane as MELEE_ATTACK_DAMAGE_BONUS — a damage
     * bonus on Strikes — and ours is `RAGE_DAMAGE` in src/rules/derive.ts:3651, keyed by the instinct
     * and carrying all three tiers, resolved by rageStrikeRider onto every melee/unarmed Strike.
     *
     * mutation-proof — stunts the taught carrier: rename the two instincts' keys in a copy of derive.ts
     * and both records go straight back to reporting, now as `weapon` rather than `unmapped`.
     */
    const shipped = diffRows(['--raw'], 'rage-shipped');
    expect(missingOf(shipped, 'decay-instinct')).toEqual([]);
    expect(ourKindsOf(shipped, 'decay-instinct')).toContain('weapon');
    const stunted = stuntedSource('rage-derive', 'src/rules/derive.ts', '--derive',
      (s) => s.replace(/'decay-instinct': \{ tiers:/, "'decay-instinct-STUNTED': { tiers:")
             .replace(/'ligneous-instinct': \{ tiers:/, "'ligneous-instinct-STUNTED': { tiers:"),
      (arg) => diffRows(['--raw', ...arg], 'rage-stunt'));
    expect(missingOf(stunted, 'decay-instinct')).toEqual(['weapon']);
    expect(missingOf(stunted, 'ligneous-instinct')).toEqual(['weapon']);
  });

  // batch 033: ligneous-instinct#wooden-rage-mode
  it('ligneous-instinct: the modes.ts catalogue half of the same teach credits the bark-plate Speed penalty', () => {
    /*
     * The mode CATALOGUE (src/rules/modes.ts) is the other home of the same blind spot: it is merged
     * into content at runtime and never lands in public/core.json, so the core.modes loop cannot see it
     * and it has its own source scan — which read grantedStrikes / IWR / senses / speeds / size and not
     * `modifiers`. cat-wooden-rage's *"reduce your Speed by 10 feet, as the bark plates covering your
     * body are a hinderance to mobility"* (AoN instinct-16, Ligneous — instinct-20 does not exist)
     * is `m(-10, 'untyped', 'speed')` and was credited to nobody.
     *
     * mutation-proof — stunts the taught carrier in a copy of modes.ts; the speed kind must disappear
     * from ourKinds, which is the only place it can be observed (their row asserts no Speed here, so
     * `missing` would not move either way and asserting on it would prove nothing).
     */
    expect(ourKindsOf(diffRows(['--raw'], 'wooden-shipped'), 'ligneous-instinct')).toContain('speed');
    const stunted = stuntedSource('wooden-modes', 'src/rules/modes.ts', '--modes',
      (s) => s.replace(/m\(-10, 'untyped', 'speed'\)/, "m(-10, 'untyped', 'STUNTED')"),
      (arg) => diffRows(['--raw', ...arg], 'wooden-stunt'));
    expect(ourKindsOf(stunted, 'ligneous-instinct')).not.toContain('speed');
  });
});

/* ================================================================== *
 * TEACH — the advancement table a subclass option OWNS
 * ================================================================== */

describe('battle-creed — the cleric doctrine owns a complete advancement table, keyed by the subclass', () => {
  // batch 033: battle-creed
  it('battle-creed: the whole chassis is credited from advancement.ts, and reported without it', () => {
    /*
     * advancement.ts is keyed `<classId>` AND `<subclassId>`, and a subclass key is a COMPLETE table
     * that REPLACES the class default (its own note at :688-697 names "warpriest, battle-creed"). Those
     * rows carry the printed CLAUSE in `source` ('initial-creed', 'lesser-creed', 'major-creed',
     * 'true-creed'), never the subclass id, so the `source` scan credited the doctrine with nothing and
     * the record reported seven missing kinds against a chassis that ships in full.
     *
     * mutation-proof — stunts the taught carrier: break the row shape inside the 'battle-creed' table
     * only (the table's own key and brackets are left alone, so the scan's bounds are unchanged) and
     * every kind the table delivers comes straight back.
     */
    const shipped = diffRows(['--raw'], 'creed-shipped');
    expect(missingOf(shipped, 'battle-creed')).toEqual(['choice']);        // `choice` is a SETTLE, below
    expect(ourKindsOf(shipped, 'battle-creed').sort())
      .toEqual(['ac', 'classDc', 'conditional', 'grantsRecord', 'perception', 'save', 'spellcasting', 'weapon']);
    const stunted = stuntedSource('creed-advancement', 'src/rules/advancement.ts', '--advancement',
      (s) => s.replace(/(\n {2}'battle-creed': \[)([\s\S]*?)(\n {2}\],)/, (_m, a, body, c) => a + String(body).replace(/\{ level:/g, '{ stunted:') + c),
      (arg) => diffRows(['--raw', ...arg], 'creed-stunt'));
    expect(missingOf(stunted, 'battle-creed').sort())
      .toEqual(['ac', 'choice', 'classDc', 'conditional', 'save', 'spellcasting', 'weapon']);
  });

  // batch 033: battle-creed#control
  it('battle-creed: the Select Deity Weapon settle answers `choice` and nothing else on the record', () => {
    /*
     * AoN doctrine-6, Lesser Creed: *"You gain expert proficiency with your deity's favored weapon"* —
     * the weapon is DERIVED from the deity already chosen, not picked, and build.ts:3784 writes it as a
     * per-weapon override over every entry of the deity's favoredWeapons (so even a multi-weapon deity
     * owes the player no pick). Their two `select from:ADJ_VALUE` ops are their own workaround for not
     * resolving it; the same reading is parked in work/experience-instrument-limits.json.
     *
     * mutation-proof — stunts the settle key "battle-creed" the only way a bucket settle can be stunted:
     * the settled run must still report every OTHER kind once its carrier is gone. Run without `--raw`,
     * so the settle is live throughout.
     */
    expect(missingOf(diffRows([], 'creed-settled'), 'battle-creed')).toEqual([]);
    const stunted = stuntedSource('creed-settle-scope', 'src/rules/advancement.ts', '--advancement',
      (s) => s.replace(/(\n {2}'battle-creed': \[)([\s\S]*?)(\n {2}\],)/, (_m, a, body, c) => a + String(body).replace(/\{ level:/g, '{ stunted:') + c),
      (arg) => diffRows([...arg], 'creed-settle-stunt'));
    const back = missingOf(stunted, 'battle-creed');
    expect(back).not.toContain('choice');                                  // settled, and stays settled
    expect(back.sort()).toEqual(['ac', 'classDc', 'conditional', 'save', 'spellcasting', 'weapon']);
  });
});

/* ================================================================== *
 * SETTLES — a difference that is real and is not a gap
 * ================================================================== */

describe('flame-order, spore-order and stone-order — MAIN_DRUID_ORDER is their engine writing down the subclass pick', () => {
  /*
   * `node scripts/wg-show.mjs "Flame Order" --raw`: the row's only unmatched operation is
   * `createValue MAIN_DRUID_ORDER = flame`, and its own three conditionals then read it back
   * (`IF MAIN_DRUID_ORDER EQUALS flame THEN adjValue SKILL_ACROBATICS T`, `… THEN giveSpell FOCUS`).
   * Ours IS the subclass pick, and the skill, focus spell and granted feat all agree. The order
   * anathema arrives separately as `injectText type=class-feature` (kind `note`), so settling
   * `specialStat` cannot hide it.
   */
  const ORDERS: Array<[string, string]> = [['flame-order', 'acrobatics'], ['stone-order', 'crafting'], ['spore-order', 'intimidation']];
  const druidOption = (core: Core, id: string): Core => (core.classes.druid.subclass.options as Core[]).find((o) => o.id === id)!;

  // batch 033: flame-order#instrument
  it('flame-order, stone-order and spore-order: the specialStat settle is scoped to the bookkeeping variable', () => {
    /*
     * mutation-proof — stunts the settle keys "flame-order", "stone-order" and "spore-order" by removing
     * the ORDER SKILL each option grants. Run WITHOUT `--raw`, so all three settles are live: a settle
     * that reached beyond `specialStat` would swallow the skill too, and each record must instead come
     * straight back reporting it.
     */
    expect(missingOf(diffRows([], 'orders-settled'), 'flame-order')).toEqual([]);
    const stunted = stuntedCore('order-skills', (c) => { for (const [id] of ORDERS) delete druidOption(c, id).grants.skills; },
      (core) => diffRows([...core], 'orders-stunt'));
    for (const [id] of ORDERS) expect(missingOf(stunted, id)).toContain('skill');
  });

  // batch 033: spore-order
  it('spore-order: the settle leaves the Leaf Order membership gap reporting on wg-identity', () => {
    /*
     * AoN druidic-order-13, Special: *"The spore order is a variant of the leaf order… you count as a
     * member of the leaf order"* — a membership lane we do not model, filed as an owner question. The
     * `specialStat` settle above must not touch it, and does not: it is a wg-diff KINDS settle and the
     * gap is a wg-identity `grants` row, still printed.
     */
    expect(identity('spore-order')).toMatch(/grants\s+theirs-not-ours=\[leaforder\]/);
  });
});

describe('school-of-thassilonian-rune-magic — the two sides put the sin pick on different records', () => {
  // batch 033: school-of-thassilonian-rune-magic#instrument
  it('school-of-thassilonian-rune-magic: the KINDS settle mirrors the identity one, and the record is never owned', () => {
    /*
     * AoN arcane-school-25: *"you must choose one of the seven sins to specialize in. You add your sin's
     * spells and initial school spells to your curriculum."* WG puts the seven-branch select on the
     * SCHOOL row; ours puts it on classFeatures/runelord, the record the wizard Arcane School picker
     * actually offers, whose effectChoices['sin'] options grant the seven initial school spells.
     * wg-identity settled this in the first pass; wg-diff's KINDS gate reads theyOnly and subtracts no
     * other comparer's settle, so the same reading has to be recorded here too.
     *
     * mutation-proof — the settle key "school-of-thassilonian-rune-magic" is stunted by removing the
     * settle itself (`--raw`), which must bring the `spell` row straight back; and the reading that
     * justifies it is asserted directly on the data: the record appears in NO class's subclass option
     * list, so it is never owned and no carrier on it could ever deliver those spells.
     */
    expect(missingOf(diffRows([], 'sin-settled'), 'school-of-thassilonian-rune-magic')).toEqual([]);
    expect(missingOf(diffRows(['--raw'], 'sin-raw'), 'school-of-thassilonian-rune-magic')).toEqual(['spell']);
    const owners = Object.values(CORE.classes as Record<string, Core>).flatMap((cls) => [
      ...((cls.subclass?.options ?? []) as Core[]),
      ...((cls.extraChoices ?? []) as Core[]).flatMap((ec: Core) => (ec.options ?? []) as Core[]),
    ]).map((o) => o.id);
    expect(owners).not.toContain('school-of-thassilonian-rune-magic');
    expect(owners).toContain('runelord');
  });
});

describe('otherworldly-protection — print derives both branches, so the selects ask a question we do not owe', () => {
  // batch 033: otherworldly-protection#sanctified-resistance
  it('otherworldly-protection: the choice/options settles leave the resistances themselves compared', () => {
    /*
     * AoN innovation-1: *"You gain resistance equal to 3 + half your level to void damage, or to vitality
     * damage if you have void healing (such as if you're a dhampir)"* and *"If you are sanctified … this
     * resistance applies to unholy damage (if you are sanctified holy) or holy damage (if you are
     * sanctified unholy)"*. Neither sentence asks the player anything — both read a fact already on the
     * sheet — so their two `select optionType=CUSTOM` blocks are the derived-value-not-a-pick shape.
     * Ours holds every outcome as a derived entry on the record's `resistances`, applied by this
     * batch's rows: unholy `whenCreatureTrait: 'holy'`, holy `whenCreatureTrait: 'unholy'`, and — since
     * resume-data-rows' row superseded the earlier, narrower one — the void-healing branch as a real
     * pair rather than a prose `condition`: void `whenVoidHealing: false` beside vitality
     * `whenVoidHealing: true`, which is why `vitality` is in the list below. That fifth entry is the
     * printed clause *"or to vitality damage if you have void healing"* becoming a mechanic; the
     * derive loops gate on `!= null`, so a dhampir reads vitality and nobody else does.
     *
     * mutation-proof — stunts the settle key "otherworldly-protection" by deleting the resistances the
     * settle does NOT cover. Run without `--raw`: the `defense` kind and the wg-values set must come
     * straight back, proving the two settles name only the shape of the question.
     */
    const rec = (CORE.classFeatures as Core)['otherworldly-protection'];
    // batch 033: otherworldly-protection#void-healing-swap
    expect((rec.resistances as Core[]).map((r) => r.type).sort()).toEqual(['holy', 'spirit', 'unholy', 'vitality', 'void']);
    expect(missingOf(diffRows([], 'otherworldly-settled'), 'otherworldly-protection')).toEqual([]);
    const stunted = stuntedCore('otherworldly-resist', (c) => { delete (c.classFeatures as Core)['otherworldly-protection'].resistances; },
      (core) => diffRows([...core], 'otherworldly-stunt'));
    expect(missingOf(stunted, 'otherworldly-protection')).toContain('defense');
    expect(stunted.get('otherworldly-protection')!.missing).not.toContain('choice');   // settled, and stays settled
  });

  // batch 033: otherworldly-protection#void-healing-swap
  it('otherworldly-protection: wg-identity still compares every other bucket on the record', () => {
    /*
     * The `options` settle is bucket-scoped by construction (SETTLED_IDENTITIES[id] is filtered per
     * bucket), and this asserts it: with the settle live the record is clean, and with `--raw` the five
     * option titles come straight back — so the comparison is alive and the settle is what answers it.
     */
    expect(identity('otherworldly-protection')).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);
    expect(identity('otherworldly-protection', ['--raw'])).toMatch(/options\s+theirs-not-ours=\[void, vitality, holysanctified, unholysanctified, unsanctified\]/);
  });
});

/* ================================================================== *
 * OFF-RECORD CARRIERS — the mechanic ships, from somewhere else entirely
 * ================================================================== */

describe('armor-innovation — the innovation suits are handed over by a hard-coded branch, not by `grantsItems`', () => {
  // batch 033: armor-innovation#suit-item
  it('armor-innovation: the settled items bucket is justified on a BUILT inventor, and the comparison is alive', () => {
    /*
     * AoN innovation-1: *"Choose one of the sets of statistics on Table 2-2: Innovation Armor Statistics
     * for your innovation armor."* wg-identity reads `rec.grantsItems` and classFeatures/armor-innovation
     * has none, so their two `giveItem` options read as granted by nobody. Ours grants exactly those two
     * at src/rules/build.ts:7688-7702 — the chosen suit pushed into grantedItems as a WORN item sourced
     * "Armor Innovation". It cannot ride a static `grantsItems`: WHICH suit is the player's pick.
     *
     * mutation-proof — the settle key "armor-innovation" is stunted two ways. (1) `--raw` removes the
     * settle and the items row must come straight back, so the comparison is alive. (2) The JUSTIFICATION
     * is stunted on a BUILT character: with items/power-suit removed from a content copy, the branch
     * grants nothing, which is the state in which this settle would be laundering a real gap.
     */
    expect(identity('armor-innovation')).toMatch(/1 match on every one/);
    expect(identity('armor-innovation', ['--raw'])).toMatch(/items\s+theirs-not-ours=\[powersuit, subterfugesuit\]/);

    const db = content();
    const state = {
      ...emptyBuild(), name: 't', level: 1, classId: 'inventor',
      ancestryId: Object.keys(db.ancestries)[0], backgroundId: Object.keys(db.backgrounds)[0],
      subclassId: 'armor-innovation', inventorArmorStats: 'power-suit',
    } as never;
    const inventor = (c: ContentDatabase): Character => buildCharacter(state, c);
    expect(inventor(db).inventory.some((i) => i.itemId === 'power-suit')).toBe(true);
    const stunted = { ...db, items: { ...db.items } } as ContentDatabase;
    delete (stunted.items as Record<string, unknown>)['power-suit'];
    expect(inventor(stunted).inventory.some((i) => i.itemId === 'power-suit')).toBe(false);
  });

  // batch 033: armor-innovation#instrument-control
  it('armor-innovation: wg-diff credits choice / grantsItem / conditional from the carriers that deliver them', () => {
    /*
     * Three kinds, three carriers, none on the record: the "Armor base statistics" PopupSelect at
     * src/builder/shared.tsx:3565-3579 (BuildState.inventorArmorStats), the item grant at build.ts:7688,
     * and inventorModificationOptions at build.ts:2755-2771, which filters the modification list by
     * `f.level <= maxTierLevel` and by the suit tag — their four gated ABILITY_BLOCK selects.
     *
     * mutation-proof — with `--raw` the settle registries are bypassed but OFF_RECORD_CARRIERS is not
     * (it credits our side rather than subtracting from theirs), so the assertion that bites is the
     * BUILT-character one above: the entry is only true while build.ts still hands the suit over.
     */
    expect(missingOf(diffRows([], 'armor-settled'), 'armor-innovation')).toEqual([]);
    expect(ourKindsOf(diffRows([], 'armor-kinds'), 'armor-innovation').sort()).toEqual(['choice', 'conditional', 'grantsItem']);
  });
});

describe('school-of-unified-magical-theory — the Drain Bonded Item retune is a second record, read by featUses', () => {
  // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
  it('school-of-unified-magical-theory: the variant record carries the retuned limit, and without it the generic one stands', () => {
    /*
     * AoN arcane-school-21: *"instead of using Drain Bonded Item only once per day, you can use it once
     * per day for each rank of spell you can cast"*. Ours is a SEPARATE record,
     * classFeatures/arcane-bond-school-of-unified-magical-theory (created this batch,
     * limitedUses.maxByLevel 1→10 by odd level), preferred over classFeatures/arcane-bond by the
     * `retunedBy` variant reader at src/rules/featUses.ts:56-63 — a carrier on another record plus a
     * code reader, neither of which wg-diff can see from the record being compared.
     *
     * mutation-proof — stunts the carrier the OFF_RECORD_CARRIERS entry names: delete the variant record
     * from a content copy and the reader must fall back to the generic once-per-day limit.
     */
    const db = content();
    const umt = build('wizard', 9, { subclassId: 'school-of-unified-magical-theory' } as never);
    const bond = { id: 'arcane-bond', ...(db.classFeatures['arcane-bond'] as Record<string, unknown>) } as never;
    expect(effectiveUses(umt, bond, db)?.max).toBe(5);              // 9th level → 5 ranks → 5 uses

    const stunted = { ...db, classFeatures: { ...db.classFeatures } } as ContentDatabase;
    delete (stunted.classFeatures as Record<string, unknown>)['arcane-bond-school-of-unified-magical-theory'];
    expect(effectiveUses(umt, bond, stunted)?.max).toBe(1);
  });

  // batch 033: school-of-unified-magical-theory#instrument-spells
  it('school-of-unified-magical-theory: the comparer credits conditional and choice, and the record is clean', () => {
    /*
     * The other two printed clauses of "No Curriculum" are both live pickers: BuildState.umtFeatId (the
     * bonus 1st-level wizard class feat, injected at build.ts:5080-5084) and the +1 spellbook slot
     * (`wizardSpellbookBudget(level, isUmtBook)`, Builder.tsx:407) — which is why `choice` is credited
     * from the carriers rather than settled away.
     */
    expect(missingOf(diffRows([], 'umt-settled'), 'school-of-unified-magical-theory')).toEqual([]);
    const feat = Object.values(content().feats).find((f) => f.id === 'reach-spell')!;
    const withFeat = build('wizard', 1, { subclassId: 'school-of-unified-magical-theory', umtFeatId: feat.id } as never);
    expect(withFeat.feats.some((f) => f.featId === feat.id)).toBe(true);
    expect(build('wizard', 1, { subclassId: 'school-of-unified-magical-theory' } as never).feats.some((f) => f.featId === feat.id)).toBe(false);
  });
});
