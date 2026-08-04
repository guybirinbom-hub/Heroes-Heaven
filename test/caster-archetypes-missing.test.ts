import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { CASTER_ARCHETYPES } from '../src/rules/casterArchetypes';

/**
 * Three caster archetypes were missing from CASTER_ARCHETYPES altogether.
 *
 * The table's `mk()` helper derives the progression feat ids as `basic-<slug>-spellcasting`, and all
 * three of these name theirs something else — Basic Red Mantis Magic, Snowcaster, Basic Cathartic
 * Spellcasting. So their Expert/Master feats said "You gain the benefits" and granted no spell slots
 * whatsoever.
 *
 * Gelid Shard ships no feat carrying the dedication trait at all; First Frost is its level-2 entry.
 */
const db = content();
const NEW = ['cathartic-mage-dedication', 'red-mantis-assassin-dedication', 'first-frost'] as const;

describe('caster archetypes the table was missing', () => {
  it('all three are registered', () => {
    for (const id of NEW) expect(CASTER_ARCHETYPES[id], `${id} is not registered`).toBeDefined();
  });

  it('every progression feat id in the WHOLE table resolves to a real feat', () => {
    // The bug these three had was an id that pointed at nothing. Check the entire table, not just the
    // new rows, so the next non-standard naming cannot slip through either.
    const bad: string[] = [];
    for (const [id, cfg] of Object.entries(CASTER_ARCHETYPES)) {
      for (const key of ['basicId', 'expertId', 'masterId'] as const) {
        const featId = cfg[key];
        if (featId && !db.feats[featId]) bad.push(`${id}.${key} -> ${featId}`);
      }
      if (!db.feats[id] && !db.classFeatures[id]) bad.push(`${id} is not a feat`);
    }
    expect(bad).toEqual([]);
  });

  it('a Gelid Shard caster gets spell slots from Snowcaster', () => {
    const withCasting = build('fighter', 8, { featPicks: { '2:class': 'first-frost', '4:class': 'snowcaster' } });
    const entry = withCasting.spellcasting.find((e) => e.tradition === 'arcane');
    expect(entry, 'no arcane entry from the Gelid Shard archetype').toBeDefined();
    const slots = Object.values(entry!.slots ?? {}).reduce((a, s) => a + (s?.max ?? 0), 0);
    expect(slots, 'Snowcaster granted no slots').toBeGreaterThan(0);
  });

  it('the dedication alone gives cantrips but no ranked slots', () => {
    const dedOnly = build('fighter', 8, { featPicks: { '2:class': 'first-frost' } });
    const entry = dedOnly.spellcasting.find((e) => e.tradition === 'arcane');
    expect(entry).toBeDefined();
    const ranked = Object.entries(entry!.slots ?? {}).filter(([r]) => Number(r) > 0);
    expect(ranked.every(([, s]) => !s?.max)).toBe(true);
  });

  it('Red Mantis is prepared and Cathartic Mage is spontaneous, as printed', () => {
    expect(CASTER_ARCHETYPES['red-mantis-assassin-dedication'].repertoire).toBeFalsy();
    expect(CASTER_ARCHETYPES['cathartic-mage-dedication'].repertoire).toBe(true);
    expect(CASTER_ARCHETYPES['cathartic-mage-dedication'].choiceTradition).toBe(true);
  });

  it('all three key off Charisma, which is what every one of them prints', () => {
    for (const id of NEW) expect(CASTER_ARCHETYPES[id].keyAbility, id).toBe('cha');
  });
});
