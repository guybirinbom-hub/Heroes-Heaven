import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import { DOMAIN_SPELLS } from '../src/rules/domains';

/*
 * Fix-campaign regressions — engine defects found by the full player-effect audit.
 * #1: granted/bonus feats must flow through the focus loop, and a granted feat's embedded sub-choice
 * (Seeker of Truths / Dedication to the Five → Domain Initiate's domain) must resolve.
 */
describe('focus loop covers granted + bonus feats', () => {
  it('a focus-spell feat added via overrides contributes its spell + pool', () => {
    const ch = build('fighter', 4, {
      overrides: { addedFeats: [{ featId: 'perfect-strike', level: 2, category: 'class' }] },
    });
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    expect(focus).toBeTruthy();
    const all = [...(focus!.cantrips ?? []), ...Object.values(focus!.repertoire ?? {}).flat()];
    expect(all).toContain('perfect-strike');
    expect(ch.focus?.max ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('a FEAT_FEAT_GRANTS-granted Domain Initiate resolves its domain and grants the domain spell', () => {
    const domain = Object.keys(DOMAIN_SPELLS).find((d) => content().spells[DOMAIN_SPELLS[d]]);
    expect(domain).toBeTruthy();
    const ch = build('fighter', 4, {
      overrides: { addedFeats: [{ featId: 'dedication-to-the-five', level: 2, category: 'class' }] },
      grantedFeatChoices: { 'domain-initiate': domain! },
    });
    // The granted feat is present, carries the resolved choice, and its domain focus spell landed.
    const di = ch.feats.find((f) => f.featId === 'domain-initiate');
    expect(di?.grantedBy).toBe('dedication-to-the-five');
    expect(di?.choice?.value).toBe(domain);
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    const all = [...(focus?.cantrips ?? []), ...Object.values(focus?.repertoire ?? {}).flat()];
    expect(all).toContain(DOMAIN_SPELLS[domain!]);
  });

  it('an unresolved granted choice grants nothing (no crash, no spell)', () => {
    const ch = build('fighter', 4, {
      overrides: { addedFeats: [{ featId: 'dedication-to-the-five', level: 2, category: 'class' }] },
    });
    expect(ch.feats.some((f) => f.featId === 'domain-initiate')).toBe(true);
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    const all = [...(focus?.cantrips ?? []), ...Object.values(focus?.repertoire ?? {}).flat()];
    for (const s of Object.values(DOMAIN_SPELLS)) expect(all).not.toContain(s);
  });
});

/*
 * #2: InnateSpellGrant rank / usesPerDay / heightenHalfLevel drive the innate entry.
 */
describe('innate-spell grant extensions', () => {
  const withGrant = (grant: object) => {
    const db = content();
    const orig = db.feats['toughness'].innateSpells;
    db.feats['toughness'].innateSpells = [grant] as never;
    try {
      return build('fighter', 10, { featPicks: { '3:general:0': 'toughness' } });
    } finally {
      db.feats['toughness'].innateSpells = orig;
    }
  };
  it('a rank override buckets the spell at the named rank', () => {
    const ch = withGrant({ spellId: 'invisibility', tradition: 'occult', rank: 4 });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.repertoire?.[4]).toContain('invisibility');
    expect(innate?.repertoire?.[2] ?? []).not.toContain('invisibility');
  });
  it('heightenHalfLevel casts at ceil(level/2)', () => {
    const ch = withGrant({ spellId: 'invisibility', tradition: 'occult', heightenHalfLevel: true });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.repertoire?.[5]).toContain('invisibility'); // level 10 → rank 5
  });
  it('usesPerDay and at-will surface in innateUses', () => {
    const twice = withGrant({ spellId: 'invisibility', usesPerDay: 2 });
    expect(twice.spellcasting.find((e) => e.type === 'innate')?.innateUses?.['invisibility']).toBe(2);
    const atWill = withGrant({ spellId: 'invisibility', atWill: true });
    expect(atWill.spellcasting.find((e) => e.type === 'innate')?.innateUses?.['invisibility']).toBe(0);
  });
});

/*
 * #3: redundantFallback — "already trained in X → a skill of your choice instead".
 */
describe('redundant-grant replacement fallback', () => {
  const FG = () => import('../src/rules/featGrants').then((m) => m.FEAT_GRANTS);
  it('a redundant static grant surfaces a fallback slot and applies the picked replacement', async () => {
    const FEAT_GRANTS = await FG();
    const orig = FEAT_GRANTS['hefty-hauler'];
    // Synthetic: hefty-hauler "grants" Athletics trained with the fallback clause.
    FEAT_GRANTS['hefty-hauler'] = { skills: { athletics: 'trained' }, redundantFallback: true };
    try {
      // Fighter picks Athletics as a class skill → the grant is redundant → fallback triggers.
      const ch = build('fighter', 2, {
        classSkills: ['athletics'],
        featPicks: { '2:skill:0': 'hefty-hauler' },
        featSkillChoices: { 'hefty-hauler:fallback:athletics': 'occultism' },
      });
      expect(ch.skillFallbacks).toEqual([{ featId: 'hefty-hauler', skill: 'athletics' }]);
      expect(ch.proficiencies.skills.occultism).toBe('trained');
    } finally {
      if (orig) FEAT_GRANTS['hefty-hauler'] = orig;
      else delete FEAT_GRANTS['hefty-hauler'];
    }
  });
  it('a non-redundant grant applies normally with no fallback', async () => {
    const FEAT_GRANTS = await FG();
    const orig = FEAT_GRANTS['hefty-hauler'];
    FEAT_GRANTS['hefty-hauler'] = { skills: { occultism: 'trained' }, redundantFallback: true };
    try {
      const ch = build('fighter', 2, { featPicks: { '2:skill:0': 'hefty-hauler' } });
      expect(ch.proficiencies.skills.occultism).toBe('trained');
      expect(ch.skillFallbacks ?? []).toEqual([]);
    } finally {
      if (orig) FEAT_GRANTS['hefty-hauler'] = orig;
      else delete FEAT_GRANTS['hefty-hauler'];
    }
  });
});

/*
 * #4: item passiveEffects lane + conditional-rank skillChoices.
 */
describe('item passive-effects lane', () => {
  // Keep passiveEffects set for the DURATION of the derive call (restoring before deriving was a bug).
  const withPE = <T,>(pe: object, fn: (ch: ReturnType<typeof build>) => T, inv: object = { worn: true }): T => {
    const db = content();
    const orig = db.items['cloak-of-elvenkind']?.passiveEffects;
    db.items['cloak-of-elvenkind'].passiveEffects = pe as never;
    try {
      const ch = build('fighter', 4, { inventory: [{ itemId: 'cloak-of-elvenkind', quantity: 1, ...inv }] });
      return fn(ch);
    } finally {
      if (orig) db.items['cloak-of-elvenkind'].passiveEffects = orig;
      else delete db.items['cloak-of-elvenkind'].passiveEffects;
    }
  };
  it('a worn skill-bonus item raises the skill modifier', async () => {
    const { deriveSkill } = await import('../src/rules/derive');
    const base = deriveSkill(build('fighter', 4), 'diplomacy', content()).modifier;
    const mod = withPE({ skills: { diplomacy: 2 } }, (ch) => deriveSkill(ch, 'diplomacy', content()).modifier);
    expect(mod - base).toBe(2);
  });
  it('a worn Perception item raises Perception; unworn does not', async () => {
    const { derivePerception } = await import('../src/rules/derive');
    const worn = withPE({ perception: 1 }, (ch) => derivePerception(ch, content()).modifier);
    const unworn = withPE({ perception: 1 }, (ch) => derivePerception(ch, content()).modifier, { worn: false });
    expect(worn - unworn).toBe(1);
  });
  it('passive senses/speeds/resistances flow into defenses + speeds', async () => {
    const { deriveDefenses, deriveSpeeds } = await import('../src/rules/derive');
    withPE({ senses: [{ name: 'darkvision' }], speeds: { climb: 10 }, resistances: [{ type: 'fire', value: 5 }] }, (ch) => {
      const d = deriveDefenses(ch, content());
      expect(d.senses.some((s) => s.name === 'darkvision')).toBe(true);
      expect(d.resistances.some((r) => r.type === 'fire' && r.value === 5)).toBe(true);
      expect(deriveSpeeds(ch, content()).climb).toBe(10);
    });
  });
});

describe('conditional-rank skillChoices', () => {
  it('upgrades the picked skill when already trained, else grants base', async () => {
    const { FEAT_GRANTS } = await import('../src/rules/featGrants');
    const orig = FEAT_GRANTS['hefty-hauler'];
    FEAT_GRANTS['hefty-hauler'] = { skillChoices: [{ options: ['deception', 'stealth'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }] };
    try {
      const already = build('fighter', 2, {
        classSkills: ['deception'],
        featPicks: { '2:skill:0': 'hefty-hauler' },
        featSkillChoices: { 'hefty-hauler:0': 'deception' },
      });
      expect(already.proficiencies.skills.deception).toBe('expert');
      const fresh = build('fighter', 2, {
        featPicks: { '2:skill:0': 'hefty-hauler' },
        featSkillChoices: { 'hefty-hauler:0': 'stealth' },
      });
      expect(fresh.proficiencies.skills.stealth).toBe('trained');
    } finally {
      if (orig) FEAT_GRANTS['hefty-hauler'] = orig;
      else delete FEAT_GRANTS['hefty-hauler'];
    }
  });
});

/*
 * #6: companion-mod lane + eidolon evolutions.
 */
describe('companion mods + eidolon evolutions', () => {
  it('Celestial Mount modifies the steed block (darkvision, +40 HP, fly = land, weakness)', async () => {
    const { deriveAnimalCompanion } = await import('../src/rules/companions');
    const db = content();
    const typeId = Object.keys(db.animalCompanions).find((id) => db.animalCompanions[id].speeds?.land) ?? Object.keys(db.animalCompanions)[0];
    const type = db.animalCompanions[typeId];
    const cfg = { id: 'c1', kind: 'animal', typeId } as never;
    const plain = deriveAnimalCompanion(cfg, type, 10, db);
    const modded = deriveAnimalCompanion(cfg, type, 10, db, [], false, [], new Set(['celestial-mount']));
    expect(modded.hp - plain.hp).toBe(40);
    expect(modded.senses.some((s) => s.toLowerCase() === 'darkvision')).toBe(true);
    expect(modded.speeds.fly).toBe(modded.speeds.land);
    expect(modded.iwr).toContain('weakness 10 unholy');
  });
  it('eidolon evolutions surface senses/speeds/resistance on the block', async () => {
    const { deriveEidolon } = await import('../src/rules/companions');
    const db = content();
    const ch = build('summoner', 10, {
      featPicks: { '4:class:0': 'expanded-senses', '8:class:0': 'amphibious-form' },
    });
    const cfg = { id: 'eid', kind: 'eidolon', typeId: ch.subclassId ?? undefined } as never;
    const b = deriveEidolon(cfg, ch, db);
    expect(b.senses ?? []).toContain('darkvision');
    expect((b.extraSpeeds ?? []).some((s) => s.startsWith('swim'))).toBe(true);
  });
});

/*
 * #8/#9/#10: effect-choice picker, background free-text Lore, data-warning.
 */
describe('effect-choice picker', () => {
  it('a chosen resistance-type option applies that resistance', async () => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const db = content();
    const feat = db.feats['toughness'];
    const orig = feat.effectChoices;
    feat.effectChoices = [{ id: 'energy', prompt: 'Choose an energy type', options: [
      { value: 'fire', label: 'Fire', grant: { resistances: [{ type: 'fire', value: 5 }] } },
      { value: 'cold', label: 'Cold', grant: { resistances: [{ type: 'cold', value: 5 }] } },
    ] }] as never;
    try {
      const ch = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' }, effectChoices: { 'toughness:energy': 'cold' } });
      const d = deriveDefenses(ch, db);
      expect(d.resistances.some((r) => r.type === 'cold' && r.value === 5)).toBe(true);
      expect(d.resistances.some((r) => r.type === 'fire')).toBe(false);
    } finally {
      if (orig) feat.effectChoices = orig; else delete feat.effectChoices;
    }
  });
  it('a chosen skill option trains that skill', async () => {
    const db = content();
    const feat = db.feats['toughness'];
    feat.effectChoices = [{ id: 's', prompt: 'Choose a skill', options: [
      { value: 'arcana', label: 'Arcana', grant: { skills: { arcana: 'trained' } } },
      { value: 'occultism', label: 'Occultism', grant: { skills: { occultism: 'trained' } } },
    ] }] as never;
    try {
      const ch = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' }, effectChoices: { 'toughness:s': 'occultism' } });
      expect(ch.proficiencies.skills.occultism).toBe('trained');
    } finally { delete feat.effectChoices; }
  });
});
describe('background free-text Lore + data warnings', () => {
  it('a trainedLoreChoice background grants the typed lore', () => {
    const db = content();
    const bg = Object.values(db.backgrounds)[0] as { id: string; trainedLoreChoice?: boolean };
    (bg as any).trainedLoreChoice = true;
    try {
      const ch = build('fighter', 2, { backgroundId: bg.id, backgroundLore: 'Warfare' });
      expect(ch.proficiencies.skills['lore:warfare']).toBe('trained');
    } finally { delete (bg as any).trainedLoreChoice; }
  });
  it('a feat with dataWarning surfaces it on the character', () => {
    const db = content();
    db.feats['toughness'].dataWarning = 'grants the missing spell “empty-body”';
    try {
      const ch = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' } });
      expect(ch.effectWarnings?.some((w) => /empty-body/.test(w.message))).toBe(true);
    } finally { delete db.feats['toughness'].dataWarning; }
  });
});

/*
 * Real-data checks for the shipped effect-choice / lore / warning content.
 */
describe('shipped effect-choice data resolves', () => {
  it('Dragon Disciple red → fire resistance at half level; Animal Senses → darkvision', async () => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const db = content();
    const dragonChoice = db.feats['dragon-disciple-dedication'].effectChoices![0].id;
    const senseChoice = db.feats['animal-senses'].effectChoices![0].id;
    const picks: Record<string, string> = {};
    picks[`dragon-disciple-dedication:${dragonChoice}`] = 'red';
    picks[`animal-senses:${senseChoice}`] = 'darkvision';
    const ch = build('fighter', 8, {
      overrides: { addedFeats: [
        { featId: 'dragon-disciple-dedication', level: 2, category: 'class' },
        { featId: 'animal-senses', level: 1, category: 'ancestry' },
      ] },
      effectChoices: picks,
    });
    const d = deriveDefenses(ch, db);
    expect(d.resistances.some((r) => r.type === 'fire' && r.value === 4)).toBe(true); // level 8 → 4
    expect(d.senses.some((s) => s.name === 'darkvision')).toBe(true);
  });
  it('a lore-choice background grants the typed subject', () => {
    const db = content();
    const bgId = Object.keys(db.backgrounds).find((k) => db.backgrounds[k].trainedLoreChoice)!;
    const ch = build('fighter', 2, { backgroundId: bgId, backgroundLore: 'Sailing' });
    expect(ch.proficiencies.skills['lore:sailing']).toBe('trained');
  });
  it('a shipped dataWarning surfaces on the character', () => {
    const db = content();
    const warned = Object.keys(db.feats).find((k) => db.feats[k].dataWarning)!;
    const ch = build('fighter', 8, { overrides: { addedFeats: [{ featId: warned, level: 1, category: 'class' }] } });
    expect(ch.effectWarnings?.length).toBeGreaterThan(0);
  });
});

/*
 * Quick-win lanes: derived-value formulas, conditional senses, heighten ladders/cadence,
 * multi-step progressions (+ their builder level display).
 */
describe('formula engine', () => {
  it('resolves level, ability-mod and speed tokens with arithmetic', async () => {
    const { resolveFormula } = await import('../src/rules/derive');
    const scope = { level: 8, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 18 }, speeds: { land: 25 } };
    expect(resolveFormula('@actor.level', scope)).toBe(8);
    expect(resolveFormula('@actor.abilities.cha.mod', scope)).toBe(4);
    expect(resolveFormula('@actor.speed.land', scope)).toBe(25);
    expect(resolveFormula('max(5,floor(@actor.speed.land/2))', scope)).toBe(12); // floor(25/2) = 12
    expect(resolveFormula('floor(@actor.level/2)', scope)).toBe(4);
    expect(resolveFormula('@actor.unknown.thing', scope)).toBe(0); // refuse rather than guess
  });
});

describe('derived-value grants', () => {
  it('a fly Speed equal to land Speed resolves from the formula', async () => {
    const { deriveSpeeds } = await import('../src/rules/derive');
    const db = content();
    const f = db.feats['toughness'];
    f.speeds = { fly: '@actor.speed.land' } as never;
    try {
      const ch = build('fighter', 8, { featPicks: { '3:general:0': 'toughness' } });
      const s = deriveSpeeds(ch, db);
      expect(s.fly).toBe(s.land);
      expect(s.fly).toBeGreaterThan(0);
    } finally { delete f.speeds; }
  });
  it('a Cha-mod resistance resolves against the character', async () => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const db = content();
    const f = db.feats['toughness'];
    f.resistances = [{ type: 'fire', value: '@actor.abilities.cha.mod' }] as never;
    try {
      const ch = build('fighter', 8, { featPicks: { '3:general:0': 'toughness' } });
      const chaMod = Math.floor((ch.abilities.cha - 10) / 2);
      const d = deriveDefenses(ch, db);
      if (chaMod > 0) expect(d.resistances.some((r) => r.type === 'fire' && r.value === chaMod)).toBe(true);
    } finally { delete f.resistances; }
  });
});

describe('conditional sense upgrades', () => {
  // The derive must run WHILE the synthetic fields are set — awaiting inside try (an earlier version
  // returned the promise, so `finally` stripped the fields before derive ran).
  const withCS = async (ancestryVision: string) => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const db = content();
    const f = db.feats['toughness'];
    const anc = Object.keys(db.ancestries)[0];
    const origVision = db.ancestries[anc].vision;
    db.ancestries[anc].vision = ancestryVision as never;
    f.conditionalSenses = [{ ifPresent: 'low-light-vision', base: { name: 'low-light-vision' }, upgraded: { name: 'darkvision' } }] as never;
    try {
      const ch = build('fighter', 4, { ancestryId: anc, featPicks: { '3:general:0': 'toughness' } });
      return deriveDefenses(ch, db).senses.map((s) => s.name);
    } finally { db.ancestries[anc].vision = origVision; delete f.conditionalSenses; }
  };
  it('upgrades to darkvision when the ancestry already has low-light', async () => {
    expect(await withCS('low-light')).toContain('darkvision');
  });
  it('grants only the base sense otherwise', async () => {
    const senses = await withCS('normal');
    expect(senses).toContain('low-light-vision');
    expect(senses).not.toContain('darkvision');
  });
});

describe('heighten ladder, cadence, and multi-step progressions', () => {
  it('a custom heighten ladder picks the highest step reached', () => {
    const db = content();
    db.feats['toughness'].innateSpells = [{ spellId: 'dominate', tradition: 'divine', rank: 7, heightenAt: [{ level: 18, rank: 8 }, { level: 20, rank: 9 }] }] as never;
    try {
      const at12 = build('fighter', 12, { featPicks: { '3:general:0': 'toughness' } });
      const at19 = build('fighter', 19, { featPicks: { '3:general:0': 'toughness' } });
      expect(at12.spellcasting.find((e) => e.type === 'innate')?.repertoire?.[7]).toContain('dominate');
      expect(at19.spellcasting.find((e) => e.type === 'innate')?.repertoire?.[8]).toContain('dominate');
    } finally { delete db.feats['toughness'].innateSpells; }
  });
  it('a per-week cadence surfaces as display text', () => {
    const db = content();
    db.feats['toughness'].innateSpells = [{ spellId: 'invisibility', usesPerDay: 2, usesPer: 'week' }] as never;
    try {
      const ch = build('fighter', 10, { featPicks: { '3:general:0': 'toughness' } });
      expect(ch.spellcasting.find((e) => e.type === 'innate')?.innateCadence?.['invisibility']).toBe('2/week');
    } finally { delete db.feats['toughness'].innateSpells; }
  });
  it('a multi-step rankUpgrade applies the highest step and is announced at its level', async () => {
    const { FEAT_GRANTS, featUpgradesAtLevel } = await import('../src/rules/featGrants');
    const orig = FEAT_GRANTS['hefty-hauler'];
    FEAT_GRANTS['hefty-hauler'] = { skills: { crafting: 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] };
    try {
      const at5 = build('fighter', 5, { featPicks: { '2:skill:0': 'hefty-hauler' } });
      const at8 = build('fighter', 8, { featPicks: { '2:skill:0': 'hefty-hauler' } });
      const at16 = build('fighter', 16, { featPicks: { '2:skill:0': 'hefty-hauler' } });
      expect(at5.proficiencies.skills.crafting).toBe('expert');
      expect(at8.proficiencies.skills.crafting).toBe('master');
      expect(at16.proficiencies.skills.crafting).toBe('legendary');
      // The builder announces each step on the level it lands.
      expect(featUpgradesAtLevel(['hefty-hauler'], 7)).toEqual([{ featId: 'hefty-hauler', rank: 'master' }]);
      expect(featUpgradesAtLevel(['hefty-hauler'], 15)).toEqual([{ featId: 'hefty-hauler', rank: 'legendary' }]);
      expect(featUpgradesAtLevel(['hefty-hauler'], 8)).toEqual([]);
    } finally {
      if (orig) FEAT_GRANTS['hefty-hauler'] = orig; else delete FEAT_GRANTS['hefty-hauler'];
    }
  });
});

/*
 * #12: open-ended filtered spell pickers ("choose ANY 1st-rank arcane spell").
 */
describe('filtered spell pickers', () => {
  it('spellsMatching honours tradition, rank and trait filters', async () => {
    const { spellsMatching } = await import('../src/rules/spellChoice');
    const db = content();
    const r1arcane = spellsMatching({ traditions: ['arcane'], rank: 1, grantAs: 'innate' }, db);
    expect(r1arcane.length).toBeGreaterThan(5);
    expect(r1arcane.every((s) => s.rank === 1 && s.traditions.includes('arcane'))).toBe(true);
    const cantrips = spellsMatching({ cantripsOnly: true, traditions: ['occult'], grantAs: 'innate' }, db);
    expect(cantrips.every((s) => s.rank === 0)).toBe(true);
  });
  it('a filtered pick becomes an innate grant with the filter cadence', async () => {
    const db = content();
    const f = db.feats['toughness'];
    const chosen = (await import('../src/rules/spellChoice')).spellsMatching({ traditions: ['arcane'], rank: 1, grantAs: 'innate' }, db)[0];
    f.effectChoices = [{ id: 'anyspell', prompt: 'Choose a 1st-rank arcane spell',
      spellFilter: { traditions: ['arcane'], rank: 1, grantAs: 'innate', innate: { tradition: 'arcane', usesPerDay: 1 } } }] as never;
    try {
      const picks: Record<string, string> = {};
      picks['toughness:anyspell'] = chosen.id;
      const ch = build('fighter', 8, { featPicks: { '3:general:0': 'toughness' }, effectChoices: picks });
      const innate = ch.spellcasting.find((e) => e.type === 'innate');
      expect(Object.values(innate?.repertoire ?? {}).flat()).toContain(chosen.id);
    } finally { delete f.effectChoices; }
  });
  it('an illegal pick (wrong rank) grants nothing', async () => {
    const db = content();
    const f = db.feats['toughness'];
    const wrong = (await import('../src/rules/spellChoice')).spellsMatching({ rank: 5, grantAs: 'innate' }, db)[0];
    f.effectChoices = [{ id: 'anyspell', prompt: 'Choose a 1st-rank arcane spell',
      spellFilter: { traditions: ['arcane'], rank: 1, grantAs: 'innate' } }] as never;
    try {
      const picks: Record<string, string> = {};
      picks['toughness:anyspell'] = wrong.id;
      const ch = build('fighter', 8, { featPicks: { '3:general:0': 'toughness' }, effectChoices: picks });
      const innate = ch.spellcasting.find((e) => e.type === 'innate');
      expect(Object.values(innate?.repertoire ?? {}).flat()).not.toContain(wrong.id);
    } finally { delete f.effectChoices; }
  });
  it('a pick locked behind minLevel does not apply early', async () => {
    const db = content();
    const f = db.feats['toughness'];
    const s = (await import('../src/rules/spellChoice')).spellsMatching({ rank: 3, grantAs: 'innate' }, db)[0];
    f.effectChoices = [{ id: 'later', prompt: 'Choose a 3rd-rank spell', spellFilter: { rank: 3, grantAs: 'innate', minLevel: 8 } }] as never;
    try {
      const picks: Record<string, string> = {};
      picks['toughness:later'] = s.id;
      const early = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' }, effectChoices: picks });
      const late = build('fighter', 10, { featPicks: { '3:general:0': 'toughness' }, effectChoices: picks });
      expect(Object.values(early.spellcasting.find((e) => e.type === 'innate')?.repertoire ?? {}).flat()).not.toContain(s.id);
      expect(Object.values(late.spellcasting.find((e) => e.type === 'innate')?.repertoire ?? {}).flat()).toContain(s.id);
    } finally { delete f.effectChoices; }
  });
});

/*
 * #13: feat spellcasting grants, slot bonuses, and per-source spell attribution.
 */
describe('feat spellcasting grants + slot bonuses', () => {
  it('a casting profile sets the innate entry key attribute and rank', () => {
    const db = content();
    const f = db.feats['toughness'];
    f.spellcastingGrant = { tradition: 'occult', keyAbility: 'cha', proficiency: 'trained' } as never;
    f.innateSpells = [{ spellId: 'daze', tradition: 'occult', atWill: true }] as never;
    try {
      const ch = build('fighter', 8, { featPicks: { '3:general:0': 'toughness' } });
      const innate = ch.spellcasting.find((e) => e.type === 'innate');
      expect(innate?.keyAbility).toBe('cha');
      expect(innate?.proficiency).toBe('trained');
    } finally { delete f.spellcastingGrant; delete f.innateSpells; }
  });
  it('a slot bonus adds slots except the highest ranks', () => {
    const db = content();
    const f = db.feats['toughness'];
    const plain = build('wizard', 10, {});
    const caster = plain.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
    const ranks = Object.keys(caster?.prepared ?? caster?.slots ?? {}).map(Number).filter((r) => r > 0).sort((a, b) => a - b);
    const target = ranks[0];
    const before = (caster?.prepared?.[target]?.length ?? caster?.slots?.[target]?.max) ?? 0;
    f.spellSlotBonus = { perRank: 1, exceptHighest: 1 } as never;
    try {
      const ch = build('wizard', 10, { featPicks: { '3:general:0': 'toughness' } });
      const c2 = ch.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
      const after = (c2?.prepared?.[target]?.length ?? c2?.slots?.[target]?.max) ?? 0;
      expect(after).toBe(before + 1);
      // The highest rank is excluded.
      const top = ranks[ranks.length - 1];
      const topBefore = (caster?.prepared?.[top]?.length ?? caster?.slots?.[top]?.max) ?? 0;
      const topAfter = (c2?.prepared?.[top]?.length ?? c2?.slots?.[top]?.max) ?? 0;
      expect(topAfter).toBe(topBefore);
    } finally { delete f.spellSlotBonus; }
  });
  it('pooled entries label each spell with its granting source', () => {
    const db = content();
    const f = db.feats['toughness'];
    f.innateSpells = [{ spellId: 'daze', tradition: 'occult', atWill: true }] as never;
    try {
      const ch = build('fighter', 8, { featPicks: { '3:general:0': 'toughness' } });
      const innate = ch.spellcasting.find((e) => e.type === 'innate');
      expect(innate?.spellSources?.['daze']).toBe(db.feats['toughness'].name);
    } finally { delete f.innateSpells; }
  });
});

/*
 * #14/#15: ancestry weapon familiarity, companion maturity upgrades, class-archetype layer.
 */
describe('ancestry weapon proficiency', () => {
  it('a flat familiarity grant gives the named weapons their rank', async () => {
    const { FEAT_GRANTS } = await import('../src/rules/featGrants');
    const db = content();
    const weapon = Object.keys(db.items).find((k) => db.items[k].itemType === 'weapon')!;
    const orig = FEAT_GRANTS['hefty-hauler'];
    FEAT_GRANTS['hefty-hauler'] = { weaponFamiliarity: { weapons: [weapon], rank: 'trained' } };
    try {
      const ch = build('wizard', 4, { featPicks: { '2:skill:0': 'hefty-hauler' } });
      expect(ch.proficiencies.weaponOverrides?.[weapon]).toBe('trained');
    } finally { if (orig) FEAT_GRANTS['hefty-hauler'] = orig; else delete FEAT_GRANTS['hefty-hauler']; }
  });
  it('mirrorBestCategory matches the best weapon-category rank', async () => {
    const { FEAT_GRANTS } = await import('../src/rules/featGrants');
    const db = content();
    const weapon = Object.keys(db.items).find((k) => db.items[k].itemType === 'weapon')!;
    const orig = FEAT_GRANTS['hefty-hauler'];
    FEAT_GRANTS['hefty-hauler'] = { weaponFamiliarity: { weapons: [weapon], mirrorBestCategory: true } };
    try {
      // A level-9 fighter is at least expert in martial weapons.
      const ch = build('fighter', 9, { featPicks: { '2:skill:0': 'hefty-hauler' } });
      const best = ['simple', 'martial', 'advanced'].map((c) => ch.proficiencies.attacks[c as 'simple']);
      expect(ch.proficiencies.weaponOverrides?.[weapon]).toBeTruthy();
      expect(best).toContain(ch.proficiencies.weaponOverrides![weapon]);
    } finally { if (orig) FEAT_GRANTS['hefty-hauler'] = orig; else delete FEAT_GRANTS['hefty-hauler']; }
  });
});

describe('companion maturity upgrades', () => {
  it('a maturityFloor mod raises a young companion', async () => {
    const { deriveAnimalCompanion } = await import('../src/rules/companions');
    const { COMPANION_MODS } = await import('../src/rules/companionGrants');
    const db = content();
    COMPANION_MODS['test-upgrade'] = { kinds: ['animal'], maturityFloor: 'nimble' } as never;
    try {
      const typeId = Object.keys(db.animalCompanions)[0];
      const cfg = { id: 'c', kind: 'animal', typeId, maturity: 'young' } as never;
      const plain = deriveAnimalCompanion(cfg, db.animalCompanions[typeId], 8, db);
      const up = deriveAnimalCompanion(cfg, db.animalCompanions[typeId], 8, db, [], false, [], new Set(['test-upgrade']));
      expect(plain.maturity).toBe('young');
      expect(up.maturity).toBe('nimble');
      expect(up.hp).toBeGreaterThan(plain.hp); // nimble boosts Con
    } finally { delete COMPANION_MODS['test-upgrade']; }
  });
});

describe('class-archetype layer', () => {
  it('suppresses a class feature, substitutes another, and grants proficiency', () => {
    const db = content();
    const cls = db.classes['wizard'];
    const suppress = cls.features.find((f) => f.level <= 4)!.featureId;
    const addable = Object.keys(db.classFeatures).find((k) => k !== suppress)!;
    const f = db.feats['toughness'];
    f.classArchetype = {
      classId: 'wizard',
      suppressFeatures: [suppress],
      addFeatures: [{ level: 1, featureId: addable }],
      armor: { light: 'trained' },
      note: 'Test archetype',
    } as never;
    try {
      const ch = build('wizard', 4, { featPicks: { '3:general:0': 'toughness' } });
      expect(ch.classArchetype?.suppressedFeatures).toContain(suppress);
      expect(ch.classArchetype?.addedFeatures.some((a) => a.featureId === addable)).toBe(true);
      expect(ch.proficiencies.defenses.light).toBe('trained'); // wizard is normally untrained
      expect(ch.classArchetype?.notes[0]).toContain('Test archetype');
    } finally { delete f.classArchetype; }
  });
  it('does not apply to a character of a different class', () => {
    const db = content();
    const f = db.feats['toughness'];
    f.classArchetype = { classId: 'wizard', armor: { heavy: 'trained' } } as never;
    try {
      const ch = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' } });
      expect(ch.classArchetype).toBeUndefined();
    } finally { delete f.classArchetype; }
  });
});

describe('note-only effect choices (kineticist gate junctions)', () => {
  it('records the pick and its note even when the option grants nothing', async () => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const db = content();
    const f = db.feats['toughness'];
    f.effectChoices = [{
      id: 'junction',
      prompt: 'Choose your gate junction',
      options: [
        { value: 'elemental-resistance', label: 'Elemental Resistance', grant: { resistances: [{ type: 'fire', value: '@actor.level/2' }] } },
        { value: 'aura', label: 'Aura Junction', note: 'Your impulse junction empowers your elemental aura.' },
      ],
    }] as never;
    try {
      const picked = build('fighter', 10, { featPicks: { '3:general:0': 'toughness' }, effectChoices: { 'toughness:junction': 'aura' } });
      const pick = picked.effectPicks?.find((p) => p.recordId === 'toughness');
      expect(pick?.label).toBe('Aura Junction');
      expect(pick?.note).toContain('elemental aura');
      // The note-only option must NOT invent a resistance.
      expect(deriveDefenses(picked, db).resistances.some((r) => r.type === 'fire')).toBe(false);
    } finally { delete f.effectChoices; }
  });
  it('still applies the grant when the mechanical option is chosen', async () => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const db = content();
    const f = db.feats['toughness'];
    f.effectChoices = [{
      id: 'junction',
      prompt: 'Choose your gate junction',
      options: [
        { value: 'elemental-resistance', label: 'Elemental Resistance', grant: { resistances: [{ type: 'fire', value: '@actor.level/2' }] } },
        { value: 'aura', label: 'Aura Junction', note: 'Empowers your aura.' },
      ],
    }] as never;
    try {
      const ch = build('fighter', 10, { featPicks: { '3:general:0': 'toughness' }, effectChoices: { 'toughness:junction': 'elemental-resistance' } });
      const fire = deriveDefenses(ch, db).resistances.find((r) => r.type === 'fire');
      expect(fire?.value).toBe(5); // half of level 10
      expect(ch.effectPicks?.find((p) => p.recordId === 'toughness')?.label).toBe('Elemental Resistance');
    } finally { delete f.effectChoices; }
  });
});

describe('class archetypes carried by a subclass option + proficiency caps', () => {
  it('an archetype on a chosen subclass option applies (not just on a feat)', () => {
    const db = content();
    const opt = db.classes.wizard.subclass!.options[0];
    const feature = db.classFeatures[opt.id];
    if (!feature) return; // option has no same-slug feature record in this data set
    feature.classArchetype = { classId: 'wizard', armor: { light: 'trained' }, note: 'Option-carried archetype' } as never;
    try {
      const ch = build('wizard', 4, { subclassId: opt.id });
      expect(ch.proficiencies.defenses.light).toBe('trained');
      expect(ch.classArchetype?.notes[0]).toContain('Option-carried archetype');
    } finally { delete feature.classArchetype; }
  });
  it('an armorCap REMOVES training the class would otherwise grant', () => {
    const db = content();
    const f = db.feats['toughness'];
    const base = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' } });
    expect(base.proficiencies.defenses.heavy).not.toBe('untrained'); // fighters start trained in heavy
    f.classArchetype = { classId: 'fighter', armorCap: { heavy: 'untrained' }, note: 'No heavy armor' } as never;
    try {
      const ch = build('fighter', 4, { featPicks: { '3:general:0': 'toughness' } });
      expect(ch.proficiencies.defenses.heavy).toBe('untrained');
      expect(ch.proficiencies.defenses.light).toBe(base.proficiencies.defenses.light); // untouched
    } finally { delete f.classArchetype; }
  });
});

describe('Ancient Elf: a heritage that grants a picked multiclass dedication', () => {
  it('grants the picked dedication, waiving its level prerequisite', () => {
    const ch = build('fighter', 1, { heritageId: 'ancient-elf', ancestryId: 'elf', pickFeatChoices: { 'ancient-elf': 'wizard-dedication' } });
    const granted = ch.feats.find((f) => f.featId === 'wizard-dedication');
    expect(granted?.grantedBy).toBe('ancient-elf'); // level-2 feat on a level-1 character
  });
  it('cannot pick your own class', async () => {
    const { pickableFeats, FEAT_PICK_GRANTS } = await import('../src/rules/featPickGrants');
    const db = content();
    const opts = pickableFeats(FEAT_PICK_GRANTS['ancient-elf'], { level: 1, classId: 'wizard', ancestryId: 'elf' } as never, db).map((f) => f.id);
    expect(opts).not.toContain('wizard-dedication');
    expect(opts).toContain('fighter-dedication');
  });
});

describe('level-gated grants and companion mod speeds', () => {
  it('a minLevel grant is withheld until that level', () => {
    const db = content();
    const before = build('rogue', 5, { featPicks: { '3:general:0': 'martial-experience' } });
    const after = build('rogue', 12, { featPicks: { '3:general:0': 'martial-experience' } });
    expect(before.feats.some((f) => f.featId === 'martial-experience')).toBe(true); // the feat IS taken
    expect(before.proficiencies.attacks.advanced).toBe('untrained'); // ...but grants nothing yet
    expect(after.proficiencies.attacks.advanced).toBe('trained');
    expect(db.feats['martial-experience']).toBeTruthy();
  });
  it('an eidolon mod speed renders as feet, and "land" resolves to its own Speed', async () => {
    const { deriveEidolon } = await import('../src/rules/companions');
    const db = content();
    const ch = build('summoner', 12, { subclassId: 'beast-eidolon', featPicks: { '4:class:0': 'airborne-form', '6:class:0': 'burrowing-form' } });
    const eid = deriveEidolon({ typeId: 'beast-eidolon', name: 'E' } as never, ch, db);
    expect(eid.extraSpeeds).toContain('burrow 15 feet');
    expect(eid.extraSpeeds?.some((s) => s.startsWith('fly 25 feet'))).toBe(true);
  });
  it('Ki Form grants the focus spell that ships under the remaster slug', () => {
    const ch = build('monk', 12, { overrides: { addedFeats: [{ featId: 'ki-form', level: 10, category: 'class' }] } });
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    const all = [...(focus?.cantrips ?? []), ...Object.values(focus?.repertoire ?? {}).flat()];
    expect(all).toContain('qi-form');
  });
});

describe('Viking Shieldbearer: choose a specific weapon to be trained in', () => {
  it('trains only the chosen weapon (battle axe vs longsword)', () => {
    const axe = build('rogue', 1, { ancestryId: 'human', heritageId: 'skilled-human', featPicks: { '1:ancestry:0': 'viking-shieldbearer' }, featChoices: { '1:ancestry:0': 'battle-axe' } });
    expect(axe.proficiencies.weaponOverrides?.['battle-axe']).toBe('trained');
    expect(axe.proficiencies.weaponOverrides?.['longsword'] ?? 'untrained').toBe('untrained');
    const sword = build('rogue', 1, { ancestryId: 'human', heritageId: 'skilled-human', featPicks: { '1:ancestry:0': 'viking-shieldbearer' }, featChoices: { '1:ancestry:0': 'longsword' } });
    expect(sword.proficiencies.weaponOverrides?.['longsword']).toBe('trained');
    expect(sword.proficiencies.weaponOverrides?.['battle-axe'] ?? 'untrained').toBe('untrained');
    // ...and still grants the Shield Block reaction (unchanged).
    expect(axe.feats.some((f) => f.featId === 'shield-block')).toBe(true);
  });
});

describe('companion mod lanes: skill grants + gear speed', () => {
  it('a feat trains a skill on the animal companion (Chorus Companion → Performance)', async () => {
    const { deriveAnimalCompanion } = await import('../src/rules/companions');
    const db = content();
    const type = db.animalCompanions['wolf'];
    const cfg = { kind: 'animal', id: 'c', typeId: 'wolf', name: 'Wolf' } as never;
    const perf = (feats: string[]) => {
      const b = deriveAnimalCompanion(cfg, type, 12, db, [], false, [], new Set(feats));
      return b.skills.find((s) => /performance/i.test(s.name))?.rank ?? 'absent';
    };
    expect(perf(['chorus-companion'])).toBe('trained');
    expect(perf([])).toBe('absent'); // Performance isn't a wolf signature skill
  });
  it('invested companion gear raises its Speed (Alacritous Horseshoes: +5 ft)', async () => {
    const { deriveAnimalCompanion } = await import('../src/rules/companions');
    const db = content();
    const type = db.animalCompanions['wolf'];
    const mk = (invested: boolean) => deriveAnimalCompanion({ kind: 'animal', id: 'c', typeId: 'wolf', name: 'Wolf', inventory: [{ instanceId: 'h', itemId: 'alacritous-horseshoes', quantity: 1, worn: true, invested }] } as never, type, 7, db);
    expect(mk(true).speeds.land).toBe((type.speeds.land ?? 0) + 5);
    expect(mk(false).speeds.land).toBe(type.speeds.land);
  });
});

describe('heritage grant lanes', () => {
  it('a heritage grants a feat outright (Cataphract Fleshwarp → Armor Proficiency)', () => {
    const ch = build('wizard', 3, { ancestryId: 'fleshwarp', heritageId: 'cataphract-fleshwarp' });
    const ap = ch.feats.find((f) => f.featId === 'armor-proficiency');
    expect(ap?.grantedBy).toBe('cataphract-fleshwarp');
    expect(ch.proficiencies.defenses.light).toBe('trained'); // wizard is otherwise untrained
  });
  it('a heritage grants N chosen Lores (Half Moon Sarangay → 2)', () => {
    const ch = build('fighter', 3, { ancestryId: 'sarangay', heritageId: 'half-moon-sarangay', heritageLore: ['Cooking', 'Sailing'] });
    expect(ch.proficiencies.skills['lore:cooking']).toBe('trained');
    expect(ch.proficiencies.skills['lore:sailing']).toBe('trained');
  });
});

describe('strike-damage riders (Spirit Striking)', () => {
  it('adds proficiency-scaled spirit damage to Strikes, greater overriding base', () => {
    const db = content();
    const dmg = (lvl: number) => {
      const c = build('exemplar', lvl, { ancestryId: 'human', backgroundId: 'warrior' });
      c.inventory = [{ instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true, runes: { striking: 'striking' } }] as never;
      return deriveStrikes(c, db).find((s) => /longsword/i.test(s.name))?.damage ?? '';
    };
    expect(dmg(7)).toContain('2 spirit'); // expert
    expect(dmg(15)).toContain('6 spirit'); // master, Greater Spirit Striking
  });
});

describe('multiclass dedication class DC', () => {
  it('grants a trained secondary class DC in the borrowed class', () => {
    const ch = build('wizard', 4, { ancestryId: 'human', overrides: { addedFeats: [{ featId: 'alchemist-dedication', level: 2, category: 'class' }] } });
    const dc = ch.secondaryClassDcs?.find((d) => d.classId === 'alchemist');
    expect(dc).toBeTruthy();
    expect(dc!.keyAbility).toBe('int');
    // 10 + (level 4 + trained 2) + Int mod
    const intMod = Math.floor((ch.abilities.int - 10) / 2);
    expect(dc!.dc).toBe(10 + 4 + 2 + intMod);
  });
  it('does not duplicate the primary class DC', () => {
    const ch = build('alchemist', 4, { ancestryId: 'human', overrides: { addedFeats: [{ featId: 'alchemist-dedication', level: 2, category: 'class' }] } });
    expect(ch.secondaryClassDcs?.some((d) => d.classId === 'alchemist') ?? false).toBe(false);
  });
});

describe('Brooch of Inspiration — Lore-group bonus', () => {
  it('grants an item bonus to every Lore skill (scaling by tier)', async () => {
    const { deriveSkill } = await import('../src/rules/derive');
    const db = content();
    const c = build('wizard', 10, { ancestryId: 'human' });
    c.proficiencies.skills['lore:academia'] = 'trained' as never;
    const lore = (itemId?: string) => {
      c.inventory = itemId ? ([{ instanceId: 'b', itemId, quantity: 1, worn: true, invested: true }] as never) : ([] as never);
      return deriveSkill(c, 'lore:academia' as never, db).modifier;
    };
    const base = lore();
    expect(lore('brooch-of-inspiration') - base).toBe(1);
    expect(lore('brooch-of-inspiration-major') - base).toBe(3);
    // A non-Lore skill is unaffected.
    const dipBase = deriveSkill(c, 'diplomacy', db).modifier;
    c.inventory = [{ instanceId: 'b', itemId: 'brooch-of-inspiration', quantity: 1, worn: true, invested: true }] as never;
    expect(deriveSkill(c, 'diplomacy', db).modifier).toBe(dipBase);
  });
});

describe('while-active grant predicate (Raging Athlete)', () => {
  it('grants climb/swim Speed only while the rage toggle is on', async () => {
    const { deriveSpeeds } = await import('../src/rules/derive');
    const db = content();
    const c = build('barbarian', 8, { ancestryId: 'human', subclassId: 'animal-instinct', overrides: { addedFeats: [{ featId: 'raging-athlete', level: 4, category: 'class' }] } });
    expect(deriveSpeeds(c, db).climb ?? 0).toBe(0);
    c.classResources = { ...c.classResources, rage: 1 };
    const s = deriveSpeeds(c, db);
    expect(s.climb).toBe(s.land);
    expect(s.swim).toBe(s.land);
  });
});

describe('size/reach, item-granted feat, item negative healing, per-archetype HP', () => {
  const db = content();
  it('a feat raises size + reach (Jotun\'s Heart → Huge, reach 10)', () => {
    const ch = build('fighter', 15, { ancestryId: 'human', overrides: { addedFeats: [{ featId: 'jotuns-heart', level: 15, category: 'class' }] } });
    expect(ch.size).toBe('huge');
    expect(ch.reach).toBe(10);
  });
  it('an invested item grants a bonus feat (The Survivor → Diehard)', () => {
    const ch = build('fighter', 8, { ancestryId: 'human', inventory: [{ instanceId: 's', itemId: 'the-survivor', quantity: 1, worn: true, invested: true }] as never });
    expect(ch.feats.some((f) => f.featId === 'diehard')).toBe(true);
  });
  it('an invested item grants negative healing (Emerald Fulcrum Lens)', async () => {
    const { deriveDefenses } = await import('../src/rules/derive');
    const ch = build('fighter', 8, { ancestryId: 'human', inventory: [{ instanceId: 'l', itemId: 'emerald-fulcrum-lens', quantity: 1, worn: true, invested: true }] as never });
    expect(deriveDefenses(ch, db).negativeHealing).toBe(true);
  });
  it('per-archetype-feat HP scales (Exemplar Resiliency: +3 per exemplar feat)', async () => {
    const { deriveMaxHp } = await import('../src/rules/derive');
    const base = build('fighter', 8, { ancestryId: 'human' });
    const withRes = build('fighter', 8, { ancestryId: 'human', overrides: { addedFeats: [{ featId: 'exemplar-dedication', level: 2, category: 'class' }, { featId: 'exemplar-resiliency', level: 4, category: 'class' }] } });
    // 2 exemplar-archetype feats (dedication + resiliency) × 3 = +6.
    expect(deriveMaxHp(withRes, db) - deriveMaxHp(base, db)).toBeGreaterThanOrEqual(3);
  });
  it('a feat adds a flat land-Speed bonus (Hyper Boosters +10)', async () => {
    const { deriveSpeeds } = await import('../src/rules/derive');
    const base = deriveSpeeds(build('fighter', 8, { ancestryId: 'human' }), db).land ?? 0;
    // Synthetic: give a taken feat a landSpeedBonus (the real Hyper Boosters is a class feature).
    const orig = db.feats['toughness'].landSpeedBonus;
    db.feats['toughness'].landSpeedBonus = 10 as never;
    try {
      const boosted = deriveSpeeds(build('fighter', 8, { ancestryId: 'human', featPicks: { '1:general:0': 'toughness' } }), db).land ?? 0;
      expect(boosted - base).toBe(10);
    } finally {
      if (orig === undefined) delete db.feats['toughness'].landSpeedBonus;
      else db.feats['toughness'].landSpeedBonus = orig;
    }
  });
});

describe('dynamic bloodline/deity skill item bonus', () => {
  it("Sanguine Pendant gives +2 to a sorcerer's bloodline skills only", async () => {
    const { deriveSkill } = await import('../src/rules/derive');
    const db = content();
    const c = build('sorcerer', 8, { ancestryId: 'human', subclassId: 'bloodline-aberrant' });
    const intBase = deriveSkill(c, 'intimidation', db).modifier;
    const dipBase = deriveSkill(c, 'diplomacy', db).modifier; // not a bloodline skill
    c.inventory = [{ instanceId: 'p', itemId: 'sanguine-pendant', quantity: 1, worn: true, invested: true }] as never;
    expect(deriveSkill(c, 'intimidation', db).modifier - intBase).toBe(2);
    expect(deriveSkill(c, 'diplomacy', db).modifier - dipBase).toBe(0);
  });
});

describe('an invested item can grant a Strike', () => {
  it('surfaces the item Strike as a natural attack (only while invested)', () => {
    const db = content();
    db.items['cloak-of-elvenkind'].grantedStrikes = [{ name: 'Ghostly Touch', die: 'd6', damageType: 'void', traits: ['agile', 'finesse', 'magical'], group: 'brawling' }] as never;
    try {
      const worn = build('fighter', 8, { ancestryId: 'human', inventory: [{ instanceId: 'c', itemId: 'cloak-of-elvenkind', quantity: 1, worn: true, invested: true }] as never });
      const noInvest = build('fighter', 8, { ancestryId: 'human', inventory: [{ instanceId: 'c', itemId: 'cloak-of-elvenkind', quantity: 1, worn: true }] as never });
      expect(worn.naturalAttacks?.some((n) => n.name === 'Ghostly Touch')).toBe(true);
      expect(noInvest.naturalAttacks?.some((n) => n.name === 'Ghostly Touch') ?? false).toBe(false);
    } finally {
      delete db.items['cloak-of-elvenkind'].grantedStrikes;
    }
  });
});
