import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { deityDomainsOf, domainPoolFor, domainPoolForChoice, splinterDomainsOf } from '../src/rules/derive';
import { recordMarkersFor } from '../src/rules/explain';

/**
 * Records whose whole content is "the thing you already have gets better".
 *
 * Every other lane grants something outright, so these two could only be stated in prose:
 *  - Draconic Paragon gives additional effects to whichever of THREE prerequisite kobold feats you
 *    happen to have, and a kobold may have any combination of them.
 *  - Splinter Faith replaces which four domains your DEITY has, for you.
 *
 * The gate is the point. A registry entry keyed on Draconic Paragon alone would tell a kobold who
 * took only Benefactor's Strike that their Kobold Breath inflicts persistent damage.
 */
const c = () => content();

const kobold = (feats: Record<string, string>) =>
  build('fighter', 14, {
    ancestryId: 'kobold',
    heritageId: 'dragonscaled-kobold',
    featPicks: feats,
    effectChoices: {
      'dracomancer:dracomancer-rank1': 'fear',
      'dracomancer:dracomancer-rank2': 'invisibility',
    },
  });

const DRACO = { '9:ancestry:0': 'dracomancer', '13:ancestry:0': 'draconic-paragon' };

describe('Draconic Paragon — additional effects for a feat you already have', () => {
  it('adds a use per day to each spell Dracomancer granted, and to nothing else', () => {
    const withParagon = kobold(DRACO);
    const without = kobold({ '9:ancestry:0': 'dracomancer' });
    const uses = (ch: typeof withParagon) => ch.spellcasting.find((e) => e.id === 'innate-casting')?.innateUses ?? {};
    // Dracomancer grants each of its two picks once per day; the default 1/day is not stored, so the
    // absence of a key IS "once". With Draconic Paragon each becomes 2.
    expect(uses(without).fear ?? 1).toBe(1);
    expect(uses(withParagon).fear).toBe(2);
    expect(uses(withParagon)['invisibility']).toBe(2);
  });

  it('does nothing for a kobold who never took Dracomancer', () => {
    // Draconic Paragon's prerequisite is "Benefactor's Strike, Dracomancer, OR Kobold Breath", so a
    // character can legally have the feat and not the branch.
    const ch = kobold({ '5:ancestry:0': 'benefactors-strike', '13:ancestry:0': 'draconic-paragon' });
    expect(ch.spellcasting.find((e) => e.id === 'innate-casting')?.innateUses ?? {}).toEqual({});
    expect(ch.grantMarkers ?? {}).toEqual({});
  });

  it('marks the Kobold Breath action only when the character has Kobold Breath', () => {
    const both = kobold({ '1:ancestry:0': 'kobold-breath', '13:ancestry:0': 'draconic-paragon' });
    const marks = recordMarkersFor(both, c(), 'action', 'kobold-breath');
    expect(marks).toHaveLength(1);
    expect(marks[0].sourceId).toBe('draconic-paragon');
    expect(marks[0].value).toBe('3d4 persistent');
    expect(marks[0].note).toMatch(/critically fail/i);

    const paragonOnly = kobold({ '5:ancestry:0': 'benefactors-strike', '13:ancestry:0': 'draconic-paragon' });
    expect(recordMarkersFor(paragonOnly, c(), 'action', 'kobold-breath')).toEqual([]);
  });

  it('keeps the branch that was already built — the deadly d6 on jaws, claws and tail', () => {
    expect(c().feats['draconic-paragon'].unarmedTraits).toEqual({ match: ['jaw', 'claw', 'tail'], add: ['deadly-d6'] });
  });

  it('no longer carries a note saying the branches are not computed', () => {
    expect(c().feats['draconic-paragon'].note).toBeUndefined();
  });
});

describe('Splinter Faith — the four you chose ARE your deity’s domains', () => {
  // Sarenrae prints fire, light, sun, truth. A splinter faith takes four different ones.
  const PICKED = ['cities', 'family', 'freedom', 'nature'];
  const slot = '1:class:0';
  const splinter = (picks = PICKED) =>
    build('cleric', 8, {
      subclassId: 'cloistered-cleric',
      deityId: 'sarenrae',
      featPicks: { [slot]: 'splinter-faith' },
      featChoices: Object.fromEntries(picks.map((d, i) => [`${slot}#${i}`, d])),
    });

  it('replaces the deity domains the sheet reads', () => {
    const printed = c().deities.sarenrae.domains;
    const ch = splinter();
    expect(deityDomainsOf(ch, c()).domains).toEqual(PICKED);
    expect(deityDomainsOf(ch, c()).from).toBe('Splinter Faith');
    // …and a cleric of the same deity WITHOUT the feat still gets the printed four.
    const plain = build('cleric', 8, { subclassId: 'cloistered-cleric', deityId: 'sarenrae' });
    expect(deityDomainsOf(plain, c()).domains).toEqual(printed);
  });

  it('moves the displaced printed domains into the ALTERNATE list, as the feat says', () => {
    const printed = c().deities.sarenrae.domains;
    const alt = deityDomainsOf(splinter(), c()).alternateDomains;
    for (const d of printed) expect(alt, d).toContain(d);
    for (const d of PICKED) expect(alt, d).not.toContain(d);
  });

  it('feeds every OTHER domain picker the splinter list', () => {
    const ch = splinter();
    const b = { featPicks: { [slot]: 'splinter-faith' }, featChoices: Object.fromEntries(PICKED.map((d, i) => [`${slot}#${i}`, d])), deityId: 'sarenrae' };
    // Domain Initiate draws from `deity` — with the feat it must offer the four chosen ones.
    expect(domainPoolForChoice(b, c(), 'domain-initiate', 'deity')).toEqual(PICKED);
    expect(ch.deityDomains?.domains).toEqual(PICKED);
  });

  it('does NOT feed Splinter Faith its own answers', () => {
    // It draws from "your deity's domains, your deity's alternate domains" — the PRINTED lists. Fed
    // its own output it would offer the four already chosen and nothing else, and a player could
    // never change their mind.
    const b = { featPicks: { [slot]: 'splinter-faith' }, featChoices: Object.fromEntries(PICKED.map((d, i) => [`${slot}#${i}`, d])), deityId: 'sarenrae' };
    const pool = domainPoolForChoice(b, c(), 'splinter-faith', 'deity+alternate');
    expect(pool).toEqual(domainPoolFor('sarenrae', c(), 'deity+alternate'));
    for (const d of c().deities.sarenrae.domains) expect(pool, d).toContain(d);
  });

  it('does nothing until the four picks are answered', () => {
    const b = { featPicks: { [slot]: 'splinter-faith' }, featChoices: {}, deityId: 'sarenrae' };
    expect(splinterDomainsOf(b, c())).toBeNull();
    const ch = build('cleric', 8, { subclassId: 'cloistered-cleric', deityId: 'sarenrae', featPicks: { [slot]: 'splinter-faith' } });
    expect(ch.deityDomains).toBeUndefined();
    expect(deityDomainsOf(ch, c()).domains).toEqual(c().deities.sarenrae.domains);
  });

  it('no longer carries a note saying the swap is not enforced', () => {
    expect(c().feats['splinter-faith'].note).toBeUndefined();
    // The genuinely un-modelled clause stays where it was: a domain from neither printed list casts
    // its domain spell one rank lower, which is the player's to apply.
    expect(c().feats['splinter-faith'].choice?.note).toMatch(/1 rank lower/);
  });
});
