/*
 * BATCH 036 — CLOSER. The two things the gate demanded that no family owned.
 *
 *   1. EXPERIENCE — energy-resistant read NO-SHEET-EFFECT while the engine delivered the resistance
 *      perfectly well. The instrument, not the engine: the item lane of
 *      test/wg-experience.harness.test.tsx never answered an ITEM's own `effectChoices`, although
 *      answerOwnPicks() has answered a feat's picks since batch 5. An item's answer lives on the
 *      INVENTORY INSTANCE (play.ts:116), so every item whose payload sits BEHIND its pick read as
 *      doing nothing. The first `describe` below pins the premise the harness edit rests on, on a
 *      built character, from both sides: no answer, no resistance; answer recorded, resistance 5.
 *
 *   2. VALUES — `SENSES_PRECISE` was a variable nothing had ever compared. It is the exact twin of
 *      `SENSES_IMPRECISE`, which has sat in wg-values' NOT_A_SCALAR since batch 7, so the entry is a
 *      routing note and not a settle of anything. The second `describe` is its mutation-proof: the
 *      lane the note routes to (`senses`) is LIVE on this very record — wg-diff still reports
 *      spirit-walk as missing kind `sense` — and the report dies the moment a carrier lands.
 *
 * ⚠ wg-diff is run WITHOUT `--raw`: a run with it bypasses the settle registries, and then a record
 *   still being watched is indistinguishable from one that has been silenced.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import { characterSituationalIds } from '../src/rules/explain';
import { addInventoryItem, applyPlayState, initialPlay, updateInventoryItem } from '../src/rules/play';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
type Json = Record<string, any>;

/* ================================================================== *
 * 1. AN ITEM'S OWN PICK IS PART OF WEARING IT
 * ================================================================== */

describe('batch 036 closer — energy-resistant delivers its resistance off the inventory instance, which is what the experience harness now answers', () => {
  /** A level-20 fighter wearing the rune item itself, worn + equipped + invested, exactly as the
   *  harness's item lane hosts one — with the crafter's answer recorded on the INSTANCE or not. */
  const worn = (answer?: string) => {
    const db = content();
    const base = build('fighter', 20) as Character;
    let play = addInventoryItem(initialPlay(base, db), 'energy-resistant', { worn: true, equipped: true, invested: true });
    const inst = (play.inventory ?? []).find((i) => i.itemId === 'energy-resistant')?.instanceId;
    expect(inst).toBeTruthy();
    if (answer) play = updateInventoryItem(play, inst!, { effectChoices: { energy: answer } });
    return deriveDefenses(applyPlayState(base, play, db), db).resistances;
  };

  /*
   * Printed, AoN equipment-2788-2576: "You gain resistance 5 to acid, cold, electricity, or fire. The
   * crafter chooses the damage type when creating the rune." The payload is the ANSWER — an unanswered
   * card grants nothing at all, which is correct and is also why the harness's unanswered host read the
   * record as NO-SHEET-EFFECT for a lane that works.
   */
  // batch 036: energy-resistant
  it('items/energy-resistant grants nothing while the crafter question is unanswered', () => {
    expect(worn().some((r) => ['acid', 'cold', 'electricity', 'fire'].includes(r.type))).toBe(false);
  });

  /* …and the recorded answer is the whole effect. `acid` is the first option, which is the value the
   * harness now writes and the same energy WG's own row grants. */
  // batch 036: energy-resistant
  it('items/energy-resistant grants acid resistance 5 once the answer is on the instance', () => {
    expect(worn('acid').find((r) => r.type === 'acid')?.value).toBe(5);
  });

  /* The answer is READ, not assumed: a different energy type moves the resistance with it, so the
   * harness's first-option answer is an answer and not a constant baked into the lane. */
  // batch 036: energy-resistant
  it('items/energy-resistant follows the recorded energy type rather than a fixed one', () => {
    const res = worn('fire');
    expect(res.find((r) => r.type === 'fire')?.value).toBe(5);
    expect(res.some((r) => r.type === 'acid')).toBe(false);
  });
});

/* ================================================================== *
 * 2. SENSES_PRECISE IS A SENSE, AND THE SENSE LANE STILL REPORTS
 * ================================================================== */

/** wg-diff has no `--ids`: it is corpus-wide by construction, so it is run to a file and indexed. */
function diffRows(tag: string, coreRel = 'public/core.json'): Map<string, Json> {
  const out = `work/.b036c-diff-${tag}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', out, '--core', coreRel], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const j: Json = JSON.parse(readFileSync(join(CLI_ROOT, out), 'utf8'));
    const idx = new Map<string, Json>();
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) for (const r of (j[bucket] ?? []) as Json[]) idx.set(r.id, { ...r, bucket });
    return idx;
  } finally {
    rmSync(join(CLI_ROOT, out), { force: true });
  }
}

/** Run a comparer against a copy of public/core.json with one field written onto one record. */
function stuntedCore<T>(tag: string, mutate: (core: Json) => void, run: (coreRel: string) => T): T {
  const rel = `work/.b036c-stunt-${tag}.json`;
  const original = readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8');
  const copy: Json = JSON.parse(original);
  mutate(copy);
  expect(JSON.stringify(copy)).not.toBe(original);          // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(copy));
  try {
    return run(rel);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

describe('batch 036 closer — spirit-walk: SENSES_PRECISE is routed to the sense lane, and that lane still reports', () => {
  /*
   * AoN feat-7120 (Apparition Sense) prints the sense as a NAME plus a RANGE — "You have apparition
   * sight, an imprecise sense … within 30 feet of you" — and WG's playtest Spirit Walk row writes it as
   * `adjValue SENSES_PRECISE = "apparition sight, 30"`. There is no number on a track in that, which is
   * why the twin variable SENSES_IMPRECISE has been in NOT_A_SCALAR since batch 7. The read finding
   * spirit-walk#sense is on the owner's desk (WG's operation-bearing row is the PLAYTEST edition), so
   * nothing here settles the divergence — the entry only says which comparer owns the question.
   *
   * mutation-proof — stunts the `senses` carrier the NOT_A_SCALAR entry for SENSES_PRECISE routes to,
   * by WRITING one onto feats/spirit-walk in a core copy. A routing note that survives its lane going
   * silent is not a routing note, it is a suppression: if wg-diff stopped reporting `sense` for this
   * record with no carrier, or kept reporting it with one, the variable would be unwatched by every
   * comparer and the next real sense gap here would ship unread.
   */
  // batch 036 premise: feat-7120 "You have apparition sight, an imprecise sense that allows you to detect the presence of"
  it('feats/spirit-walk still reports a missing `sense` kind, and stops the moment a senses carrier lands', () => {
    expect(readFileSync(join(CLI_ROOT, 'scripts/wg-values.mjs'), 'utf8')).toContain('SENSES_PRECISE:');
    expect(diffRows('base').get('spirit-walk')?.missing).toContain('sense');

    const stunted = stuntedCore(
      'senses',
      (c) => { c.feats['spirit-walk'].senses = [{ name: 'apparition sight', acuity: 'precise', range: 30 }]; },
      (coreRel) => diffRows('senses', coreRel),
    );
    expect(stunted.get('spirit-walk')?.missing ?? []).not.toContain('sense');
  });
});

/* ================================================================== *
 * 3. THE OVERDRIVE SPEED LADDER READS AS ONE LINE, NOT TWO
 * ================================================================== */

describe('batch 036 closer — hyper-boosters states only what the sheet does not, and supersedes speed-boosters', () => {
  /** An armour-innovation inventor at the level Hyper Boosters is available, with the modifications
   *  this batch's `requiresModification` row makes the only legal pair. */
  const inventor = (mods: Record<string, string>) =>
    build('inventor', 7, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: mods,
    } as unknown as Partial<BuildState>);

  /*
   * AoN innovation-5: "which increases to a +20-foot status bonus when you're in Overdrive. If you're
   * legendary in Crafting, it instead increases to a +30-foot status bonus when you're in Overdrive."
   * The whileActive row this batch applied puts the +20 rung on the sheet, so the star may only carry
   * the rung with no carrier — the legendary one. A star that still said "+20 … replacing the base +10"
   * would be a second answer to a question the Speed row already answers.
   */
  // batch 036: hyper-boosters#overdrive
  it('classFeatures/hyper-boosters stars only the legendary rung, not the +20 the sheet applies', () => {
    const star = FEAT_SITUATIONAL['hyper-boosters']?.[0];
    expect(star?.when).toMatch(/legendary in Crafting/);
    expect(star?.bonus).toMatch(/\+30/);
    expect(`${star?.when} ${star?.bonus}`).not.toMatch(/replacing the base/);
  });

  /*
   * The two records print ONE number that grows, and batch 036 made them reachable together for the
   * first time (requiresModification = ["speed-boosters"]). Same lane, same reason, as
   * master-overdrive -> expert-overdrive: the lower rung's line is dropped only when the character
   * holds both, so the player reads one line rather than two that contradict each other.
   */
  // batch 036: hyper-boosters#prerequisite
  it('an inventor holding hyper-boosters drops the speed-boosters line', () => {
    const db = content();
    const ids = characterSituationalIds(inventor({ initial: 'speed-boosters', breakthrough: 'hyper-boosters' }), db);
    expect(ids).toContain('hyper-boosters');
    expect(ids).not.toContain('speed-boosters');
  });

  /* THE CONTROL for the pair rule above, and nothing more — re-aimed by the closer in the gate-red
   * round after the red group's gap E moved the Overdrive step off the star and onto the Speed row.
   * `characterSituationalIds` returns the ids a character OWNS, so this only ever proved that the
   * suppression at the `it(` above is a PAIR rule rather than a blanket deletion of speed-boosters;
   * its old title ("keeps its own Overdrive line") claimed a star that no longer exists, since
   * classFeatures/speed-boosters now carries the step as a `whileActive` row and has no
   * FEAT_SITUATIONAL entry at all. The Overdrive numbers themselves are pinned where they belong, on
   * derived Speed, in test/batch036-gap-inventor.test.ts ("a speed-boosters-only inventor walks +5,
   * and +10 with Overdrive on"). Do not fold this into that file: it is the control for THIS
   * suppression. */
  // batch 036: hyper-boosters#prerequisite
  it('a speed-boosters-only inventor still owns speed-boosters, so the drop above is a pair rule', () => {
    const db = content();
    expect(characterSituationalIds(inventor({ initial: 'speed-boosters' }), db)).toContain('speed-boosters');
  });
});

/* ================================================================== *
 * 4. THE LIVING RUNE'S CRAFTER CHOICE REACHES THE CHARACTER
 * ================================================================== */

describe('batch 036 closer — energy-resistant on a Living Rune answers the crafter question instead of guessing acid', () => {
  /** A Runescarred fighter carrying the rune on his own flesh, with the crafter's answer or without.
   *  `<runeId>:<choiceId>` is exactly the key EffectChoicesPicker writes for the new control on the
   *  Living Rune card (src/builder/shared.tsx), so this drives the lane the player drives. */
  const body = (runeId: string, answer?: string) =>
    deriveDefenses(
      build('fighter', 8, {
        featPicks: { '2:class:0': 'runescarred-dedication', '6:class:0': 'living-rune' },
        bodyRune: runeId,
        ...(answer ? { effectChoices: { [`${runeId}:energy`]: answer } } : {}),
      } as unknown as Partial<BuildState>),
      content(),
    ).resistances;

  /*
   * Printed, AoN equipment-2788-2576: "You gain resistance 5 to acid, cold, electricity, or fire. The
   * crafter chooses the damage type when creating the rune." A body rune sits on no inventory row, so
   * there was no host to carry the crafter's answer and no control to ask it — every Living Rune
   * Energy-Resistant in the app resisted ACID, the first option, whatever the player meant. The
   * fallback itself is kept deliberately (an etched rune always HAS a type); what changes is that an
   * answer now beats it.
   */
  // batch 036: energy-resistant
  it('runes/energy-resistant on the body follows the recorded energy type', () => {
    const res = body('energy-resistant', 'fire');
    expect(res.find((r) => r.type === 'fire')?.value).toBe(5);
    expect(res.some((r) => r.type === 'acid')).toBe(false);
  });

  /* The unanswered fallback is unchanged, so this is a wrong answer corrected and not a payload
   * switched on: without a pick the rune still grants the first option, which is what WG's own row
   * grants. */
  // batch 036: energy-resistant
  it('runes/energy-resistant on the body still falls back to the first option when unanswered', () => {
    expect(body('energy-resistant').find((r) => r.type === 'acid')?.value).toBe(5);
  });

  /* n is FOUR, not one: the greater rune and both energy-absorbing runes ask the same question off
   * their own item records, and one lane answers all four. */
  // batch 036: energy-resistant
  it('runes/energy-resistant-greater on the body follows the recorded energy type at resistance 10', () => {
    const res = body('energy-resistant-greater', 'cold');
    expect(res.find((r) => r.type === 'cold')?.value).toBe(10);
    expect(res.some((r) => r.type === 'acid')).toBe(false);
  });
});

/* ================================================================== *
 * 5. wg-values READS A `whileActive` SPEED, SO AN UPGRADE IS NOT A REGRESSION
 * ================================================================== */

/** wg-values is per-batch and fast (<1 s); its report is plain text, one `--- <id>` block per record
 *  with something left to adjudicate. A record that agrees on everything has no block at all. */
function valuesReport(batch: string, coreRel = 'public/core.json'): string {
  return execFileSync(
    process.execPath,
    [join(CLI_ROOT, 'scripts/wg-values.mjs'), '--batch', `work/wg-batch-${batch}.json`, '--core', coreRel],
    { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 },
  );
}
const adjudicated = (report: string, id: string) =>
  report.split(/\n(?=---)/).some((b) => b.startsWith(`--- ${id} `) || b.startsWith(`--- ${id}\n`));

describe('batch 036 closer — speed-boosters: wg-values reads the `whileActive` Speed the batch moved the Overdrive step onto', () => {
  /*
   * AoN innovation-5, Speed Boosters, verbatim: "which increases to a +10-foot status bonus when under
   * the effects of Overdrive." Their row writes that as one number, SPEED = 10. Ours held it as PROSE on
   * a FEAT_SITUATIONAL star until this batch, and situationalMagnitudes scrapes a star's numbers, so the
   * 10 matched by accident. Batch 036 moved the step onto classFeatures/speed-boosters.whileActive —
   * a real number deriveSpeeds ADDS — and retired the star, at which point the record read as a
   * DISAGREEMENT on a number we grant better than before, and the regate over batch 034 went red. The
   * harvester now reads `whileActive[].speeds` (the step) and, beside a `landSpeedBonus`, their total.
   *
   * mutation-proof — the stunt DELETES classFeatures/speed-boosters.whileActive from a core copy, which
   * is the only carrier of the Overdrive step now that the star is gone. If the comparer still said
   * "agree" with the carrier removed, this widening would be laundering a difference instead of reading
   * one, and the next real Speed gap on a state-gated record would ship unread.
   */
  // batch 036 premise: innovation-5 "which increases to a +10-foot status bonus when under the effects of Overdrive"
  it('classFeatures/speed-boosters agrees on speed|land, and disagrees again the moment its whileActive carrier is stunted', () => {
    expect(adjudicated(valuesReport('034'), 'speed-boosters')).toBe(false);

    const stunted = stuntedCore(
      'sb-whileactive',
      (c) => { delete c.classFeatures['speed-boosters'].whileActive; },
      (coreRel) => valuesReport('034', coreRel),
    );
    expect(adjudicated(stunted, 'speed-boosters')).toBe(true);
    expect(stunted).toContain('theirs=10');
  });
});
