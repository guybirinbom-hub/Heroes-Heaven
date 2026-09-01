import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import { FEAT_PICK_GRANTS } from '../src/rules/featPickGrants';
import { RECORD_MARKERS } from '../src/rules/situationalBonuses';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 23 (the LAST 83 backgrounds — the bucket is done).
 * Headliners: Energy Scarred's resistance+Lore finally riding its energy pick, Concordance
 * Researcher's four-of-six Plane Lores, Returned's bound Additional Lore taking the 3/7/15 ladder,
 * the fifth Season of Ghosts boon, and the slotless-grant Lore box that un-bricked the seven
 * backgrounds printing an UNBOUND Additional Lore.
 */
const bg = (id: string, extra?: Partial<BuildState>) => build('fighter', 1, { backgroundId: id, ...(extra ?? {}) } as Partial<BuildState>);

describe('single-carrier deletions (the choice lane is the one WG select)', () => {
  it('Corpse Stitcher grants exactly one feat — the choice answer, defaulting to Risky Surgery', () => {
    const ch = bg('corpse-stitcher');
    expect(ch.feats.filter((f) => f.featId === 'risky-surgery').length).toBe(1);
    expect(db.backgrounds['corpse-stitcher'].grantedFeatId).toBeUndefined();
  });

  it('Sponsored by a Stranger honors the pick instead of always granting Dubious Knowledge', () => {
    const quick = bg('sponsored-by-a-stranger', { featChoices: { 'background:sponsored-by-a-stranger': 'quick-identification' } } as Partial<BuildState>);
    expect(quick.feats.some((f) => f.featId === 'quick-identification')).toBe(true);
    expect(quick.feats.some((f) => f.featId === 'dubious-knowledge'), 'the flat grant must be gone').toBe(false);
    /* …and the FEAT_PICK_GRANTS row is deleted, so only ONE picker mounts. */
    expect(FEAT_PICK_GRANTS['sponsored-by-a-stranger']).toBeUndefined();
  });

  it('the duplicate second controls are gone from the five double-carrier records', () => {
    expect(db.backgrounds['noble'].trainedLoreChoice).toBeUndefined();
    expect(db.backgrounds['able-carter'].trainedLoreChoice).toBeUndefined();
    expect(db.backgrounds['elementally-infused'].trainedLoreChoice).toBeUndefined();
    expect(db.backgrounds['hired-killer'].choice).toBeUndefined();
    expect(db.backgrounds['dedicated-delver'].choice).toBeUndefined();
  });

  it('Junk Collector trains the PICKED Lore, not always Engineering', () => {
    const ch = bg('junk-collector', { featChoices: { 'background:junk-collector': 'mining' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:mining']).toBe('trained');
    expect(ch.proficiencies.skills['lore:engineering']).toBeUndefined();
  });
});

describe('Working Student: the Lore is a choice with Labor as the printed default', () => {
  it('untouched build still trains lore:labor; a typed subject replaces it', () => {
    expect(bg('working-student').proficiencies.skills['lore:labor']).toBe('trained');
    const typed = bg('working-student', { backgroundLore: 'Academia' } as Partial<BuildState>);
    expect(typed.proficiencies.skills['lore:academia']).toBe('trained');
    expect(typed.proficiencies.skills['lore:labor']).toBeUndefined();
  });
});

describe('new carriers', () => {
  it('Hunted by the Night starts with the three printed items (stake-and-mallet minted)', () => {
    expect(db.items['wooden-stake-and-mallet']).toBeTruthy();
    const inv = (bg('hunted-by-the-night').inventory ?? []).map((i) => i.itemId);
    for (const id of ['religious-symbol-wooden', 'holy-water', 'wooden-stake-and-mallet']) expect(inv, id).toContain(id);
  });

  it('Close Ties owns the fifth Season of Ghosts boon', () => {
    expect(db.actions['seasonal-boon-close-ties']).toBeTruthy();
    expect(db.actions['seasonal-boon-close-ties'].actionCost).toEqual({ type: 'free' });
    expect(db.backgrounds['close-ties'].grantsActions).toContain('seasonal-boon-close-ties');
  });

  it('printed frequencies and trait lines: Bestial Clarity, Stellar Misfortune, Reclaim Destiny', () => {
    expect(db.backgrounds['beast-blessed'].limitedUses).toEqual({ max: 1, per: 'day' });
    expect(db.actions['bestial-clarity'].traits).toContain('fortune');
    expect(db.actions['stellar-misfortune'].traits).toEqual(['divination', 'misfortune', 'occult']);
    expect(db.actions['reclaim-destiny'].traits).toEqual(['divination', 'occult']);
    expect(db.actions['reclaim-destiny'].limitedUses).toEqual({ max: 1, per: 'day' });
  });

  it('Hookclaw Digger: both printed Lores and the kobold gate', () => {
    const ch = bg('hookclaw-digger');
    expect(ch.proficiencies.skills['lore:mining']).toBe('trained');
    expect(ch.proficiencies.skills['lore:engineering']).toBe('trained');
    expect(db.backgrounds['hookclaw-digger'].ancestryPrerequisite).toEqual(['kobold']);
  });

  it('Amateur Director: Theater AND Scribing (persona-leader is unconditional here)', () => {
    const ch = bg('amateur-director');
    expect(ch.proficiencies.skills['lore:theater']).toBe('trained');
    expect(ch.proficiencies.skills['lore:scribing']).toBe('trained');
  });

  it('Fated Rival asks for TWO typed Lores', () => {
    const ch = bg('fated-rival', { backgroundLore: 'Warfare', backgroundLore2: 'Sailing' } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:warfare']).toBe('trained');
    expect(ch.proficiencies.skills['lore:sailing']).toBe('trained');
  });

  it('Runaway Noble: a genealogy/heraldry pick, defaulting to the first', () => {
    expect(bg('runaway-noble').proficiencies.skills['lore:genealogy']).toBe('trained');
    const her = bg('runaway-noble', { backgroundLore: 'heraldry' } as Partial<BuildState>);
    expect(her.proficiencies.skills['lore:heraldry']).toBe('trained');
    expect(her.proficiencies.skills['lore:genealogy']).toBeUndefined();
  });

  it('Kaiju Stalker offers the six level-1 Athletics feats, capped at level 1', () => {
    expect(FEAT_PICK_GRANTS['kaiju-stalker']?.maxLevel).toBe(1);
    expect(FEAT_PICK_GRANTS['kaiju-stalker']?.ids).toEqual(['combat-climber', 'hefty-hauler', 'quick-jump', 'titan-wrestler', 'underwater-marauder', 'armor-assist']);
  });

  it('Eclipseborn marks Cast a Spell with the misfortune rider (the un-numbered half of Ill Omen)', () => {
    expect(RECORD_MARKERS['eclipseborn']?.some((m) => m.on === 'action' && m.id === 'cast-a-spell')).toBe(true);
  });

  it('Anti-Magical: the DC 3 flat check is back in the text and warned on the sheet', () => {
    expect(db.backgrounds['anti-magical'].description).toContain('DC 3 flat check');
    expect(db.backgrounds['anti-magical'].dataWarning).toContain('DC 3 flat check');
    expect(bg('anti-magical').effectWarnings?.some((w) => w.message.includes('DC 3 flat check'))).toBe(true);
  });
});

describe('Concordance Researcher: four of the six Plane Lores', () => {
  it('an untouched build trains the first four; picks replace them', () => {
    const skills = bg('concordance-researcher').proficiencies.skills;
    for (const p of ['plane-of-air', 'plane-of-earth', 'plane-of-fire', 'plane-of-metal']) expect(skills[`lore:${p}`], p).toBe('trained');
    expect(Object.keys(skills).filter((k) => k.startsWith('lore:plane-of-')).length).toBe(4);

    const picked = bg('concordance-researcher', {
      backgroundLore: 'plane-of-wood', backgroundLore2: 'plane-of-water', backgroundLore3: 'plane-of-metal', backgroundLore4: 'plane-of-fire',
    } as Partial<BuildState>).proficiencies.skills;
    for (const p of ['plane-of-wood', 'plane-of-water', 'plane-of-metal', 'plane-of-fire']) expect(picked[`lore:${p}`], p).toBe('trained');
    expect(picked['lore:plane-of-air']).toBeUndefined();
  });
});

describe('Returned: the bound Additional Lore finally advances Boneyard Lore', () => {
  it('grants Diehard + Additional Lore, and Boneyard Lore takes the 3rd/7th/15th ladder', () => {
    const lv1 = bg('returned');
    expect(lv1.feats.some((f) => f.featId === 'diehard')).toBe(true);
    expect(lv1.feats.some((f) => f.featId === 'additional-lore')).toBe(true);
    expect(lv1.proficiencies.skills['lore:boneyard']).toBe('trained');
    expect(build('fighter', 7, { backgroundId: 'returned' } as Partial<BuildState>).proficiencies.skills['lore:boneyard']).toBe('master');
  });

  it('the UNBOUND siblings can finally type their subject (Pathfinder Hopeful), and it rides the ladder', () => {
    const ch = build('fighter', 3, { backgroundId: 'pathfinder-hopeful', featLoreChoices: { 'additional-lore:0': 'Warfare' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:warfare']).toBe('expert');
  });
});

describe('Energy Scarred: one pick drives Lore AND resistance', () => {
  it('defaults to the first energy: Acid Lore trained, acid resistance half level (min 1)', () => {
    const lv1 = bg('energy-scarred');
    expect(lv1.proficiencies.skills['lore:acid']).toBe('trained');
    expect(deriveDefenses(lv1, db).resistances.find((r) => r.type === 'acid')?.value).toBe(1);
    const lv8 = build('fighter', 8, { backgroundId: 'energy-scarred' } as Partial<BuildState>);
    expect(deriveDefenses(lv8, db).resistances.find((r) => r.type === 'acid')?.value).toBe(4);
  });

  it('a fire pick moves both: Fire Lore + fire resistance, and no acid leftovers', () => {
    const ch = build('fighter', 6, { backgroundId: 'energy-scarred', featChoices: { 'background:energy-scarred': 'fire' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:fire']).toBe('trained');
    expect(ch.proficiencies.skills['lore:acid']).toBeUndefined();
    const res = deriveDefenses(ch, db).resistances;
    expect(res.find((r) => r.type === 'fire')?.value).toBe(3);
    expect(res.find((r) => r.type === 'acid')).toBeUndefined();
  });
});

describe('Elementally Infused: the element pick carries plane Lore and the innate cantrip', () => {
  it('defaults to Air: Plane of Air Lore + Gale Blast at will, and no other element leaks', () => {
    const ch = bg('elementally-infused');
    expect(ch.proficiencies.skills['lore:plane-of-air']).toBe('trained');
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips).toContain('gale-blast');
    expect(innate?.cantrips ?? []).not.toContain('ignition');
  });

  it('a fire pick swaps both to the Plane of Fire', () => {
    const ch = bg('elementally-infused', { featChoices: { 'background:elementally-infused': 'plane-of-fire' } } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:plane-of-fire']).toBe('trained');
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips).toContain('ignition');
    expect(innate?.cantrips ?? []).not.toContain('gale-blast');
  });
});
