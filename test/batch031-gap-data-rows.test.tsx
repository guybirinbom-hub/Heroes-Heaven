// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { renderDom } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { FeatsTab, featEntries, regrantedFeatureIds } from '../src/sheet/FeatsTab';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import { abilityModOf, deriveStrikes } from '../src/rules/derive';
import { initialPlay } from '../src/rules/play';
import type { Character, ContentDatabase, PlayState, StanceDef } from '../src/rules/types';

/**
 * Batch-031, WG-comparison lane — the GAP-DATA-ROWS family.
 *
 * The lines this file pins are the CROSS-FILE half of the data-rows family's report: the three
 * actionCost siblings of ouroboric-pact#action-cost, the featCantripGrants deletion the dream-magic
 * effectChoices row needs beside it, the Feats-tab reader for `grantsClassFeatures`, and the two
 * remaster stance SPELLS, which could reach no toggle and (for wind crash) no ranged Strike.
 *
 * Where a row this family authors has not landed yet, the assertion reads the shipped data and fails
 * for exactly that field. Where a row ANOTHER family authors is the fixture (the two stance defs),
 * the test patches a deep copy of `content()` in memory, so nothing flips when that row is applied.
 */
const c = () => content();
const noop = () => undefined;
const feat = (id: string) => c().feats[id] as Record<string, unknown> | undefined;

/* ------------------------------------------------------------------ the three actionCost siblings */

describe('phoenixs-flight is a passive feat that grants a three-action activity', () => {
  // batch 031 premise: feat-7105 "While transformed, you gain the Blazing Conflagration action."
  it('carries no action cost of its own; the cost stays on Blazing Conflagration', () => {
    // feat-7105's title glyph is <actions string=""/> and the three actions sit on the granted
    // activity's own **Activate** line, which we already ship as actions/blazing-conflagration.
    expect(feat('phoenixs-flight')?.actionCost).toEqual({ type: 'passive' });
    expect(feat('phoenixs-flight')?.grantsActions).toContain('blazing-conflagration');
    expect(c().actions['blazing-conflagration'].actionCost).toEqual({ type: 'actions', value: 3 });
  });
});

describe('campfire-chronicler-dedication is a passive feat that grants Offer Story', () => {
  // batch 031 premise: feat-7438 "You gain the Offer Story action."
  it('carries no action cost of its own; the single action stays on Offer Story', () => {
    expect(feat('campfire-chronicler-dedication')?.actionCost).toEqual({ type: 'passive' });
    expect(feat('campfire-chronicler-dedication')?.grantsActions).toContain('offer-story');
    expect(c().actions['offer-story'].actionCost).toEqual({ type: 'actions', value: 1 });
  });
});

describe('pact-of-the-living-pact is a passive feat that grants Forced Pact', () => {
  // batch 031 premise: feat-7454 "You gain the Forced Pact action."
  it('carries no action cost of its own; the single action stays on Forced Pact', () => {
    expect(feat('pact-of-the-living-pact')?.actionCost).toEqual({ type: 'passive' });
    expect(feat('pact-of-the-living-pact')?.grantsActions).toContain('forced-pact');
    expect(c().actions['forced-pact'].actionCost).toEqual({ type: 'actions', value: 1 });
  });
});

/* ---------------------------------------------------------------- dream-magic: one lane, not two */

describe('dream-magic asks its question on ONE lane', () => {
  // batch 031: dream-magic#rank
  it('dream-magic is gone from FEAT_CANTRIP_GRANTS, which cannot carry the printed 4th rank', () => {
    // "you learn this spell as a 4th-rank occult innate spell that you can cast once per day"
    // (AoN feat-8518). CantripPickSpec has no rank field, so the pick had to move to the record's
    // own effectChoices — and leaving BOTH lanes live asks the player the same question twice.
    expect(FEAT_CANTRIP_GRANTS['dream-magic']).toBeUndefined();
    // The three records moved off this lane for the same reason are gone too, so a revert is loud.
    for (const id of ['colugos-traversal', 'empathic-calm', 'merge-with-the-source']) {
      expect(FEAT_CANTRIP_GRANTS[id]).toBeUndefined();
    }
  });
});

/* -------------------------------------------------- Spellshield gives the War Mage arcane-bond back */

/** A War Mage wizard who has taken Spellshield — the only shape in which the defect appears. */
const warMageSpellshield = () =>
  build('wizard', 8, {
    featPicks: { '2:class:0': 'war-mage-dedication', '8:class:0': 'spellshield' },
  }) as Character;

describe('spellshield: a class feature an owned feat GIVES BACK is not "Replaced"', () => {
  // batch 031: spellshield#arcane-bond-listing
  it('spellshield regrants arcane-bond, which War Mage Dedication suppresses', () => {
    // "You gain the arcane bond class feature and the Drain Bonded Item action" (AoN feat-7983),
    // whose prerequisite is War Mage Dedication — whose classArchetype suppresses 'arcane-bond'.
    const con = c();
    expect(con.feats['spellshield'].grantsClassFeatures).toContain('arcane-bond');
    expect(con.feats['war-mage-dedication'].classArchetype?.suppressFeatures).toContain('arcane-bond');
    const ch = warMageSpellshield();
    expect(ch.classArchetype?.suppressedFeatures).toContain('arcane-bond');
    expect([...regrantedFeatureIds(ch, con)]).toContain('arcane-bond');
  });

  // batch 031: spellshield#arcane-bond-listing
  it('spellshield: the Arcane Bond row is listed, not hidden', () => {
    const ch = warMageSpellshield();
    const rows = featEntries(ch, c());
    expect(rows.some((e) => e.featureId === 'arcane-bond')).toBe(true);
  });

  // batch 031: spellshield#arcane-bond-listing
  it('spellshield: the "Replaced" note no longer names Arcane Bond', () => {
    const con = c();
    const ch = warMageSpellshield();
    const { host, stop } = renderDom(<FeatsTab character={ch} content={con} onPlay={noop} />);
    // The "Replaced" LINE only — the archetype's own prose note quotes "you never gain Arcane Bond",
    // which is the printed text of the archetype and must stay exactly as printed.
    const replaced = [...host.querySelectorAll('.ff-arch li')].map((li) => li.textContent ?? '').find((t) => t.startsWith('Replaced'));
    stop();
    expect(replaced).toBeTruthy();
    expect(replaced).not.toContain('Arcane Bond');
    // The two features the archetype really does take away are still named.
    expect(replaced).toContain('Arcane Thesis');
    expect(replaced).toContain('Defensive Robes');
  });

  // batch 031: spellshield#arcane-bond-listing
  it('spellshield: a War Mage WITHOUT it still reads Arcane Bond as replaced', () => {
    const con = c();
    const plain = build('wizard', 8, { featPicks: { '2:class:0': 'war-mage-dedication' } }) as Character;
    expect([...regrantedFeatureIds(plain, con)]).not.toContain('arcane-bond');
    expect(featEntries(plain, con).some((e) => e.featureId === 'arcane-bond')).toBe(false);
  });
});

/* ---------------------------------------------------------- the two stance SPELLS of the remaster */

/**
 * A deep copy of the content with the two stance defs the data-rows family authors patched IN, so
 * these assertions state the mechanic rather than the arrival of somebody else's row. `wind crash`
 * carries the `range: 30` this family's own spec adds; `shadow grasp` is melee as authored.
 */
function withStanceDefs(): ContentDatabase {
  const con = JSON.parse(JSON.stringify(c())) as ContentDatabase;
  const stances = (con.stances ??= {});
  stances['clinging-shadows-stance'] = {
    id: 'clinging-shadows-stance',
    name: 'Clinging Shadows Stance',
    strikes: [{ name: 'shadow grasp', dice: 1, die: 'd4', damageType: 'void', group: 'brawling', traits: ['agile', 'grapple', 'reach', 'unarmed'] }],
  } as StanceDef;
  stances['wild-winds-stance'] = {
    id: 'wild-winds-stance',
    name: 'Wild Winds Stance',
    strikes: [{ name: 'wind crash', dice: 1, die: 'd6', damageType: 'bludgeoning', group: 'brawling', traits: ['agile', 'nonlethal', 'propulsive', 'unarmed'], range: 30 }],
  } as StanceDef;
  return con;
}

/** A monk who has taken the initiate feat named — both are 8th-level monk feats. */
const initiate = (featId: string) => build('monk', 8, { featPicks: { '8:class:0': featId } }) as Character;

const chipLabels = (host: HTMLElement) => [...host.querySelectorAll('.stance-chip')].map((b) => b.textContent!.trim());

describe('wild-winds-initiate and clinging-shadows-initiate: a stance carried by a SPELL', () => {
  // batch 031: wild-winds-initiate#stance
  it('wild-winds-initiate: the two stance-trait spells are the only records in this shape', () => {
    const con = c();
    const stanceSpells = Object.keys(con.spells).filter((id) => (con.spells[id].traits ?? []).includes('stance'));
    expect(stanceSpells.sort()).toEqual(['clinging-shadows-stance', 'wild-winds-stance']);
    expect(con.feats['wild-winds-initiate'].focusSpells).toEqual(['wild-winds-stance']);
    expect(con.feats['clinging-shadows-initiate'].focusSpells).toEqual(['clinging-shadows-stance']);
  });

  // batch 031: wild-winds-initiate#stance
  it('wild-winds-initiate: the monk gets a Wild Winds Stance chip', () => {
    const con = withStanceDefs();
    const ch = initiate('wild-winds-initiate');
    const { host, stop } = renderDom(<MainTab character={ch} content={con} onPlay={noop} />);
    const labels = chipLabels(host);
    stop();
    expect(labels).toContain('Wild Winds Stance');
  });

  // batch 031: clinging-shadows-initiate#shadow-grasp
  it('clinging-shadows-initiate: the monk gets a Clinging Shadows Stance chip that sets activeStance', () => {
    const con = withStanceDefs();
    const ch = initiate('clinging-shadows-initiate');
    let play: PlayState = initialPlay(ch, con);
    const onPlay = (fn: (p: PlayState) => PlayState) => {
      play = fn(play);
    };
    const { host, click, stop } = renderDom(<MainTab character={ch} content={con} onPlay={onPlay} />);
    click([...host.querySelectorAll('.stance-chip')].find((b) => b.textContent!.trim() === 'Clinging Shadows Stance') ?? null);
    stop();
    expect(play.activeStance).toBe('clinging-shadows-stance');
  });

  // batch 031: clinging-shadows-initiate#shadow-grasp
  it('clinging-shadows-initiate: shadow grasp is a MELEE unarmed Strike', () => {
    const con = withStanceDefs();
    const ch = { ...initiate('clinging-shadows-initiate'), activeStance: 'clinging-shadows-stance' } as Character;
    const grasp = deriveStrikes(ch, con).find((s) => s.name === 'shadow grasp');
    expect(grasp).toBeTruthy();
    expect(grasp!.ranged).toBe(false);
    expect(grasp!.range).toBeUndefined();
    expect(grasp!.damage).toContain('d4');
  });

  // batch 031: wild-winds-initiate#stance
  it('wild-winds-initiate: wind crash is a RANGED Strike at 30 feet, keyed off Dexterity', () => {
    // "You can make wind crash unarmed Strikes as ranged Strikes against targets within 30 feet"
    // (AoN spell-2062). Without the range carrier every stance Strike derived as a melee,
    // Strength-keyed unarmed attack — a wrong mechanic, not a missing one.
    const con = withStanceDefs();
    const ch = { ...initiate('wild-winds-initiate'), activeStance: 'wild-winds-stance' } as Character;
    const crash = deriveStrikes(ch, con).find((s) => s.name === 'wind crash');
    expect(crash).toBeTruthy();
    expect(crash!.ranged).toBe(true);
    expect(crash!.range).toBe(30);
    expect(crash!.atkAbility).toBe('dex');
  });

  // batch 031: wild-winds-initiate#stance
  it('wild-winds-initiate: wind crash is PROPULSIVE, so half Strength reaches its damage', () => {
    // "Propulsive: add half your Strength modifier to ranged damage with this weapon" — a ranged
    // unarmed Strike used to add nothing at all, and wind crash is the first in the corpus with the
    // trait. Compared against the SAME stance with `propulsive` stripped, so it pins the trait.
    const con = withStanceDefs();
    const ch = { ...initiate('wild-winds-initiate'), activeStance: 'wild-winds-stance' } as Character;
    const str = abilityModOf(ch, 'str');
    const withProp = deriveStrikes(ch, con).find((s) => s.name === 'wind crash')!;
    const bare = JSON.parse(JSON.stringify(con)) as ContentDatabase;
    bare.stances!['wild-winds-stance']!.strikes![0].traits = ['agile', 'nonlethal', 'unarmed'];
    const without = deriveStrikes(ch, bare).find((s) => s.name === 'wind crash')!;
    expect(without.dmgAbMod).toBe(0);
    expect(withProp.dmgAbMod).toBe(str > 0 ? Math.floor(str / 2) : str);
  });
});
