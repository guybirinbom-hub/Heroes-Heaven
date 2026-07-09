import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

const c = content();
const anc = Object.keys(c.ancestries)[0];
const bg = Object.keys(c.backgrounds)[0];

function barb(level: number, subclassId: string, rageOn: boolean): Character {
  const ch = buildCharacter(
    { ...emptyBuild(), name: 't', level, classId: 'barbarian', ancestryId: anc, backgroundId: bg, keyAbility: 'str', subclassId },
    c,
  );
  return { ...ch, classResources: { ...ch.classResources, rage: rageOn ? 1 : 0 } };
}

/** The Rage rider on the character's Fist (unarmed) Strike, if any. */
function rageRider(ch: Character) {
  const fist = deriveStrikes(ch, c).find((s) => /fist/i.test(s.name));
  return fist?.conditionalDamage?.find((r) => r.note.includes('raging')) ?? null;
}

describe('rage bonus damage (auto-applied while raging, melee/unarmed only)', () => {
  it('a raging Fury-instinct barbarian (L5) adds +3 rage to unarmed, flagged with a *', () => {
    const r = rageRider(barb(5, 'fury-instinct', true));
    expect(r).toBeTruthy();
    expect(r!.text).toContain('3');
    expect(r!.note).toContain('*');
  });

  it('no rage bonus when not raging', () => {
    expect(rageRider(barb(5, 'fury-instinct', false))).toBeNull();
  });

  it('Fury scales at Weapon Specialization (L7 → 7) and Greater (L15 → 13)', () => {
    expect(rageRider(barb(7, 'fury-instinct', true))!.text).toContain('7');
    expect(rageRider(barb(15, 'fury-instinct', true))!.text).toContain('13');
  });

  it('Dragon instinct rages for energy-typed +4 at low levels', () => {
    const r = rageRider(barb(5, 'dragon-instinct', true))!;
    expect(r.text).toContain('4');
    expect(r.text).toContain('energy');
  });

  it('Giant instinct rages for +6 and notes the larger weapon', () => {
    const r = rageRider(barb(5, 'giant-instinct', true))!;
    expect(r.text).toContain('6');
    expect(r.note).toMatch(/larger weapon/i);
  });

  it('Elemental / Decay / Ligneous / Bloodrager instincts use their own values (not the flat +2 fallback)', () => {
    // Elemental +4/+6/+12 energy; Decay +6/+10/+18 poison; Ligneous +6/+10/+18; Bloodrager +2/+4/+8.
    const el = rageRider(barb(15, 'elemental-instinct', true))!;
    expect(el.text).toContain('12');
    expect(el.text).toContain('energy');
    const decay = rageRider(barb(15, 'decay-instinct', true))!;
    expect(decay.text).toContain('18');
    expect(decay.text).toContain('poison');
    expect(rageRider(barb(15, 'ligneous-instinct', true))!.text).toContain('18');
    const blood = rageRider(barb(15, 'bloodrager', true))!;
    expect(blood.text).toContain('8'); // greater tier, not the flat +2
  });

  it('a non-barbarian with the Rage resource forced on gets no rider', () => {
    const f = buildCharacter(
      { ...emptyBuild(), name: 't', level: 5, classId: 'fighter', ancestryId: anc, backgroundId: bg, keyAbility: 'str', subclassId: null },
      c,
    );
    expect(rageRider({ ...f, classResources: { rage: 1 } } as Character)).toBeNull();
  });
});
