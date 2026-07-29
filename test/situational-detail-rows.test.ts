import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { explainStat, statHasSituational, type StatRef } from '../src/rules/explain';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { deriveStrikes } from '../src/rules/derive';
import { normalizeCharacter } from '../src/rules/normalize';
import type { Character } from '../src/rules/types';

const c = content();

/**
 * THE STAR MUST LEAD SOMEWHERE.
 *
 * `statHasSituational` puts a `*` on a stat row for EVERY target kind, but `explainStat` only
 * assembled the matching note lines for a few of them. The result was a cue that promised detail
 * and a popup that showed none — strictly worse than no star at all, because the player goes
 * looking for a bonus the app then refuses to name.
 *
 * Same class of defect as the registry gaps: the data was there, nothing read it. The invariant
 * below is deliberately generic, so a new StatRef kind can't ship half-wired.
 */

const nameOf = (id: string) =>
  c.feats[id]?.name ?? c.items[id]?.name ?? c.heritages[id]?.name ?? c.backgrounds[id]?.name ?? c.ancestries[id]?.name ?? c.classFeatures[id]?.name ?? id;

/** First registry id whose bonuses hit this target kind (optionally narrowed by `detail`). */
function idTargeting(kind: string, detail?: string): string {
  for (const [id, bonuses] of Object.entries(FEAT_SITUATIONAL)) {
    const hit = bonuses.some((b) =>
      b.targets.some((t) => t.kind === kind && (!detail || t.detail === detail || t.detail === 'all')),
    );
    if (hit) return id;
  }
  throw new Error(`no registry entry targets '${kind}' — the fixture is stale`);
}

/**
 * A character carrying exactly one situational source. The id goes in `feats` whatever collection it
 * really belongs to: `characterSituationalIds` reads feat ids straight through to the registry, so
 * this exercises the display path without needing a build that can legally take the record.
 */
function charWith(id: string): Character {
  return normalizeCharacter({
    id: 'sit', name: 'Sit', level: 5, classId: 'fighter', keyAbility: 'str',
    ancestryId: 'human',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    feats: [{ featId: id }],
    spellcasting: [
      { id: 'e1', name: 'Spells', type: 'spontaneous', tradition: 'arcane', keyAbility: 'cha', proficiency: 'trained', cantrips: [] },
    ],
  });
}

describe('every starred stat kind lists its situational bonuses', () => {
  const cases: { kind: string; detail?: string; ref: (ch: Character) => StatRef }[] = [
    { kind: 'skill', detail: 'acrobatics', ref: () => ({ kind: 'skill', skill: 'acrobatics' }) },
    { kind: 'save', detail: 'will', ref: () => ({ kind: 'save', save: 'will' }) },
    { kind: 'perception', ref: () => ({ kind: 'perception' }) },
    { kind: 'ac', ref: () => ({ kind: 'ac' }) },
    { kind: 'classDc', ref: () => ({ kind: 'classDc' }) },
    { kind: 'spell', detail: 'attack', ref: () => ({ kind: 'spell', entryId: 'e1', which: 'attack' }) },
    { kind: 'ability', ref: () => ({ kind: 'ability', ability: 'str' }) },
    { kind: 'hp', ref: () => ({ kind: 'hp' }) },
    { kind: 'speed', ref: () => ({ kind: 'speed' }) },
    { kind: 'strikeAttack', ref: (ch) => ({ kind: 'strikeAttack', instanceId: deriveStrikes(ch, c)[0].instanceId }) },
    { kind: 'strikeDamage', ref: (ch) => ({ kind: 'strikeDamage', instanceId: deriveStrikes(ch, c)[0].instanceId }) },
  ];

  for (const { kind, detail, ref } of cases) {
    it(`${kind}: a starred row's breakdown names the bonus`, () => {
      const id = idTargeting(kind, detail);
      const ch = charWith(id);
      const r = ref(ch);

      // Precondition: the row IS starred. If this fails the fixture is wrong, not the app.
      expect(statHasSituational(ch, r, c), `${id} should star ${kind}`).toBe(true);

      const lines = explainStat(ch, c, r).situational ?? [];
      expect(lines.length, `${kind} is starred by ${id} but its breakdown lists nothing`).toBeGreaterThan(0);
      // The line has to name its source, or the player can't tell which record is talking.
      expect(lines.join(' '), `${kind} lists lines but none names ${id}`).toContain(nameOf(id));
    });
  }
});
