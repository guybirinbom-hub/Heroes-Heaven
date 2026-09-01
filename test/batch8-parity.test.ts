import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc, deriveSkill } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto';
import { CATALOG_MODES } from '../src/rules/modes';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const db = content();

/** Records the Wanderer's Guide parity pass found broken in batch 8. */

describe('Clan Lore asks which clan, and derives the rest', () => {
  /*
   * *"You gain the trained proficiency rank in THE TWO SKILLS OF YOUR CLAN … You also become trained
   * in THE LISTED LORE FOR YOUR CLAN."* — a printed table. It shipped as two unrestricted picks from a
   * twelve-skill list plus any Lore, which asked the player for the answer the table already gives and
   * could not bind the Lore to the clan at all.
   */
  it('offers the twelve printed clans and the unlisted-clan case', () => {
    const opts = db.feats['clan-lore'].choice?.options ?? [];
    expect(opts).toHaveLength(13);
    expect(opts.map((o) => o.value)).toContain('clan-ironfist');
    expect(opts.map((o) => o.value)).toContain('other-clan');
  });

  it('a named clan trains its own pair AND its own Lore', () => {
    const ch = build('fighter', 1, {
      featPicks: { '1:ancestry': 'clan-lore' } as BuildState['featPicks'],
      featChoices: { '1:ancestry': 'clan-ironfist' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.crafting).toBe('trained');
    expect(ch.proficiencies.skills.medicine).toBe('trained');
    expect(ch.proficiencies.skills['lore:smelting']).toBe('trained');
  });

  it('a different clan trains a different pair — the answer really drives it', () => {
    const ch = build('fighter', 1, {
      featPicks: { '1:ancestry': 'clan-lore' } as BuildState['featPicks'],
      featChoices: { '1:ancestry': 'clan-runebinder' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.arcana).toBe('trained');
    expect(ch.proficiencies.skills.occultism).toBe('trained');
    expect(ch.proficiencies.skills['lore:academia']).toBe('trained');
    expect(ch.proficiencies.skills.medicine ?? 'untrained').toBe('untrained');
  });

  it('an unlisted clan asks instead — the GM\'s selection, as printed', () => {
    /*
     * The one answer that still asks. Slot keys are namespaced by the answer, so switching clans
     * cannot silently inherit the previous clan's picks.
     */
    const ch = build('fighter', 1, {
      featPicks: { '1:ancestry': 'clan-lore' } as BuildState['featPicks'],
      featChoices: { '1:ancestry': 'other-clan' },
      featSkillChoices: { 'clan-lore:other-clan:0': 'stealth', 'clan-lore:other-clan:1': 'thievery' },
      featLoreChoices: { 'clan-lore:other-clan:0': 'Mining' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.stealth).toBe('trained');
    expect(ch.proficiencies.skills.thievery).toBe('trained');
    expect(ch.proficiencies.skills['lore:mining']).toBe('trained');
  });
});

describe('Goloma Courage: the +2 is a DC, not a save', () => {
  it('carries both printed bonuses, and the second is DC-only', () => {
    const sit = (db.feats['goloma-courage'] as { situational?: { bonus: string; targets: { dcOnly?: boolean }[] }[] }).situational ?? [];
    expect(sit).toHaveLength(2);
    expect(sit[0].bonus).toBe('+1 circumstance');
    expect(sit[0].targets[0].dcOnly).toBeUndefined();
    expect(sit[1].bonus).toBe('+2 circumstance');
    expect(sit[1].targets[0].dcOnly).toBe(true);
  });

  it('and still shifts a successful save against fear to a critical success', () => {
    expect(db.feats['goloma-courage'].degreeShifts?.[0].shift).toBe('successToCrit');
  });
});

describe('Surki Lore trains the tradition skill, not any skill', () => {
  it('offers exactly the four the feat names', () => {
    const slots = FEAT_SKILL_GRANTS['surki-lore']?.skillChoices ?? [];
    expect(slots).toHaveLength(1);
    expect(slots[0].options).toEqual(['arcana', 'nature', 'occultism', 'religion']);
    // "If you would automatically become trained in one of THOSE skills…" — per-slot, because the
    // record-wide flag's reader is guarded on the static `skills` map.
    expect(slots[0].redundantFallback).toBe(true);
  });

  it('trains Survival and the picked tradition skill', () => {
    const ch = build('fighter', 1, {
      featPicks: { '1:ancestry': 'surki-lore' } as BuildState['featPicks'],
      featSkillChoices: { 'surki-lore:0': 'occultism' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.survival).toBe('trained');
    expect(ch.proficiencies.skills.occultism).toBe('trained');
  });
});

describe('Inner Fire lets the player choose the tradition', () => {
  it('both printings offer primal and arcane rather than hardcoding one', () => {
    for (const id of ['inner-fire', 'inner-fire-naari']) {
      const ch = db.feats[id].effectChoices?.[0];
      expect(ch?.options?.map((o) => o.value), id).toEqual(['primal', 'arcane']);
      // `grant`, singular — the plural spelling is a field nothing reads.
      expect(ch?.options?.[1].grant?.innateSpells?.[0]).toEqual({ spellId: 'ignition', tradition: 'arcane', atWill: true });
      expect(db.feats[id].innateSpells, `${id} must not also hardcode one`).toBeUndefined();
    }
  });
});

describe('Clan Pistol hands over the pistol', () => {
  /*
   * *"You get one clan pistol of your clan FOR FREE … This replaces your clan dagger."* One weapon, not
   * a choice: "of your clan" is flavour, and the item's own text says each clan has its own take on a
   * single tradition. There is no per-clan variant in the data (Immolation Clan Pistol is a separate
   * level-10 cursed weapon and Rounds (Clan Pistol) is its ammunition), and their side grants one item
   * with no `select` either.
   *
   * ⚠ REVISED IN BATCH 19. This comment used to claim "nothing grants a clan DAGGER anywhere" — but
   * the dwarf ancestry PRINTS one ("You get one clan dagger for free, as it was given to you at
   * birth", ancestry-59) and now grants it, so the "replaces" clause finally has something to take
   * away: `grantsItems[].replaces` removes the ancestry's dagger when the pistol arrives.
   */
  it('reaches the inventory, not just the field', () => {
    const ch = build('fighter', 1, {
      ancestryId: 'dwarf',
      featPicks: { '1:ancestry': 'clan-pistol' } as BuildState['featPicks'],
    } as Partial<BuildState>);
    expect((ch.inventory ?? []).map((i) => i.itemId)).toContain('clan-pistol');
    expect((ch.inventory ?? []).map((i) => i.itemId)).not.toContain('clan-dagger');
    // …and WITHOUT the pistol, the printed birth-gift dagger is there.
    const plain = build('fighter', 1, { ancestryId: 'dwarf' } as Partial<BuildState>);
    expect((plain.inventory ?? []).map((i) => i.itemId)).toContain('clan-dagger');
  });
});

describe('Reinforced Chassis is armour, not a note', () => {
  /*
   * The record carried the Chassis Deflection reaction and a `situational` note saying the AC bonus
   * rises with level. A note is not a number, so an automaton walked around with no armour at all.
   */
  const chassis = () => db.items['reinforced-chassis-armor'];

  it('exists as medium plate armour with the printed cap', () => {
    expect(chassis()?.itemType).toBe('armor');
    expect([chassis()?.category, chassis()?.group]).toEqual(['medium', 'plate']);
    expect(chassis()?.acBonus).toBe(3);
    expect(chassis()?.dexCap).toBe(1);
    expect(chassis()?.acBonusByLevel).toEqual([{ level: 5, acBonus: 4 }, { level: 10, acBonus: 5 }]);
  });

  it('the feat hands it over', () => {
    expect(db.feats['reinforced-chassis'].grantsItems).toEqual([{ itemId: 'reinforced-chassis-armor', quantity: 1 }]);
  });

  it('and its bonus really rises at 5th and 10th', () => {
    const wearing = (level: number): Character => {
      const ch = build('fighter', level) as Character;
      return {
        ...ch,
        inventory: [{ instanceId: 'c1', itemId: 'reinforced-chassis-armor', quantity: 1, worn: true, equipped: true, invested: true }],
      } as Character;
    };
    const ac = (level: number) => deriveAc(wearing(level), db).value;
    // Only the armour's own item bonus moves between these; proficiency and level move together, so
    // compare the DIFFERENCE against a character in the same armour one step earlier.
    expect(ac(5) - ac(4)).toBe(2); // +1 level/proficiency, +1 from the armour stepping to +4
    expect(ac(10) - ac(9)).toBe(2); // and again at 10th
  });

  it('no longer stars AC for a number the sheet computes', () => {
    const ch = build('fighter', 5, { featPicks: { '1:ancestry': 'reinforced-chassis' } as BuildState['featPicks'] });
    expect(statHasSituational(ch, { kind: 'ac' }, db)).toBe(false);
  });
});

describe('temporary unarmed attacks are toggles, not permanent grants', () => {
  it('the two transformation feats have a mode that grants their attacks', () => {
    /*
     * The FEAT-gated modes live in the code catalog (`src/rules/modes.ts`), which `src/data/index.ts`
     * merges into the runtime content — so they are read from there, not from core.json. The
     * ITEM-gated ones below come through `consumable-modes.json` and therefore ARE in core.json. Two
     * carriers, both real; asserting on the wrong one is how the first version of this test failed on
     * correctly-authored data.
     */
    const modes = [...CATALOG_MODES, ...Object.values(db.modes ?? {})];
    const howling = modes.find((m) => (m.feats ?? []).includes('howling-aspect'));
    expect(howling?.grantedStrikes?.map((s) => s.name)).toEqual(['Tusks', 'Flame-hair']);
    const ursine = modes.find((m) => (m.feats ?? []).includes('ursine-avenger-form'));
    expect(ursine?.grantedStrikes?.map((s) => s.name)).toEqual(['Jaws', 'Claws']);
  });

  it('and the items that grant one on activation', () => {
    const byItem = (itemId: string) => Object.values(db.modes ?? {}).find((m) => m.fromItemId === itemId);
    expect(byItem('clawed-bracers')?.grantedStrikes?.[0]).toMatchObject({ name: 'Claw', die: 'd6', damageType: 'slashing' });
    expect(byItem('wolfjaw-armor')?.grantedStrikes?.[0]).toMatchObject({ name: 'Jaws', die: 'd8', damageType: 'piercing' });
    expect(byItem('dinosaur-boots')?.grantedStrikes?.[0].die).toBe('d6');
    expect(byItem('dinosaur-boots-greater')?.grantedStrikes?.[0].die).toBe('d8');
  });

  it('none of them grants the attack permanently', () => {
    for (const id of ['howling-aspect', 'ursine-avenger-form']) {
      expect(db.feats[id].grantedStrikes, id).toBeUndefined();
    }
  });
});

/**
 * THE NECROMANCER'S GRIM FASCINATIONS — Impossible Magic pg. 30, read from
 * https://2e.aonprd.com/GrimFascinations.aspx because the archive export this app imports from predates
 * the category and has no grim-fascination file at all.
 *
 * There are FOUR. An earlier pass inferred the pool from "the eight rank-1 necromancer focus spells" and
 * offered seven of them; three of those (Deathly Scream, Muscle Barrier, Song of the Soul) are granted by
 * FEATS and are not fascination spells. Only the printed list settles it, which is why the record carried
 * a warning instead of a guess until the page was read.
 */
describe('the necromancer can actually choose a fascination', () => {
  const FASCINATIONS = [
    ['blood', 'blood-infusion', /regain 1 Hit Point/],
    ['bone', 'bone-spear', /Speed is increased by 5 feet/],
    ['flesh', 'dead-weight', /difficult terrain/],
    ['spirit', 'life-tap', /spirit or void damage/],
  ] as const;

  it('offers exactly the four printed fascinations, each with its own grave spell', () => {
    const opts = db.classFeatures['grim-fascination'].effectChoices?.[0].options ?? [];
    expect(opts).toHaveLength(4);
    for (const [key, spell] of FASCINATIONS) {
      const o = opts.find((x) => x.value === key);
      expect(o?.grant?.focusSpells, key).toEqual([spell]);
    }
    // The warning that said they were in no data source we ship is gone, because now they are.
    expect(db.classFeatures['grim-fascination'].dataWarning).toBeUndefined();
  });

  it('carries each thrall enhancement as its printed text', () => {
    /* All four enhancements happen at the table — a Hit Point back when a thrall falls, +5 feet of
     * thrall Speed, difficult terrain, a damage-type swap — and a thrall has no stat block in our data
     * (the class text carries the whole thrall rules block as prose). So the note IS the mechanic. */
    const opts = db.classFeatures['grim-fascination'].effectChoices![0].options!;
    for (const [key, , printed] of FASCINATIONS) {
      expect(opts.find((o) => o.value === key)?.note, key).toMatch(printed);
    }
  });

  it('each of the four is a record of its own, with its provenance', () => {
    for (const [key, spell] of FASCINATIONS) {
      const rec = db.classFeatures[`fascination-${key}`];
      expect(rec, key).toBeTruthy();
      expect(rec.aonId, key).toMatch(/^grim-fascination-[1-4]$/);
      expect(rec.focusSpells, key).toEqual([spell]);
      expect(rec.source?.book).toBe('Pathfinder Impossible Magic');
    }
  });

  it('the chosen one really reaches the focus pool', () => {
    for (const [key, spell] of FASCINATIONS) {
      const ch = build('necromancer', 1, { effectChoices: { 'grim-fascination:grim-fascination': key } } as Partial<BuildState>);
      const known = Object.values(ch.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat();
      expect(known, key).toContain(spell);
      // Necrotic Bomb from the class, plus this one: two point-costing focus spells, so a pool of 2.
      expect(known, key).toContain('necrotic-bomb');
      expect(ch.focus?.max, key).toBe(2);
    }
  });

  it('Widespread Fascination offers the other fascinations, and only the spell', () => {
    /* *"You learn the grave spell for a grim fascination OTHER than yours."* The grave spell, not the
     * thrall enhancement — the note on each option says so, since the app cannot know which fascination
     * is already yours. */
    const opts = db.feats['widespread-fascination'].effectChoices?.[0].options ?? [];
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => o.grant?.focusSpells?.[0]).sort())
      .toEqual(['blood-infusion', 'bone-spear', 'dead-weight', 'life-tap']);
    for (const o of opts) expect(o.note).toMatch(/only the GRAVE SPELL/);
  });

  it('answering both with the SAME fascination grants the spell once, and one point', () => {
    /*
     * Both questions draw from one pool of four, so the same answer twice used to list the spell twice
     * AND take the pool from 2 to 3 — a free Focus Point for a spell already known, because `poolMax`
     * counts entries. Deduped where the feat-granted list is assembled, so it holds for any two sources
     * naming the same focus spell rather than for this feat alone.
     */
    const mk = (second: string) => build('necromancer', 2, {
      featPicks: { '2:class': 'widespread-fascination' },
      effectChoices: { 'grim-fascination:grim-fascination': 'bone', 'widespread-fascination:widespread-fascination': second },
    } as Partial<BuildState>);
    const rep = (ch: ReturnType<typeof build>) =>
      Object.values(ch.spellcasting.find((s) => s.type === 'focus')?.repertoire ?? {}).flat();

    const dup = mk('bone');
    expect(rep(dup).filter((id) => id === 'bone-spear')).toHaveLength(1);
    expect(dup.focus?.max).toBe(2);

    const distinct = mk('spirit');
    expect(rep(distinct)).toContain('life-tap');
    expect(distinct.focus?.max).toBe(3);
  });
});

describe('the innate grant really produces a spell DC and attack', () => {
  /*
   * Their side asserts SPELL_DC and SPELL_ATTACK on Animal Soul Siblings and Sequestered Spell, which
   * the kinds instrument reads as a `spellcasting` we do not model. We model it a rank lower down: the
   * innate GRANT produces the innate casting entry, and Player Core p.298 says gaining an innate spell
   * trains you in its DC and attack. Checked on a built character rather than by reading the record —
   * "the field is absent" is not "the character has nothing".
   */
  const innateOf = (ch: ReturnType<typeof build>) => ch.spellcasting.find((s) => s.id === 'innate-casting');

  /*
   * Animal Soul Siblings is a SAMSARAN ancestry feat, so the character has to be a samsaran for the
   * pick to be owned at all — building a rogue with the default ancestry produced an innate entry with
   * an empty repertoire, which looks exactly like the app dropping the grant and is not.
   */
  const samsaran = (level: number) =>
    build('rogue', level, {
      ancestryId: 'samsaran',
      featPicks: { '1:ancestry': 'animal-soul-siblings' } as BuildState['featPicks'],
    } as Partial<BuildState>);

  it('Animal Soul Siblings gives a primal innate entry with a trained DC', () => {
    expect(db.ancestries.samsaran, 'the ancestry must ship for this test to mean anything').toBeTruthy();
    const entry = innateOf(samsaran(1));
    expect(entry, 'the feat must produce an innate casting entry').toBeTruthy();
    expect(entry!.proficiency).toBe('trained');
    /* A non-cantrip innate spell lands in `repertoire`, which is keyed BY RANK
     * (`{ "2": ["speak-with-animals"] }`) rather than being a flat list — Speak with Animals is a
     * rank-2 spell. Reading it as an array reported an empty repertoire on a grant that works. */
    expect(Object.values(entry!.repertoire ?? {}).flat()).toContain('speak-with-animals');
    expect(entry!.spellSources?.['speak-with-animals']).toBe('Animal Soul Siblings');
  });

  it('…and it steps to expert at 12th, as the innate-spell rule prints', () => {
    expect(innateOf(samsaran(12))!.proficiency).toBe('expert');
  });

  it('Sequestered Spell asks for a cantrip and grants it at will', () => {
    const filter = db.feats['sequestered-spell'].effectChoices?.[0].spellFilter;
    expect(filter?.grantAs).toBe('innate');
    expect(filter?.cantripsOnly).toBe(true);
    expect(filter?.innate?.atWill).toBe(true);
  });
});

/**
 * Ten backgrounds whose skill key was the printed SENTENCE, slugified by the importer — so the
 * character was trained in a Lore skill named "Lore Associated With The Deity Who Blessed You" and the
 * question the text asks was never asked. Found while working batch 8; the same defect had already been
 * fixed for seven other backgrounds, and `npm run verify` now guards the shape.
 */
describe('no background trains a Lore named after its own sentence', () => {
  const SKILLS = new Set(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
    'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth',
    'survival', 'thievery']);

  it('no trainedSkill or trainedLore anywhere is a phrase', () => {
    const bad: string[] = [];
    for (const [bucket, recs] of Object.entries(db) as [string, Record<string, Record<string, unknown>>][]) {
      if (!recs || typeof recs !== 'object') continue;
      for (const [id, rec] of Object.entries(recs)) {
        if (!rec || typeof rec !== 'object') continue;
        for (const field of ['trainedSkill', 'trainedLore']) {
          for (const v of [rec[field] ?? []].flat()) {
            if (typeof v !== 'string' || !v) continue;
            const bare = v.replace(/^lore:/, '');
            if (!SKILLS.has(bare) && bare.split('-').length >= 4) bad.push(`${bucket}|${id}.${field}="${v}"`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('a named list becomes a pick', () => {
    expect(db.backgrounds['hammered-by-fate'].trainedLoreOptions).toEqual(['daemon', 'demon', 'devil']);
    expect(db.backgrounds['keys-to-destiny'].trainedLoreOptions).toHaveLength(9);
    expect(db.backgrounds['hammered-by-fate'].trainedSkill).toBeUndefined();
  });

  it('an open-ended one asks the player to name it', () => {
    // energy-scarred left this list in batch 23: its Lore is NOT open-ended — print binds it to the
    // chosen energy ("such as Fire Lore"), WG's SKILL_LORE_ACID… branches agree, and the record now
    // carries trainedLoreFromChoice instead of the free-text flag (guarded in batch23-parity).
    for (const id of ['crown-of-chaos', 'foreign-aid', 'blessed', 'anti-magical', 'raised-by-belief']) {
      expect(db.backgrounds[id].trainedLoreChoice, id).toBe(true);
      // Deleted outright on most of these, so `undefined` is the expected value — `.toMatch` cannot
      // take undefined, which is why this reads the string out first.
      expect(String(db.backgrounds[id].trainedSkill ?? ''), `${id} must not also carry the placeholder`)
        .not.toMatch(/^lore-/);
    }
  });

  it('and the one that grants TWO Lores grants both', () => {
    expect(db.backgrounds['undercover-lotus-guard'].trainedLore).toEqual(['art', 'underworld']);
    const ch = build('rogue', 1, { backgroundId: 'undercover-lotus-guard' } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:art']).toBe('trained');
    expect(ch.proficiencies.skills['lore:underworld']).toBe('trained');
    // The single key the concatenated placeholder used to produce must not exist.
    expect(ch.proficiencies.skills['lore:art-lore-and-underworld']).toBeUndefined();
  });

  it('Returned trains Boneyard Lore, not its parenthetical', () => {
    expect(db.backgrounds.returned.trainedLore).toBe('boneyard');
    const ch = build('rogue', 1, { backgroundId: 'returned' } as Partial<BuildState>);
    expect(ch.proficiencies.skills['lore:boneyard']).toBe('trained');
  });
});

describe('Innocuous surfaces its failed-Deception clause', () => {
  it('stars Deception with the printed rule', () => {
    const ch = build('rogue', 1, { featPicks: { '1:ancestry': 'innocuous' } as BuildState['featPicks'] });
    expect(statHasSituational(ch, { kind: 'skill', skill: 'deception' }, db)).toBe(true);
    expect(deriveSkill(ch, 'deception', db).rank).not.toBe('untrained');
  });
});
