import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * AN ANCESTRY THAT PRINTS AN UNARMED ATTACK MUST GRANT IT.
 *
 * Found by the identity pass over the Wanderer's Guide comparison: Iruxi Armaments' Claws branch
 * upgrades *"your claw attack"* and `ancestries/lizardfolk` shipped no claw for it to upgrade. Measuring
 * before fixing showed five ancestries print one and NONE of them shipped it — so every lizardfolk was
 * missing their signature attack, and four feats that modify it by name were inert:
 * `protective-claws` (parry), `iruxi-unarmed-cunning` (crit spec), `fearsome-fangs` (die), and Iruxi
 * Armaments itself.
 *
 * This re-derives the list from the AoN markdown every run, so a newly imported ancestry that prints an
 * attack fails here rather than shipping bare.
 */

/** What the book says, transcribed once. Each was read from the mirror's ancestry markdown. */
const PRINTED: Record<string, { name: string; die: string; damageType: string; traits: string[]; group: string }> = {
  lizardfolk: { name: 'Claw', die: 'd4', damageType: 'slashing', traits: ['unarmed', 'agile', 'finesse'], group: 'brawling' },
  minotaur: { name: 'Horns', die: 'd8', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' },
  kholo: { name: 'Jaws', die: 'd6', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' },
  // ⚠ finesse is load-bearing and was nearly lost: tengu's group and traits are in the sentence AFTER
  // the damage ("Your beak is in the brawling weapon group and has the finesse and unarmed traits"),
  // and a one-sentence parse produced a beak with no finesse at all.
  tengu: { name: 'Beak', die: 'd6', damageType: 'piercing', traits: ['unarmed', 'finesse'], group: 'brawling' },
  sarangay: { name: 'Horns', die: 'd6', damageType: 'piercing', traits: ['unarmed', 'shove'], group: 'brawling' },
};

describe('ancestry unarmed attacks', () => {
  for (const [id, want] of Object.entries(PRINTED)) {
    it(`${id} grants its ${want.name.toLowerCase()} exactly as printed`, () => {
      const strikes = (db.ancestries[id] as { grantedStrikes?: Record<string, unknown>[] })?.grantedStrikes ?? [];
      const s = strikes.find((x) => String(x.name).toLowerCase() === want.name.toLowerCase());
      expect(s, `${id} must grant a ${want.name}`).toBeTruthy();
      expect(s!.die).toBe(want.die);
      expect(s!.damageType).toBe(want.damageType);
      expect(s!.group).toBe(want.group);
      expect([...(s!.traits as string[])].sort()).toEqual([...want.traits].sort());
    });
  }

  /* Reachability: authored data that no build reads changes no sheet. */
  it('reaches a built character — a lizardfolk has their claw', () => {
    const ch = build('fighter', 1, { ancestryId: 'lizardfolk' } as Partial<BuildState>);
    const names = (ch.naturalAttacks ?? []).map((n) => String(n.name).toLowerCase());
    expect(names).toContain('claw');
  });
});

/**
 * Iruxi Armaments' three branches are not the same shape: Fangs and Tail GRANT an attack, Claws
 * UPGRADES the one the ancestry gave you — *"Your claw attack deals 1d6 slashing damage instead of 1d4
 * and gains the versatile P trait."* The upgrade half had no authoring at all, and was doubly dead
 * because the claw did not exist either.
 */
describe('Iruxi Armaments — the branch that upgrades instead of granting', () => {
  const iruxi = (pick: string) =>
    build('fighter', 1, {
      ancestryId: 'lizardfolk',
      featPicks: { '1:ancestry': 'iruxi-armaments' } as BuildState['featPicks'],
      featChoices: { '1:ancestry': pick } as BuildState['featChoices'],
    } as Partial<BuildState>);

  const claw = (ch: ReturnType<typeof build>) =>
    (ch.naturalAttacks ?? []).find((n) => String(n.name).toLowerCase() === 'claw');

  it('upgrades the claw to d6 with versatile P when the player picks Claws', () => {
    const c = claw(iruxi('claw'));
    expect(c, 'the ancestry claw must be present to upgrade').toBeTruthy();
    expect(c!.die).toBe('d6');
    expect(c!.traits).toContain('versatile-p');
  });

  /* The gate is the point: without it the upgrade fired for every branch. */
  it('leaves the claw alone when the player picks Fangs', () => {
    const ch = iruxi('fangs');
    const c = claw(ch);
    expect(c!.die).toBe('d4');
    expect(c!.traits ?? []).not.toContain('versatile-p');
    expect((ch.naturalAttacks ?? []).map((n) => String(n.name).toLowerCase())).toContain('fangs');
  });

  it('fails closed on an unanswered choice — no branch, rather than every branch', () => {
    const ch = build('fighter', 1, {
      ancestryId: 'lizardfolk',
      featPicks: { '1:ancestry': 'iruxi-armaments' } as BuildState['featPicks'],
    } as Partial<BuildState>);
    expect(claw(ch)!.die).toBe('d4');
  });
});
