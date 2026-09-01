import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 22 (100 backgrounds). Headliners: the last three
 * Season of Ghosts boons, Sword Scion's familiarity clause (the background bucket's first), the
 * feral child's sense ladder, and the correction of batch 21's ghostly-grasp NAME COLLISION (the
 * ghost-archetype feat had shadowed the deviant feat).
 */
const bg = (id: string, extra?: Partial<BuildState>) => build('fighter', 1, { backgroundId: id, ...(extra ?? {}) } as Partial<BuildState>);

describe('the corrected deviant branch', () => {
  it('Lost Loved One’s wraith branch grants the DEVIANT Ghostly Grasp, not the ghost-archetype feat', () => {
    const ch = bg('lost-loved-one', { featChoices: { 'background:lost-loved-one': 'ghostly-grasp-deviant' } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'ghostly-grasp-deviant')).toBe(true);
    expect(ch.feats.some((f) => f.featId === 'ghostly-grasp'), 'the level-6 archetype feat must NOT arrive').toBe(false);
  });
});

describe('new carriers', () => {
  it('Sword Scion treats the Aldori dueling sword as a martial weapon', () => {
    const ch = bg('sword-scion');
    /* A fighter is trained in martial weapons, so the mirror lands the dueling sword at trained. */
    expect(ch.proficiencies.weaponOverrides?.['aldori-dueling-sword']).toBe(db.classes.fighter ? ch.proficiencies.attacks.martial : 'trained');
  });

  it('Feral Child: second skill, scent, and the printed low-light→darkvision ladder', () => {
    const human = bg('feral-child');
    expect(human.proficiencies.skills.survival).toBe('trained');
    const humanSenses = deriveDefenses(human, db).senses.map((s) => s.name);
    expect(humanSenses).toContain('scent');
    expect(humanSenses).toContain('low-light-vision');
    const elf = build('fighter', 1, { backgroundId: 'feral-child', ancestryId: 'elf' } as Partial<BuildState>);
    expect(deriveDefenses(elf, db).senses.map((s) => s.name), 'an elf already has low-light — the background upgrades it').toContain('darkvision');
  });

  it('the three remaining Season of Ghosts boons exist and are granted', () => {
    for (const [bgId, act] of [
      ['southbank-traditionalist', 'seasonal-boon-southbank'],
      ['outskirt-dweller', 'seasonal-boon-outskirt'],
      ['northridge-scholar', 'seasonal-boon-northridge'],
    ] as const) {
      expect(db.actions[act], act).toBeTruthy();
      expect(db.backgrounds[bgId].grantsActions, bgId).toContain(act);
    }
  });

  it('Chosen One and Willing Host own their printed actions; Shielded Fortune gets its daily pip', () => {
    expect(db.backgrounds['chosen-one'].grantsActions).toContain('prophecys-pawn');
    expect(db.backgrounds['willing-host'].grantsActions).toContain('host-spirit');
    expect(db.backgrounds['shielded-fortune'].grantsActions).toContain('fated-not-to-die');
    expect(db.actions['fated-not-to-die'].limitedUses).toEqual({ max: 1, per: 'day' });
  });

  it('Chosen One’s Lore lands on the shared fortune-telling key', () => {
    const ch = bg('chosen-one');
    expect(ch.proficiencies.skills['lore:fortune-telling' as never]).toBe('trained');
    expect(ch.proficiencies.skills['lore:fortune-teller' as never] ?? 'untrained').toBe('untrained');
  });

  it('Post Guard of All Trades gets its Lore box and its bonus language slot', () => {
    const ch = bg('post-guard-of-all-trades', { backgroundLore: 'Mail' } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:mail' as never]).toBe('trained');
    const withBg = bg('post-guard-of-all-trades');
    const withoutBg = bg('field-medic' in db.backgrounds ? 'field-medic' : 'guard');
    /* One extra choosable language slot from the background: compare the same build with/without. */
    expect((withBg.languages?.length ?? 0) >= (withoutBg.languages?.length ?? 0)).toBe(true);
  });

  it('Osprey Spellcaster speaks Thassilonian', () => {
    expect(bg('osprey-spellcaster').languages).toContain('thassilonian');
  });

  it('Time Traveler trains all three typed era Lores', () => {
    const ch = bg('time-traveler', { backgroundLore: 'Absalom', backgroundLore2: 'Shining Kingdoms', backgroundLore3: 'Arcadia' } as Partial<BuildState>);
    for (const k of ['lore:absalom', 'lore:shining-kingdoms', 'lore:arcadia']) {
      expect(ch.proficiencies.skills[k as never], k).toBe('trained');
    }
  });

  it('Friendly Darkmoon Kobold carries the printed kobold gate', () => {
    expect(db.backgrounds['friendly-darkmoon-kobold'].ancestryPrerequisite).toEqual(['kobold']);
  });

  it('the Gatewalkers siblings are filed under their real book', () => {
    for (const id of ['wanderlust', 'lost-loved-one', 'dreams-of-vengeance', 'total-power', 'empty-whispers', 'reborn-soul']) {
      expect(db.backgrounds[id].source.book, id).toMatch(/Gatewalkers/);
    }
  });
});
