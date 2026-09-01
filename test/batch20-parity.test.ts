import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveMaxHp } from '../src/rules/derive';
import { buildCharacter, checkPrerequisites, effectChoiceOffered, backgroundEffectiveBoosts, emptyBuild, type BuildState } from '../src/rules/build';
import { BACKGROUND_GRANT_BOUND_CHOICE, BACKGROUND_CANTRIP_GRANTS } from '../src/rules/backgroundGrants';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 20 (100 backgrounds). The recurring class was the
 * duplicate-carrier background (a `choice` firing beside trainedLore/trainedSkillChoice); the new
 * lanes are the background arms the bucket never had: granted items, water breathing, per-branch
 * Lores, an optional attribute trade, prerequisite waivers, sibling-gated effect choices and a
 * background pick-a-cantrip. Asserted on BUILT characters throughout.
 */

const bg = (id: string, extra?: Partial<BuildState>) => build('fighter', 1, { backgroundId: id, ...(extra ?? {}) } as Partial<BuildState>);

describe('the new background carriers deliver', () => {
  it('grantsItems: Sally Guard Neophyte starts with the printed gear', () => {
    const inv = (bg('sally-guard-neophyte').inventory ?? []).map((i) => i.itemId);
    for (const it of ['half-plate', 'longsword', 'lance', 'horse']) expect(inv, it).toContain(it);
  });

  it('breathesWater: Song of the Deep breathes underwater', () => {
    expect(deriveDefenses(bg('song-of-the-deep'), db).breathesWater).toBe(true);
  });

  it("Song of the Deep's Special opens a second free boost only when air is traded away", () => {
    const b = { ...emptyBuild(), backgroundId: 'song-of-the-deep' } as BuildState;
    expect(backgroundEffectiveBoosts(b, db.backgrounds['song-of-the-deep']).length).toBe(1);
    const traded = { ...b, featChoices: { 'background:song-of-the-deep': 'lose-air' } } as BuildState;
    expect(backgroundEffectiveBoosts(traded, db.backgrounds['song-of-the-deep']).length).toBe(2);
  });

  it('trainedLoreByChoice: a Brevic noble’s skill, Lore and feat move together', () => {
    const garess = bg('brevic-noble');
    expect(garess.proficiencies.skills.crafting).toBe('trained');
    expect(garess.proficiencies.skills['lore:architecture' as never]).toBe('trained');
    expect(garess.feats.some((f) => f.featId === 'specialty-crafting')).toBe(true);
    const lebeda = bg('brevic-noble', { backgroundSkillChoice: 'society' } as Partial<BuildState>);
    expect(lebeda.proficiencies.skills['lore:mercantile' as never]).toBe('trained');
    expect(lebeda.feats.some((f) => f.featId === 'multilingual')).toBe(true);
    expect(lebeda.proficiencies.skills['lore:architecture' as never] ?? 'untrained').toBe('untrained');
  });

  it('trainedLoreChoiceDefault: an unanswered Night Watch still trains Legal Lore', () => {
    expect(bg('night-watch').proficiencies.skills['lore:legal' as never]).toBe('trained');
    const typed = bg('night-watch', { backgroundLore: 'Absalom' } as Partial<BuildState>);
    expect(typed.proficiencies.skills['lore:absalom' as never]).toBe('trained');
    expect(typed.proficiencies.skills['lore:legal' as never] ?? 'untrained').toBe('untrained');
  });

  it('prerequisiteWaivers: Tall Tale meets Leverage Connections without its prerequisites', () => {
    const ch = bg('tall-tale');
    expect(checkPrerequisites(db.feats['leverage-connections'], ch, db).met).toBe(true);
    const other = bg('guard');
    expect(checkPrerequisites(db.feats['leverage-connections'], other, db).met, 'the waiver is Tall Tale’s alone').toBe(false);
  });

  it('requiresChoice: Magical Experiment asks the follow-up only for its own ability', () => {
    const rec = db.backgrounds['magical-experiment'];
    const sense = rec.effectChoices!.find((e) => e.id === 'enhanced-sense')!;
    const skin = rec.effectChoices!.find((e) => e.id === 'resistant-skin-yours')!;
    const withPick = (v: string) =>
      ({ ...emptyBuild(), backgroundId: 'magical-experiment', effectChoices: { 'magical-experiment:experiment-ability': v } }) as BuildState;
    expect(effectChoiceOffered(sense, withPick('enhanced-senses-darkvision'), db, 'magical-experiment')).toBe(true);
    expect(effectChoiceOffered(sense, withPick('resistant-skin'), db, 'magical-experiment')).toBe(false);
    expect(effectChoiceOffered(skin, withPick('resistant-skin'), db, 'magical-experiment')).toBe(true);
    expect(effectChoiceOffered(skin, withPick('touch-telepathy'), db, 'magical-experiment')).toBe(false);
  });

  it('the background pick-a-cantrip: Harrow-Chosen’s pick is an occult at-will cantrip', () => {
    expect(BACKGROUND_CANTRIP_GRANTS['harrow-chosen']).toBeTruthy();
    const ch = bg('harrow-chosen', { pickCantripChoices: { 'harrow-chosen': 'daze' } } as Partial<BuildState>);
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips).toContain('daze');
    expect(innate?.tradition).toBe('occult');
  });
});

describe('the duplicate-carrier class is closed', () => {
  it('Hermean Heritor grants EXACTLY the picked feat, and its Assurance is Society-bound', () => {
    expect(BACKGROUND_GRANT_BOUND_CHOICE['hermean-heritor']?.assurance).toEqual({ kind: 'fixed', skill: 'society' });
    const names = (b: ReturnType<typeof bg>) => b.feats.filter((f) => ['multilingual', 'assurance'].includes(f.featId)).map((f) => f.featId);
    expect(names(bg('hermean-heritor', { featChoices: { 'background:hermean-heritor': 'assurance' } } as Partial<BuildState>))).toEqual(['assurance']);
    expect(names(bg('hermean-heritor'))).toEqual(['multilingual']); // unanswered keeps the first option
  });

  it('a dup-Lore background trains exactly ONE Lore however it is answered', () => {
    const lores = (b: ReturnType<typeof bg>) =>
      Object.entries(b.proficiencies.skills).filter(([k, r]) => k.startsWith('lore:') && r !== 'untrained').map(([k]) => k);
    expect(lores(bg('conservator')).length).toBe(1);
    expect(lores(bg('weaver')).length).toBe(1);
    expect(lores(bg('remittance-agent')).length).toBe(1);
    expect(lores(bg('out-of-towner')).length).toBe(1);
  });

  it('Remittance Agent’s Lore key is normalized (no capitalized twin)', () => {
    const keys = Object.keys(bg('remittance-agent').proficiencies.skills).filter((k) => /^lore:/.test(k));
    expect(keys.every((k) => k === k.toLowerCase())).toBe(true);
  });
});

describe('smaller printed clauses', () => {
  it('Feybound owns its printed free action with its daily pip', () => {
    expect(db.backgrounds['feybound'].grantsActions).toContain('feys-fortune');
    expect(db.actions['feys-fortune']).toBeTruthy();
  });

  it('Seer of the Dead carries the always-on Spirit Sense stars, AC included', () => {
    const sit = db.backgrounds['seer-of-the-dead'].situational ?? [];
    expect(sit.length).toBe(4);
    expect(sit.some((s) => s.targets.some((t) => t.kind === 'ac')), 'print grants AC too — WG omits it, print wins').toBe(true);
  });

  it('Wishes for Riches asks the printed dragon-or-leech pick and pins the cold type', () => {
    const rec = db.backgrounds['aon-wishes-for-riches'];
    expect(rec.choice?.options?.map((o) => o.value).sort()).toEqual(['borrowed-ability', 'consume-energy']);
    const lim = rec.choiceOptionLimits?.[0];
    expect(lim?.target).toBe('dragon-deviant-classification');
    expect(lim?.allow.map((a) => a.value)).toEqual(['cold']);
    expect(lim?.requiresOwnChoice).toEqual(['consume-energy']);
  });

  it('Raised by Belief trains the deity’s divine skill', () => {
    const ch = bg('raised-by-belief', { deityId: 'sarenrae' } as Partial<BuildState>);
    expect(ch.proficiencies.skills.medicine).toBe('trained');
  });

  it('Always Chosen Last trains both printed Lores; Ruby Phoenix Fanatic all three', () => {
    const acl = bg('always-chosen-last').proficiencies.skills;
    expect(acl['lore:games' as never]).toBe('trained');
    expect(acl['lore:scouting' as never]).toBe('trained');
    const rpf = bg('ruby-phoenix-fanatic').proficiencies.skills;
    for (const k of ['lore:axis', 'lore:gladiatorial', 'lore:goka']) expect(rpf[k as never], k).toBe('trained');
  });
});
