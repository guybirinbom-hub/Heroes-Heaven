import { describe, it, expect } from 'vitest';
import { buildCharacter, emptyBuild, backgroundGrantedFeats } from '../src/rules/build';
import { isBoundBackgroundGrant } from '../src/rules/backgroundGrants';
import { content } from './_content';

const c = () => content();

/**
 * A feat you were GIVEN can carry its own sub-choice, and for a long time only one route reached it.
 *
 * Builder rendered the picker from FEAT_FEAT_GRANTS[picked], so a feat granted by another feat got its
 * choice and a feat granted by a BACKGROUND did not — a background never becomes `picked`. Worse, the
 * engine pushed background-granted feats with no `choice` at all, so even a stored answer had nowhere
 * to land. Abadar's Avenger grants "Assurance with Religion" and the sheet could only say "Assurance".
 */
describe('a background-granted feat carries its own choice', () => {
  const db = () => c();

  /** Every background whose granted feat has a choice — the set the fix has to cover. */
  const affected = () => {
    const out: { bg: string; feat: string; kind: string }[] = [];
    for (const [id, bg] of Object.entries(db().backgrounds)) {
      for (const fid of backgroundGrantedFeats(bg, undefined)) {
        const ch = db().feats[fid]?.choice;
        if (ch) out.push({ bg: id, feat: fid, kind: ch.kind });
      }
    }
    return out;
  };

  it('there really are backgrounds in this shape', () => {
    // Measured, not assumed: if this ever drops to 0 the rest of the file is vacuous.
    expect(affected().length).toBeGreaterThanOrEqual(40);
  });

  const buildWith = (bg: string, grantedFeatChoices?: Record<string, string>) => {
    const db2 = db();
    const build = {
      ...emptyBuild(),
      level: 1,
      ancestryId: Object.keys(db2.ancestries)[0],
      backgroundId: bg,
      classId: 'fighter',
      keyAbility: 'str' as const,
      ...(grantedFeatChoices ? { grantedFeatChoices } : {}),
    };
    return buildCharacter(build, db2);
  };

  /*
   * ⚠ WHAT THESE TWO USED TO ASSERT, AND WHY IT WAS WRONG.
   *
   * The first was "Abadar's Avenger records the Religion the text names" — but it PASSED
   * `{ assurance: 'religion' }` in, i.e. it fed the free answer and then checked the free answer came
   * back. It proved the plumbing carried a pick; it did not prove the pick was Religion. The same
   * assertion passed just as happily with `'stealth'`, from a background whose sentence is *"You gain
   * the Assurance skill feat with Religion"*.
   *
   * The second asserted that with no pick the granted feat arrives with `choice: undefined` — i.e. it
   * pinned the defect open. Under ruling Q20 an unanswered Assurance is not merely untidy: the answer
   * is the ONLY thing Assurance produces, because it decides which skill carries the `*`. Undefined
   * means the star lands nowhere, on a background that names the skill in its own text.
   *
   * A test that vouches for a defect is worse than no test, so both now assert the binding.
   */
  it("Abadar's Avenger binds Assurance to Religion, whatever the player answers", () => {
    const [{ bg, feat }] = affected().filter((a) => a.bg === 'abadars-avenger');
    // A stale free answer from before the binding existed. The background's own text must win.
    const ch = buildWith(bg, { [feat]: 'stealth' });
    const got = ch.feats.find((f) => f.featId === feat);
    expect(got, 'the granted feat should be on the character').toBeTruthy();
    expect(got!.choice?.value).toBe('religion');
    expect(got!.choice?.label).toBe('Religion');
  });

  it('without a pick the feat arrives ALREADY answered, because the background answered it', () => {
    // The feat is granted by the background — it must never depend on the player answering first,
    // and where the text names the skill there is nothing for them to answer.
    const ch = buildWith('abadars-avenger');
    const got = ch.feats.find((f) => f.featId === 'assurance');
    expect(got).toBeTruthy();
    expect(got!.choice?.value).toBe('religion');
  });

  it('a background that does NOT name the skill still honours the free answer', () => {
    // The binding must not swallow the whole lane. Keys to Destiny grants Assurance and ties it to
    // nothing — "You gain the Assurance skill feat and are trained in one of the following Lore
    // skills" — so its picker is real and its answer must survive.
    const ch = buildWith('keys-to-destiny', { assurance: 'stealth' });
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('stealth');
  });

  it('the answer survives for every UNBOUND background, not just the one', () => {
    // The fix is generic, so a spot-check of one background would not prove it. Each background gets
    // its granted feat's first legal option and must come back carrying it.
    const failures: string[] = [];
    for (const { bg, feat } of affected()) {
      if (isBoundBackgroundGrant(bg, feat)) continue; // answered by the background — covered below
      const def = db().feats[feat]!.choice!;
      const value = def.options?.[0]?.value ?? (def.kind === 'skills' ? 'stealth' : undefined);
      if (!value) continue; // an open-vocabulary choice (free-text Lore) has no option list to pick from
      const ch = buildWith(bg, { [feat]: value });
      const got = ch.feats.find((f) => f.featId === feat);
      if (got?.choice?.value !== value) failures.push(`${bg} → ${feat} (${def.kind})`);
    }
    expect(failures).toEqual([]);
  });

  it('a label is always produced, never an empty string', () => {
    // The sheet renders "Assurance (Religion)" from this label; an empty one reads as a bug.
    const bad: string[] = [];
    for (const { bg, feat } of affected()) {
      const def = db().feats[feat]!.choice!;
      const value = def.options?.[0]?.value;
      if (!value) continue;
      const got = buildWith(bg, { [feat]: value }).feats.find((f) => f.featId === feat);
      if (got?.choice && !String(got.choice.label ?? '').trim()) bad.push(`${bg} → ${feat}`);
    }
    expect(bad).toEqual([]);
  });
});
