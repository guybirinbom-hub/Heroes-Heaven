import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Player Core p.298, Focus Spells:
 *
 *   *"Casting any of your focus spells costs you 1 Focus Point. You automatically gain a focus pool the
 *   first time you gain an ability that gives you a focus spell. The maximum number of points in your
 *   pool is equal to THE NUMBER OF FOCUS SPELLS YOU KNOW or 3, whichever is lower. THIS COUNTS ONLY
 *   SPELLS THAT REQUIRE FOCUS POINTS TO CAST. For example, a bard's composition cantrips don't count
 *   toward the size of the pool."*
 *
 * The pool was modelled as the number of focus-granting SOURCES instead — the class chassis 1, each
 * choice 1, each feat 1. That is a different quantity, and it was wrong in both directions.
 *
 * "Requires Focus Points to cast" is the `focus` trait, which the same page names as the printed marker
 * ("the title of a focus spell's stat block says 'Focus' instead of 'Spell', and the spell has the focus
 * trait"). Verified against the archive: Spirit Object and Create Thrall are titled "Cantrip 1" and
 * carry no such trait; Counter Performance and Hero's Defiance are "Focus 1"/"Focus 10" and do.
 */

const poolOf = (ch: ReturnType<typeof build>) => ch.focus?.max ?? 0;
const knownFocus = (ch: ReturnType<typeof build>) =>
  Object.values(ch.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat() as string[];
const costsAPoint = (id: string) => (db.spells[id]?.traits ?? []).includes('focus');

describe('the focus pool counts SPELLS, not sources', () => {
  it('the trait really is the marker in our data', () => {
    // If these flip, the rule below is being read off the wrong field.
    expect(costsAPoint('counter-performance')).toBe(true);
    expect(costsAPoint('heros-defiance')).toBe(true);
    expect(costsAPoint('spirit-object'), 'a hex cantrip costs no Focus Point').toBe(false);
    expect(costsAPoint('create-thrall'), 'a thrall cantrip costs no Focus Point').toBe(false);
  });

  it('two focus spells from ONE source give two points', () => {
    /*
     * The undercount. A 20th-level champion knows Shields of the Spirit and Hero's Defiance, both from
     * the class chassis — one source, two point-costing spells. The source model gave 1.
     */
    const ch = build('champion', 20);
    const costing = knownFocus(ch).filter(costsAPoint);
    expect(costing.length, `known: ${knownFocus(ch).join(', ')}`).toBeGreaterThanOrEqual(2);
    expect(poolOf(ch)).toBe(Math.min(3, costing.length));
  });

  it('a free cantrip gives NO pool at all', () => {
    /*
     * The overcount, and the clause about gaining a pool "the first time you gain an ability that gives
     * you a focus spell": a 1st-level witch's patron grants Spirit Object, a hex CANTRIP. No focus
     * spell yet, so no pool — not a pool of zero, and not a pool of one.
     */
    const ch = build('witch', 1);
    expect(knownFocus(ch)).toContain('spirit-object');
    expect(knownFocus(ch).filter(costsAPoint)).toEqual([]);
    expect(ch.focus).toBeUndefined();
  });

  it('the cantrip is still castable — only the POOL ignores it', () => {
    const ch = build('witch', 1);
    expect(ch.spellcasting.find((s) => s.type === 'focus')).toBeTruthy();
  });

  it('the cap is 3, however many you know', () => {
    /*
     * No class's bare chassis reaches three point-costing focus spells (measured across all of them at
     * 20th), so the cap has to be exercised with feats: a necromancer knows Necrotic Bomb from the
     * class, one grave spell from its fascination, and two more from feats whose whole content is a
     * grave spell — five, capped at three.
     */
    const ch = build('necromancer', 20, {
      featPicks: { '2:class': 'widespread-fascination', '4:class': 'deathly-scream', '6:class': 'song-of-the-soul' },
      effectChoices: {
        'grim-fascination:grim-fascination': 'bone',
        'widespread-fascination:widespread-fascination': 'spirit',
      },
    } as Partial<BuildState>);
    expect(knownFocus(ch).filter(costsAPoint).length).toBeGreaterThan(3);
    expect(poolOf(ch)).toBe(3);
  });

  it('every class at every level agrees with the printed formula', () => {
    /*
     * The whole corpus, not two records. The psychic is the one exemption and it is RAW: its class text
     * grants the pool outright ("You start with a focus pool of 2 Focus Points") to power amps, and its
     * psi cantrips are cantrips in the occult repertoire rather than focus spells — so its pool is not
     * derived from spells known at all.
     */
    const wrong: string[] = [];
    for (const clsId of Object.keys(db.classes)) {
      if (clsId === 'psychic') continue;
      for (const level of [1, 3, 5, 8, 12, 16, 20]) {
        const ch = build(clsId, level);
        const want = Math.min(3, knownFocus(ch).filter(costsAPoint).length);
        if (poolOf(ch) !== want) wrong.push(`${clsId}@${level}: rule ${want}, app ${poolOf(ch)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('several sources still share ONE pool', () => {
    /*
     * *"It's possible, especially through archetypes, to gain focus spells from more than one source. If
     * this happens, you have just one focus pool, counting all your focus spells."* A necromancer who
     * takes Widespread Fascination has the class's grave spell plus two picked ones — three spells, one
     * pool of three, not three pools.
     */
    const ch = build('necromancer', 2, {
      featPicks: { '2:class': 'widespread-fascination' },
      effectChoices: {
        'grim-fascination:grim-fascination': 'bone',
        'widespread-fascination:widespread-fascination': 'spirit',
      },
    } as Partial<BuildState>);
    expect(ch.spellcasting.filter((s) => s.type === 'focus')).toHaveLength(1);
    expect(poolOf(ch)).toBe(3);
  });
});
