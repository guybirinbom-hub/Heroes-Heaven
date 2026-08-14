import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import type { ProficiencyKey } from '../src/rules/types';

/**
 * A HEIGHTEN LADDER KEYED TO A SKILL, NOT TO A LEVEL.
 *
 * "If you're a master in Religion, spirit link is heightened to 3rd rank. If you're legendary in
 * Religion, spirit link is heightened to 4th rank." `heightenAt` cannot say that — two characters of
 * the same level get different ranks — so all three records that print one carried no heighten at all
 * and the rank never moved when the skill did.
 *
 * It is a FLOOR, never a replacement (R7's Land Legs ruling, same shape): the value it computes can
 * only raise the rank the character would otherwise cast at.
 */
const db = content();
const innateOf = (ch: ReturnType<typeof build>) => ch.spellcasting.find((e) => e.type === 'innate');
const rankOf = (ch: ReturnType<typeof build>, spellId: string) => {
  const rep = innateOf(ch)?.repertoire ?? {};
  const hit = Object.entries(rep).find(([, ids]) => ids.includes(spellId));
  return hit ? Number(hit[0]) : innateOf(ch)?.cantrips.includes(spellId) ? 0 : undefined;
};
/** A fighter of `level` with `skill` raised to `rank` through real skill increases. */
const at = (featId: string, skill: ProficiencyKey, rank: 'trained' | 'expert' | 'master' | 'legendary', level = 20) => {
  const steps: Record<string, number[]> = { trained: [], expert: [3], master: [3, 7], legendary: [3, 7, 15] };
  const skillIncreases: Record<number, ProficiencyKey> = {};
  for (const lvl of steps[rank]) skillIncreases[lvl] = skill;
  return build('fighter', level, {
    featPicks: { '1:ancestry:0': featId },
    classSkills: [skill],
    skillIncreases,
  } as Partial<BuildState>);
};

describe('Rivethun Devotion', () => {
  it('names only ONE of its two spells, and the data does too', () => {
    const g = db.feats['rivethun-devotion'].innateSpells ?? [];
    expect(g.find((x) => x.spellId === 'spirit-link')?.heightenBySkill).toEqual([
      { skill: 'religion', rank: 'master', spellRank: 3 },
      { skill: 'religion', rank: 'legendary', spellRank: 4 },
    ]);
    // "…spirit link is heightened" — See the Unseen deliberately gets no ladder.
    expect(g.find((x) => x.spellId === 'see-the-unseen')?.heightenBySkill).toBeUndefined();
  });

  it('spirit link climbs with Religion and see the unseen does not', () => {
    for (const [rank, expected] of [
      ['trained', 2],
      ['expert', 2],
      ['master', 3],
      ['legendary', 4],
    ] as const) {
      const ch = at('rivethun-devotion', 'religion', rank);
      expect(ch.proficiencies.skills.religion, 'the fixture must actually reach ' + rank).toBe(rank);
      expect(rankOf(ch, 'spirit-link'), `spirit link @ ${rank}`).toBe(expected);
      expect(rankOf(ch, 'see-the-unseen'), `see the unseen @ ${rank}`).toBe(2);
    }
  });
});

describe('Rivethun Adept', () => {
  it('spiritual guardian jumps 5 → 7 at legendary, speak with stones stays', () => {
    const master = at('rivethun-adept', 'religion', 'master');
    const legend = at('rivethun-adept', 'religion', 'legendary');
    expect(rankOf(master, 'spiritual-guardian')).toBe(5);
    expect(rankOf(legend, 'spiritual-guardian')).toBe(7);
    expect(rankOf(legend, 'speak-with-stones')).toBe(5);
  });
});

describe("Blessing of the Five — a ladder that is not the character's level", () => {
  /* Order of the Godclaw's greater benefit: "You cast the 3-action version of Heal, heightened to a
   * rank ONE LOWER than half your level rounded up." The rank is the whole point of the ability and
   * was printed nowhere; the record had no innate grant at all. */
  const godclaw = (level: number) =>
    build('fighter', level, {
      featPicks: { '2:class': 'hellknight-dedication', '4:class': 'order-training' },
      pickFeatChoices: { 'order-training': 'blessing-of-the-five' },
    } as Partial<BuildState>);

  it('is reachable — the order feat is offered by Order Training', () => {
    const ch = godclaw(12);
    expect(ch.feats.some((f) => f.featId === 'blessing-of-the-five'), 'a feat nothing grants is data nobody sees').toBe(true);
  });

  it('casts Heal at ceil(level / 2) − 1, never below its own rank 1', () => {
    for (const [level, rank] of [
      [4, 1],
      [12, 5],
      [20, 9],
    ] as const)
      expect(rankOf(godclaw(level), 'heal'), `level ${level}`).toBe(rank);
  });

  it('and carries the rest of the ability as a note on the spell', () => {
    const notes = godclaw(12).spellNotes?.['heal'] ?? [];
    expect(notes.map((n) => n.from)).toContain('Blessing of the Five');
    expect(notes[0].note).toContain('3-action version');
  });
});

describe('Arcane Sense — the ladder is a floor, because Detect Magic is a cantrip', () => {
  it('the record ships the ladder its second sentence describes', () => {
    expect(db.feats['arcane-sense'].innateSpells?.[0]).toMatchObject({
      spellId: 'detect-magic',
      tradition: 'arcane',
      atWill: true,
      rank: 1,
      heightenBySkill: [
        { skill: 'arcana', rank: 'master', spellRank: 3 },
        { skill: 'arcana', rank: 'legendary', spellRank: 4 },
      ],
    });
    // The premise of the floor: this app's Detect Magic is a rank-0 record with the cantrip trait, and
    // PF2e heightens an innate cantrip to half your level. Without the floor the patch's own ladder
    // would have DOWNGRADED a level-20 caster's Detect Magic from 10th rank to 1st.
    expect(db.spells['detect-magic'].rank).toBe(0);
    expect(db.spells['detect-magic'].traits).toContain('cantrip');
  });

  it('never casts it below half the character’s level, at any Arcana rank', () => {
    for (const level of [1, 3, 7, 20]) {
      for (const rank of ['trained', 'expert', 'master', 'legendary'] as const) {
        if (rank === 'master' && level < 7) continue;
        if (rank === 'legendary' && level < 15) continue;
        if (rank === 'expert' && level < 3) continue;
        const ch = at('arcane-sense', 'arcana', rank, level);
        expect(rankOf(ch, 'detect-magic'), `level ${level} / ${rank} Arcana`).toBe(Math.max(1, Math.ceil(level / 2)));
      }
    }
  });

  it('and the printed rank is the floor at low levels, not the spell’s rank 0', () => {
    // "You can cast 1ST-RANK Detect Magic at will": at 1st level the cantrip's own auto-heighten is 1,
    // and the grant's rank is 1, so it is cast at 1 — not at the record's base rank of 0.
    expect(rankOf(at('arcane-sense', 'arcana', 'trained', 1), 'detect-magic')).toBe(1);
    expect(innateOf(at('arcane-sense', 'arcana', 'trained', 1))!.cantrips).not.toContain('detect-magic');
  });
});
