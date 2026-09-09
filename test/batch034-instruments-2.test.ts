/*
 * BATCH 034 — INSTRUMENTS, CHUNK 2. Three carriers a comparer could not see, and one WG row that is a
 * pre-remaster printing.
 *
 * Every case below runs the REAL comparer as a node child against a STUNTED copy of public/core.json
 * (through `--core`, the anti-laundering hook the batch-33 instrument pass added for exactly this) and
 * checks the flag comes straight back. A teach that survives the carrier being deleted is a teach that
 * launders; a settle whose record stops being watched by every comparer is a settle that hides a gap.
 *
 * ⚠ `--raw` bypasses the settle registries. A TEACH is proved with it, so a pass cannot come from
 * something else being quieted; a SETTLE is proved WITHOUT it, because the point of that case is what
 * the settled run still reports.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { content } from './_content';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

type Core = Record<string, any>;
const CORE: Core = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--verbose', ...extra]);
const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, '--verbose', ...extra]);

/** wg-diff has no `--ids`: it is corpus-wide by construction, so it is run to a file and indexed. */
function diffRows(args: string[] = [], tag = 'base'): Map<string, Core> {
  const rel = `work/.b034i2-diff-${tag}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...args]);
    const j: Core = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    const idx = new Map<string, Core>();
    // Two rows can share an id across buckets (Inspired Stratagem is level 1 AND level 8): key both.
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) {
      for (const r of j[bucket] as Core[]) idx.set(`${r.id}@${r.level}`, { ...r, bucket });
    }
    return idx;
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** Run something against a copy of public/core.json with one carrier removed. */
function stuntedCore<T>(tag: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b034i2-stunt-${tag}.json`;
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

/* ================================================================== *
 * TEACH — Raging Resistance carried inside the CHOSEN option's `grant.whileActive`
 * ================================================================== */

describe('giant-instinct — Raging Resistance lives one storey down, in the picked option\'s `grant.whileActive`', () => {
  // batch 034: giant-instinct#instrument
  it('giant-instinct: wg-values credits the whole printed resistance set, and reports it without the clause', () => {
    /*
     * AoN instinct-3, Raging Resistance: *"You resist bludgeoning damage and your choice of cold,
     * electricity, or fire, chosen when you gain raging resistance."* The clause is state-gated (it
     * applies only while raging) AND chosen, so it can only live inside the option:
     * `choice.options[].grant.whileActive[{state:'rage', minLevel:9, resistances:[bludgeoning, <picked>]}]`,
     * resolved by src/rules/build.ts:6312-6320 (the answered option's `grant` -> applyAlwaysOn, for a
     * chosen subclass as well as an owned feature). The set collector read the flat `rec.whileActive`
     * and an option's `grant` / `grant.passive`, and stopped exactly one level short of this one — so
     * the record reported `SET-GAP … ours=(nothing)` against WG's four rage-gated
     * `adjValue RESISTANCES = "bludgeoning|cold|electricity|fire, {{3+attribute_con}}"` rows.
     *
     * mutation-proof — stunts the taught carrier `grant.whileActive` on every option of this record's
     * choice, and the SET-GAP with `ours=(nothing)` comes straight back.
     */
    expect(values('giant-instinct', ['--raw'])).not.toMatch(/SET-GAP\s+set\|resistances/);
    const out = stuntedCore('giant-whileactive-values',
      (c) => { for (const o of c.classFeatures['giant-instinct'].choice.options) delete o.grant.whileActive; },
      (core) => values('giant-instinct', ['--raw', ...core]));
    expect(out).toMatch(/SET-GAP\s+set\|resistances\s+theirs=bludgeoning,cold,electricity,fire\s+ours=\(nothing\)/);
  });

  // batch 034: giant-instinct#instrument
  it('giant-instinct: wg-diff credits `defense` from the same clause, and reports it missing without', () => {
    /*
     * The KINDS half of the same blind spot. `fieldToKinds` maps the bare key `whileActive` to
     * `conditional` and never descends into it, so an option whose grant is state-gated contributed the
     * gating and nothing gated — `missing=[defense]` on a record that delivers the printed resistance
     * at the printed value.
     *
     * mutation-proof — stunts `grant.whileActive` on the choice options and `defense` returns.
     */
    expect(diffRows(['--raw'], 'giant-shipped').get('giant-instinct@1')?.missing).toEqual([]);
    const stunted = stuntedCore('giant-whileactive-diff',
      (c) => { for (const o of c.classFeatures['giant-instinct'].choice.options) delete o.grant.whileActive; },
      (core) => diffRows(['--raw', ...core], 'giant-stunt'));
    expect(stunted.get('giant-instinct@1')?.missing).toContain('defense');
  });
});

/* ================================================================== *
 * SETTLE — a homonym mispair across buckets, and what still guards the real grant
 * ================================================================== */

describe('inspired-stratagem — the level-1 class-feature stub is paired with WG\'s level-8 feat row', () => {
  // batch 034: inspired-stratagem#instrument
  it('inspired-stratagem: the settled level-1 row clears while wg-identity keeps guarding the real grant', () => {
    /*
     * WG holds three rows of this name: 19732 (level 1) with NO operations — the reaction itself — and
     * 20263 / 58198, each a single `giveAbilityBlock -> 19732`. WG_PAIRING's `classFeatures` bucket
     * accepts types ['class-feature','feat'] and wgRowsByBucket keeps the RICHEST row per name, so the
     * level-8 feat row displaces the empty level-1 one and its grant is demanded of
     * `classFeatures/inspired-stratagem` — our level-1 copy of the same aonId (feat-4952) that no class
     * table references and that carries nothing but `actionCost: 'reaction'`. Print (AoN feat-4952):
     * *"Later, you can quickly advise them on your schemes using the below reaction."*
     *
     * The grant is modelled where their level-8 row belongs: `feats/inspired-stratagem` carries
     * `grantsActions: ['inspired-stratagem']` (build.ts:6201 -> chosenActionIds, MainTab.tsx:310-316).
     *
     * mutation-proof — `VERIFIED_EQUIVALENT` is keyed by record id, so the settle blankets the level-8
     * row too and stunting `grantsActions` leaves BOTH wg-diff rows in AGREE. That is measured here
     * rather than assumed, together with the comparer that DOES still report it: wg-identity's `grants`
     * lane prints `theirs-not-ours=[inspiredstratagem]` the moment the grant is gone.
     */
    const shipped = diffRows([], 'inspired-shipped');
    expect(shipped.get('inspired-stratagem@1')?.missing).toEqual([]);
    expect(shipped.get('inspired-stratagem@8')?.ourKinds).toContain('grantsRecord');
    expect(identity('inspired-stratagem')).not.toMatch(/theirs-not-ours=\[inspiredstratagem\]/);

    const stunt = (c: Core) => { delete c.feats['inspired-stratagem'].grantsActions; };
    // The settle really is blanket — recorded so a later reader does not have to rediscover it.
    const blanketed = stuntedCore('inspired-blanket', stunt, (core) => diffRows(core, 'inspired-stunt'));
    expect(blanketed.get('inspired-stratagem@8')?.bucket).toBe('agree');
    // …and this is the guard that survives it.
    const guarded = stuntedCore('inspired-identity', stunt, (core) => identity('inspired-stratagem', core));
    expect(guarded).toMatch(/grants\s+theirs-not-ours=\[inspiredstratagem\]/);
  });
});

/* ================================================================== *
 * PARK — WG's 3rd-rank op is the pre-remaster printing; print gives Locate
 * ================================================================== */

describe('the-infinite-eye — WG grants the LEGACY Organsight where the remaster print grants Locate', () => {
  // batch 034: the-infinite-eye#organsight
  it('the-infinite-eye: the psychic conscious mind grants Locate at 3rd rank, and the park names only that op', () => {
    /*
     * The AoN mirror holds two "The Infinite Eye" documents: conscious-mind-2 (Dark Archive, legacy)
     * prints *"- 3rd Organsight"* and conscious-mind-8 (Dark Archives Remastered) prints
     * *"- 3rd Locate"*. Ours IS the remaster record (edition 'remaster', aonId conscious-mind-8), so the
     * lone undelivered `giveSpell "Organsight"` behind the batch's NO-SHEET-EFFECT is WG carrying the
     * pre-remaster ladder, not a slot we left empty. Adopting theirs would move us away from print.
     *
     * ⚠ Organsight EXISTS in our spell corpus — it is simply not what this conscious mind grants — so
     * "we do not carry that spell" could never have been the teach, and the record is parked one by one
     * in work/experience-instrument-limits.json rather than a rule being written that would launder
     * every genuinely undelivered giveSpell.
     *
     * mutation-proof — the parked claim is that the 3rd-rank slot is FILLED. Strip `locate` from the
     * option's grantedSpells on a content copy and the built psychic can no longer reach it, so the
     * park is standing on a carrier and not on a wish.
     */
    const db = content();
    const opt = (db.classes.psychic.subclass!.options as Core[]).find((o) => o.id === 'the-infinite-eye')!;
    expect(opt.grantedSpells).toContain('locate');
    expect(opt.grantedSpells).not.toContain('organsight');
    expect(db.spells['organsight']).toBeTruthy();                  // ours-lacks-the-spell was never the reason

    const limits = JSON.parse(readFileSync(join(CLI_ROOT, 'work/experience-instrument-limits.json'), 'utf8'));
    const park = limits.records['the-infinite-eye'];
    expect(park.lane).toBe('wg-legacy-spell-name');
    expect(park.verdict).toBe('NO-SHEET-EFFECT');

    const reach = (spells: string[]) => {
      const copy: Core = JSON.parse(JSON.stringify(db.classes.psychic));
      (copy.subclass.options as Core[]).find((o) => o.id === 'the-infinite-eye')!.grantedSpells = spells;
      const patched = { ...db, classes: { ...db.classes, psychic: copy } } as typeof db;
      const ch = buildCharacter(
        { ...emptyBuild(), name: 't', level: 20, classId: 'psychic', ancestryId: Object.keys(db.ancestries)[0], backgroundId: Object.keys(db.backgrounds)[0], keyAbility: null, subclassId: 'the-infinite-eye' },
        patched,
      );
      return JSON.stringify(ch.spellcasting).includes('"locate"');
    };
    expect(reach(opt.grantedSpells as string[])).toBe(true);
    expect(reach((opt.grantedSpells as string[]).filter((s) => s !== 'locate'))).toBe(false);
  });
});
