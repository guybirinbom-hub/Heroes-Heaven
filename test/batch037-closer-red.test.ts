import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 037 — THE CLOSER's own two lanes, both handed up as CROSS-FILE GAPS by
 * work/.b037-verify-red-owner-ruled-engine-lanes.txt after the gate-red round built the typed-Speed
 * engine, and neither of them buildable inside the group that found them.
 *
 *  1. src/rules/explain.ts — the Speed breakdown summed every carrier's `landSpeedBonus` itself while
 *     deriveSpeeds had just learned to take the HIGHEST of two bonuses sharing a type. The surplus came
 *     out of the block below as "Armor Speed penalty — heavy armor or unmet Strength" on a character
 *     wearing no armour at all: measured parts [Ancestry 25, +5, +10, −5] under a correct total of 35.
 *  2. feats/tillers-drive — the only record in the database carrying BOTH `landSpeedBonus` and
 *     `speeds.land`, so the one bonus feat-932 raises was paid twice over.
 *
 * Every assertion below runs against an IN-MEMORY patched or stripped copy of the database, never a
 * patched-vs-shipped delta, so nothing here flips the day work/.b037-rows-red-closer.json is applied.
 */
const db = content();

/** A built fighter (human base Speed 25) holding feats by id — the same shape the speed lanes use. */
const withFeats = (featIds: string[], level = 10): Character => {
  const base = build('fighter', level, { ancestryId: 'human' });
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b37c:${i}` }))],
  } as unknown as Character;
};

const patchFeats = (recs: Record<string, Record<string, unknown>>): ContentDatabase =>
  ({
    ...db,
    feats: Object.fromEntries([
      ...Object.entries(db.feats),
      ...Object.entries(recs).map(([id, over]) => [id, { ...db.feats[id], ...over }]),
    ]),
  }) as ContentDatabase;

describe('swashbucklers-speed: the Speed breakdown agrees with the Speed it suppresses', () => {
  /* Two STATUS bonuses on one character. feat-6238 prints Swashbuckler's Speed as "a +5-foot status
   * bonus to your Speeds" and feat-6398 prints Scout's Speed as a +10-foot status bonus, so
   * deriveSpeeds pays the highest — 25 + 10 = 35 — and the +5 is legitimately suppressed. */
  const typed = patchFeats({
    'swashbucklers-speed': { landSpeedBonus: 5, speedBonusType: 'status', speedBonusAllSpeeds: true },
    'scouts-speed': { landSpeedBonus: 10, speedBonusType: 'status' },
  });
  const ch = withFeats(['swashbucklers-speed', 'scouts-speed']);

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('pays the printed 35 feet, once', () => {
    expect(deriveSpeeds(ch, typed).land).toBe(35);
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('does not blame armour the character is not wearing', () => {
    const parts = explainStat(ch, typed, { kind: 'speed' }).parts;
    expect(parts.some((p) => p.label === 'Armor Speed penalty')).toBe(false);
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('still sums to the Speed on the sheet, and names what suppressed the smaller bonus', () => {
    const b = explainStat(ch, typed, { kind: 'speed' });
    expect(b.parts.reduce((n, p) => n + p.value, 0)).toBe(35);
    const suppressed = b.parts.find((p) => /does not stack with/.test(p.note ?? ''));
    expect(suppressed?.value).toBe(0);
    expect(suppressed?.note).toContain(db.feats['scouts-speed'].name);
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('leaves an UNTYPED bonus alone — Fleet still stacks, and still shows its own part', () => {
    const withFleet = withFeats(['swashbucklers-speed', 'scouts-speed', 'fleet']);
    expect(deriveSpeeds(withFleet, typed).land).toBe(40);
    const b = explainStat(withFleet, typed, { kind: 'speed' });
    expect(b.parts.reduce((n, p) => n + p.value, 0)).toBe(40);
    expect(b.parts.some((p) => p.note === db.feats['fleet'].name && p.value === 5)).toBe(true);
  });
});

describe('tillers-drive raises one Speed bonus instead of granting a second', () => {
  /* AoN feat-932 prints the WHOLE clause: "Your Speed bonus from Bellflower Dedication increases to
   * +10 feet." feat-928 gives that bonus its type ("You gain a +5-foot status bonus to your Speed"). */
  const tiller = withFeats(['bellflower-dedication', 'tillers-drive']);
  const BELL = { landSpeedBonus: 5, speedBonusType: 'status' };

  // batch 037 premise: feat-932 "Your Speed bonus from Bellflower Dedication increases to +10 feet."
  it('was over-granting 10 feet while it carried both a raise-to and a bonus', () => {
    const shipped = patchFeats({
      'bellflower-dedication': BELL,
      'tillers-drive': { landSpeedBonus: 5, speeds: { land: 10 }, speedBonusType: undefined },
    });
    expect(deriveSpeeds(tiller, shipped).land).toBe(45);
  });

  // batch 037 premise: feat-932 "Your Speed bonus from Bellflower Dedication increases to +10 feet."
  it('pays the printed +10 once the whole bonus is typed and the raise-to field is gone', () => {
    const fixed = patchFeats({
      'bellflower-dedication': BELL,
      'tillers-drive': { landSpeedBonus: 10, speeds: undefined, speedBonusType: 'status' },
    });
    expect(deriveSpeeds(tiller, fixed).land).toBe(35);
    // …and a tiller who has not taken Tiller's Drive still gets Bellflower's printed +5.
    expect(deriveSpeeds(withFeats(['bellflower-dedication']), fixed).land).toBe(30);
  });
});

/**
 * The committed-batch guard in scripts/wg-batch-close.mjs asks HISTORY, not the working tree.
 *
 * Its refusal says "a closed batch's artefacts are history", and it used to decide that with
 * `existsSync`. The two answers diverged the moment the gate-red round taught the guard to write the
 * missing pair for a batch committed without it: from then on work/wg-batch-037-parity.json was ON
 * DISK and still not in f1da70a, and the next close refused — which also skipped the two things
 * scripts/wg-batch-run.mjs stageClose does afterwards, the went-quiet diff and the trust-ledger
 * regeneration, leaving the ledger stamped with a stale core.json and --stage verify red.
 *
 * The assertion is derived from git rather than hard-coded, so it stays true after this batch is
 * committed (both answers agree again) and still fails today under the old `existsSync` reading, where
 * batch 037's pair is on disk, is not in HEAD, and would wrongly refuse.
 */
describe('wg-batch-close: the closed-batch refusal follows history, not the working tree', () => {
  const inHistory = (rel: string) => {
    try { execFileSync('git', ['show', `HEAD:${rel}`], { stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; }
  };
  const dryRun = (batch: string) => {
    try {
      return execFileSync(process.execPath, ['scripts/wg-batch-close.mjs', '--batch', batch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? '');
    }
  };

  for (const batch of ['029', '037']) {
    it(`batch ${batch}: --write refuses exactly when the parity/residual pair is in HEAD`, () => {
      const out = dryRun(batch);
      expect(out).toContain('is already committed');
      const history = inHistory(`work/wg-batch-${batch}-parity.json`) || inHistory(`work/wg-batch-${batch}-residual.json`);
      expect(/--write would refuse/.test(out), out.slice(-400)).toBe(history);
    }, 120_000);
  }
});
