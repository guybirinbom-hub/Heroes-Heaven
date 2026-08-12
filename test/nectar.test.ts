import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';

/**
 * Caustic Nectar grants "a nectar ranged unarmed attack" and the app had no such Strike, so Potent
 * Nectar — whose entire content is adding damage to it — had nothing to attach to.
 */
const db = content();
const nectar = (ch: ReturnType<typeof build>) => deriveStrikes(ch, db).find((s) => /nectar/i.test(s.name));

const withFeats = (picks: Record<string, string>, effectChoices?: Record<string, string>) =>
  build('fighter', 18, { featPicks: picks, ...(effectChoices ? { effectChoices } : {}) } as never);

describe('Caustic Nectar', () => {
  it('grants a ranged unarmed Strike at 1d4 acid with a 20-foot increment', () => {
    const s = nectar(withFeats({ '1:ancestry:0': 'caustic-nectar' }));
    expect(s, 'no nectar Strike on the sheet').toBeTruthy();
    expect(s!.damage).toMatch(/1d4/);
    expect(s!.damage).toMatch(/acid/i);
    expect(s!.range).toBe(20);
  });

  it('carries no critical specialization, which its text explicitly denies', () => {
    const s = nectar(withFeats({ '1:ancestry:0': 'caustic-nectar' }));
    expect(s!.critSpec ?? null).toBeFalsy();
    expect(db.feats['caustic-nectar'].note).toMatch(/sickened/i);
  });

  it('a character without the feat has no nectar Strike', () => {
    expect(nectar(build('fighter', 18))).toBeUndefined();
  });
});

describe('Potent Nectar — a permanent one-of-two choice', () => {
  const picks = { '1:ancestry:0': 'caustic-nectar', '18:class:0': 'potent-nectar' };

  it('the sticky branch adds 1d4 persistent acid', () => {
    const s = nectar(withFeats(picks, { 'potent-nectar:potent-nectar': 'sticky' }));
    expect(s!.damage).toMatch(/1d4 persistent acid/i);
    expect(s!.damage).not.toMatch(/splash/i);
  });

  it('the splash branch adds 1d4 acid splash instead', () => {
    const s = nectar(withFeats(picks, { 'potent-nectar:potent-nectar': 'splash' }));
    expect(s!.damage).toMatch(/1d4 acid splash/i);
    expect(s!.damage).not.toMatch(/persistent/i);
  });

  it('the rider lands on the NECTAR only, not on every unarmed Strike', () => {
    // `appliesTo: 'unarmed'` would have put the acid on the character's Fist as well. This is the
    // reason `strikeName` exists.
    const ch = withFeats(picks, { 'potent-nectar:potent-nectar': 'sticky' });
    const fist = deriveStrikes(ch, db).find((s) => /fist/i.test(s.name));
    expect(fist, 'no Fist to compare against').toBeTruthy();
    expect(fist!.damage).not.toMatch(/acid/i);
  });

  it('answering nothing grants nothing', () => {
    const s = nectar(withFeats(picks));
    expect(s!.damage).not.toMatch(/persistent|splash/i);
  });
});

/**
 * ONE question, not two — and not zero.
 *
 * Potent Nectar shipped a second picker for the same sentence: a bare `choice` (flag `choice`,
 * prompt "Benefit", options Splash Damage / Persistent Damage) sitting beside the `effectChoices`
 * group that does the actual work. Nothing read the bare one, so the player answered a question
 * whose answer went nowhere, then answered the real one.
 *
 * Round 5, on Exemplar Dedication's prerequisite-rendered-as-a-choice: a phantom question is
 * **deleted, not answered**. This is the same shape.
 */
describe('Potent Nectar asks its question exactly once', () => {
  it('the phantom "Benefit" picker is gone', () => {
    expect(db.feats['potent-nectar'].choice).toBeUndefined();
  });

  it('the live picker is still there, and still the one with the mechanics', () => {
    // Deleting the wrong one of the two would leave the feat unanswerable, so this is not implied by
    // the assertion above — it is the half that says the deletion took the right picker.
    const group = db.feats['potent-nectar'].effectChoices?.[0];
    expect(group?.id).toBe('potent-nectar');
    expect(group?.options.map((o) => o.value).sort()).toEqual(['splash', 'sticky']);
    // Each option carries a real grant — the reason this is the surviving question.
    for (const o of group!.options) expect(o.grant?.strikeDamage?.length).toBe(1);
  });

  it('the deletion is DURABLE — it lives in the overlay, not just in core.json', () => {
    /*
     * The phantom comes from public/core.foundry-backup.json, the pristine reference that
     * import-core-v2.mjs transcribes mechanics from on every run. Deleting it from public/core.json
     * alone lasts exactly until the next `npm run data`. `value: null` is how the overlay applier
     * (scripts/lib/apply-backfill.mjs) spells "remove this field".
     */
    const overlay = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string;
      id: string;
      field?: string;
      value: unknown;
    }[];
    const row = overlay.find((p) => p.category === 'feats' && p.id === 'potent-nectar' && p.field === 'choice');
    expect(row, 'no overlay row removes the phantom choice — it will come back on the next regen').toBeTruthy();
    expect(row!.value).toBeNull();
    // …and the reference really does still carry it, so the row is not defending against nothing.
    const ref = JSON.parse(readFileSync('public/core.foundry-backup.json', 'utf8')) as {
      feats: Record<string, { choice?: unknown }>;
    };
    expect(ref.feats['potent-nectar'].choice, 'the reference no longer has it; this row may be stale').toBeTruthy();
  });
});
