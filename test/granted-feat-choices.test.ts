import { describe, it, expect } from 'vitest';
import { buildCharacter, emptyBuild, backgroundGrantedFeats } from '../src/rules/build';
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

  it("Abadar's Avenger records the Religion the text names", () => {
    const [{ bg, feat }] = affected().filter((a) => a.bg === 'abadars-avenger');
    const ch = buildWith(bg, { [feat]: 'religion' });
    const got = ch.feats.find((f) => f.featId === feat);
    expect(got, 'the granted feat should be on the character').toBeTruthy();
    expect(got!.choice?.value).toBe('religion');
    expect(got!.choice?.label).toBe('Religion');
  });

  it('without a pick the feat still arrives, just unanswered', () => {
    // The feat is granted by the background — it must never depend on the player answering first.
    const ch = buildWith('abadars-avenger');
    const got = ch.feats.find((f) => f.featId === 'assurance');
    expect(got).toBeTruthy();
    expect(got!.choice).toBeUndefined();
  });

  it('the answer survives for every affected background, not just the one', () => {
    // The fix is generic, so a spot-check of one background would not prove it. Each background gets
    // its granted feat's first legal option and must come back carrying it.
    const failures: string[] = [];
    for (const { bg, feat } of affected()) {
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
