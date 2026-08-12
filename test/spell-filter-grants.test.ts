import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { spellsMatching } from '../src/rules/spellChoice';
import type { EffectChoice, SpellChoiceFilter } from '../src/rules/types';

const c = content();

/**
 * OPEN SPELL PICKS — `EffectChoice.spellFilter`, the "choose ANY spell matching this" lane.
 *
 * `grantForSpellPick` turns the answer into one of three grants: an innate casting, a spell loaded
 * into a granted staff, or a FOCUS spell. Two of those had a consumer and the third did not — the
 * grant was computed correctly, handed to `applyAlwaysOn`, and dropped on the floor, because focus
 * spells are gathered ~1,000 lines earlier (the focus entry and the pool size are both already
 * built by the time that sink runs) and that earlier pass read only fixed `options`.
 *
 * So all four qi-spell feats asked the monk a question, stored the answer, showed it in the builder,
 * and granted nothing: no focus spell, and no focus pool at all.
 */

/** Every record in the shipped data declaring an open spell pick, by how it grants. */
function openSpellPicks(grantAs: SpellChoiceFilter['grantAs']) {
  const out: { id: string; name: string; level: number; choice: EffectChoice }[] = [];
  for (const f of Object.values(c.feats)) {
    for (const ch of f.effectChoices ?? []) {
      if (ch.spellFilter?.grantAs === grantAs) out.push({ id: f.id, name: f.name, level: f.level, choice: ch });
    }
  }
  return out;
}

/** A monk who has taken `featId` and answered its open pick with `spellId`. */
const monkWith = (level: number, picks: { featId: string; featLevel: number; choiceId: string; spellId: string }[]) =>
  build('monk', level, {
    featPicks: Object.fromEntries(picks.map((p, i) => [`${p.featLevel}:class:${i}`, p.featId])),
    effectChoices: Object.fromEntries(picks.map((p) => [`${p.featId}:${p.choiceId}`, p.spellId])),
  });

const focusRepertoire = (ch: ReturnType<typeof build>) =>
  Object.values(ch.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat();

describe('an open pick that grants a FOCUS spell reaches the focus pool', () => {
  it('the data really carries this shape — it is not a hypothetical lane', () => {
    const focus = openSpellPicks('focus');
    expect(focus.map((r) => r.id).sort()).toEqual([
      'advanced-qi-spells',
      'grandmaster-qi-spells',
      'master-qi-spells',
      'qi-spells',
    ]);
  });

  it("Qi Spells: the chosen spell is IN the repertoire, and the monk has a focus pool at all", () => {
    const bare = build('monk', 6);
    // The defect, named: without the pick resolving there is no focus entry and no pool — the whole
    // surface is missing, not merely one spell short of correct.
    expect(bare.spellcasting.find((s) => s.type === 'focus'), 'the fixture must gain focus ONLY from this feat').toBeUndefined();
    expect(bare.focus).toBeUndefined();

    const ch = monkWith(6, [{ featId: 'qi-spells', featLevel: 1, choiceId: 'qi-spell', spellId: 'inner-upheaval' }]);
    expect(focusRepertoire(ch)).toContain('inner-upheaval');
    expect(ch.focus?.max).toBe(1);
    // Filed under the feat that asked, so the sheet can say where the spell came from.
    expect(ch.spellcasting.find((s) => s.type === 'focus')?.spellSources?.['inner-upheaval']).toBe('Qi Spells');
  });

  it('a second open focus pick adds its own spell AND its own point — one point per spell', () => {
    const ch = monkWith(8, [
      { featId: 'qi-spells', featLevel: 1, choiceId: 'qi-spell', spellId: 'inner-upheaval' },
      { featId: 'advanced-qi-spells', featLevel: 6, choiceId: 'advanced-qi-spell', spellId: 'qi-blast' },
    ]);
    const rep = focusRepertoire(ch);
    expect(rep).toContain('inner-upheaval');
    expect(rep).toContain('qi-blast');
    expect(ch.focus?.max, 'two spells, two points — never one each plus a phantom bonus').toBe(2);
  });

  it('EVERY shipped open focus pick lands — no record of this shape is silently dropped', () => {
    // The lane, not the feat. A record added tomorrow with `grantAs: 'focus'` has to work without
    // anyone remembering that focus spells are collected in a different pass from every other grant.
    for (const rec of openSpellPicks('focus')) {
      const legal = spellsMatching(rec.choice.spellFilter!, c);
      expect(legal.length, `${rec.name} offers nothing to pick`).toBeGreaterThan(0);
      const spellId = legal[0].id;
      const ch = monkWith(20, [
        { featId: rec.id, featLevel: rec.level, choiceId: rec.choice.id, spellId },
      ]);
      expect(focusRepertoire(ch), `${rec.name} → ${spellId} reaches nothing`).toContain(spellId);
    }
  });

  it('an answer the filter does not admit grants nothing rather than being obeyed', () => {
    // A saved answer from before a filter was narrowed must not smuggle a 6th-rank arcane spell into
    // a 1st-rank monk focus list.
    const ch = monkWith(6, [{ featId: 'qi-spells', featLevel: 1, choiceId: 'qi-spell', spellId: 'fireball' }]);
    expect(focusRepertoire(ch)).not.toContain('fireball');
    expect(ch.focus).toBeUndefined();
  });
});

describe('the other two grantAs shapes still work — the focus fix did not take their pass', () => {
  it("'innate' picks are granted by the effect-choice pass, not the focus one", () => {
    const innate = openSpellPicks('innate');
    expect(innate.length).toBeGreaterThan(20);
    const rec = innate.find((r) => r.id === 'adapted-cantrip') ?? innate[0];
    const spellId = spellsMatching(rec.choice.spellFilter!, c)[0].id;
    const ch = build('monk', 20, {
      featPicks: { [`${rec.level}:class:0`]: rec.id },
      effectChoices: { [`${rec.id}:${rec.choice.id}`]: spellId },
    });
    const entry = ch.spellcasting.find((s) => s.type === 'innate');
    expect([...(entry?.cantrips ?? []), ...Object.values(entry?.repertoire ?? {}).flat()]).toContain(spellId);
    // …and it must NOT have been counted as a focus spell on the way past.
    expect(focusRepertoire(ch)).not.toContain(spellId);
  });
});
