import { describe, it, expect } from 'vitest';
import { content } from './_content';

/**
 * Batch 037 engine lanes — the SCOPE half of swashbucklers-speed#typed-all-speeds.
 *
 * The mechanic itself is pinned in test/batch037-red-owner-ruled-engine-lanes.test.ts (typed bonuses
 * take the highest, untyped ones stack, "to your Speeds" reaches every Speed). This file pins the
 * other half of the ruling, the half a future well-meaning pass is most likely to undo: WHICH of the
 * twenty carriers may name a type at all. Owner ruling 2026-09-10 #127 is "follow print", and print
 * types seven of them; typing the rest would suppress bonuses the rules let a character stack.
 *
 * Every assertion here holds before AND after the driver applies work/.b037-rows-red-owner-ruled-
 * engine-lanes.json — those rows touch only the seven, and these are the other thirteen.
 */
const db = content();

describe('swashbucklers-speed lane scope: only a printed type gets typed', () => {
  /** Every record that carries a landSpeedBonus today, whichever bucket it lives in. */
  const carriers = () =>
    (['feats', 'classFeatures', 'heritages'] as const).flatMap((bucket) =>
      Object.entries(db[bucket] as Record<string, { landSpeedBonus?: unknown; speedBonusType?: unknown; description?: string }>)
        .filter(([, rec]) => rec.landSpeedBonus != null)
        .map(([id, rec]) => ({ bucket, id, rec })),
    );

  /* Fleet (feat-5150) and its ten siblings print "Your Speed increases by 5 feet" — no type, and
   * untyped modifiers stack. A type here would quietly delete feet the player is owed.
   *
   * ONE exception, and it is CHECKED rather than excluded: a clause that RAISES another record's bonus
   * inherits that bonus's type, so its own text never has to print one. feats/tillers-drive raises
   * feats/bellflower-dedication's +5 status bonus (feat-928, "You gain a +5-foot status bonus to your
   * Speed") to +10, and the two must carry the SAME type or the pair pays +15 where print pays +10 —
   * the over-grant this file's second case used to pin as an open number. */
  const RAISES_A_TYPED_SIBLING: Record<string, string> = { 'tillers-drive': 'bellflower-dedication' };
  // batch 037: swashbucklers-speed#typed-all-speeds
  // batch 037 premise: feat-932 "Your Speed bonus from Bellflower Dedication increases to +10 feet."
  it('a carrier whose printed clause never says "status bonus" carries no type, unless it raises one that does', () => {
    const wrong = carriers()
      .filter(({ id, rec }) => rec.speedBonusType != null && !/\bstatus bonus\b/i.test(rec.description ?? '') && !(id in RAISES_A_TYPED_SIBLING))
      .map(({ id }) => id);
    expect(wrong, 'typed without a printed type').toEqual([]);
    for (const [id, sibling] of Object.entries(RAISES_A_TYPED_SIBLING)) {
      expect(db.feats[sibling]?.description ?? '', sibling).toMatch(/\bstatus bonus\b/i);
      expect(db.feats[id]?.speedBonusType, `${id} must carry ${sibling}'s type`).toBe(db.feats[sibling]?.speedBonusType);
    }
  });

  /* Hyper Boosters stores the +5 over Speed Boosters' own +5, because print gives the PAIR a single
   * +10 status bonus rather than two: *"You gain a +10-foot status bonus to your Speed … You must
   * have the speed boosters modification"* (innovation-5). With the sibling typed and the delta
   * untyped the pair still totals the printed +10; typing the delta would make it take the highest
   * of the two halves and pay +5. The tidier encoding (one typed +10 total) is pinned at 5 by
   * test/batch034-data.test.ts:36, which belongs to another group.
   *
   * ⚠ VERIFIER CORRECTION (gate-red, 2026-09-11), CLOSED BY THE CLOSER: the same "the pair still
   * totals its printed bonus" claim was made here for TILLER'S DRIVE and it is FALSE. That record
   * carried BOTH `landSpeedBonus: 5` and `speeds: { land: 10 }`, read through different loops in
   * deriveSpeeds, so Bellflower Dedication + Tiller's Drive MEASURED base + 20 where feat-932 prints a
   * bonus that *"increases to +10 feet"*. It is no longer a delta carrier: work/.b037-rows-red-closer
   * .json deletes `speeds`, moves the whole printed bonus into `landSpeedBonus: 10` and types it
   * `status`, so the highest-per-type rule pays the printed +10 once. Hyper Boosters is now the ONLY
   * delta carrier left, and the reason it stays that way is one file over. */
  // batch 037 premise: feat-932 "Your Speed bonus from Bellflower Dedication increases to +10 feet."
  it('hyper-boosters is the one DELTA carrier left untyped, and tillers-drive is no longer one', () => {
    expect(db.classFeatures['hyper-boosters']?.speedBonusType, 'hyper-boosters').toBeUndefined();
    expect(db.classFeatures['hyper-boosters']?.landSpeedBonus, 'still the delta, not the total').toBe(5);
    expect(db.feats['tillers-drive']?.speedBonusType, 'tillers-drive carries the type it raises').toBe('status');
    expect(db.feats['tillers-drive']?.landSpeedBonus, 'the whole printed bonus, not a delta').toBe(10);
    expect(
      (db.feats['tillers-drive'] as { speeds?: { land?: number } }).speeds?.land,
      'the SECOND carrier that made the pair over-grant is gone',
    ).toBeUndefined();
  });

  // batch 037: swashbucklers-speed#typed-all-speeds
  it('only the clause that prints the PLURAL raises every Speed', () => {
    /* "to your Speeds" (feat-6238) is the one plural in the whole carrier set; every other clause says
     * "your Speed". A second `speedBonusAllSpeeds` would have to quote its own plural. */
    const plural = carriers().filter(({ rec }) => (rec as { speedBonusAllSpeeds?: unknown }).speedBonusAllSpeeds);
    for (const { id, rec } of plural) {
      expect(rec.description ?? '', id).toMatch(/to your Speeds/i);
    }
    expect(plural.length, 'at most the one record print gives it to').toBeLessThanOrEqual(1);
  });
});
