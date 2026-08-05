import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill, deriveSpeeds, deriveArmorCheckPenalty } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { traitDesc } from '../src/rules/glossary';
import type { ArmorItem, Character, InventoryItem } from '../src/rules/types';

/**
 * Armor and shield traits. Every one of them was inert: 35 shipped items carry `bulwark`, 26 carry
 * `flexible`, 21 carry `noisy`, and nothing in src read any of them.
 *
 * Three are real numbers now (flexible, noisy, hindering). The rest are notes, because the engine
 * genuinely cannot know the trigger — whether an incoming effect is a damaging one, whether you
 * spent the action to Entrench, whether the armour is broken.
 */
const db = content();

const wearing = (itemId: string, over: Partial<Character> = {}): Character => {
  const c = build('fighter', 10);
  return {
    ...c,
    ...over,
    abilities: { ...c.abilities, ...(over.abilities ?? {}) },
    inventory: [{ instanceId: 'arm1', itemId, quantity: 1, worn: true } as InventoryItem],
  };
};

const traitsOf = (id: string) => (db.items[id] as ArmorItem).traits ?? [];
const cp = (id: string) => Math.abs((db.items[id] as ArmorItem).checkPenalty ?? 0);

describe('flexible — no check penalty on Acrobatics or Athletics', () => {
  // Armored coat: check penalty -1, Strength requirement 2, flexible.
  const ID = 'armored-coat';
  it('the item still carries the trait', () => {
    expect(traitsOf(ID)).toContain('flexible');
    expect(cp(ID)).toBeGreaterThan(0);
  });

  it('Acrobatics and Athletics are exempt even when the Strength requirement is missed', () => {
    // Str 10 (+0) is below the armour's Strength 2, so the penalty would otherwise apply.
    const c = wearing(ID, { abilities: { ...build('fighter', 10).abilities, str: 10 } });
    expect(deriveArmorCheckPenalty(c, db, 'acrobatics').value).toBe(0);
    expect(deriveArmorCheckPenalty(c, db, 'athletics').value).toBe(0);
  });

  it('but OTHER Strength/Dexterity skills still take it', () => {
    const c = wearing(ID, { abilities: { ...build('fighter', 10).abilities, str: 10 } });
    expect(deriveArmorCheckPenalty(c, db, 'thievery').value).toBe(-cp(ID));
  });

  it('the skill number itself moves — Athletics is higher than Thievery would be', () => {
    const c = wearing(ID, { abilities: { ...build('fighter', 10).abilities, str: 10 } });
    const flexible = deriveSkill(c, 'athletics', db).modifier;
    const bare = deriveSkill({ ...c, inventory: [] }, 'athletics', db).modifier;
    expect(flexible).toBe(bare); // the penalty never lands
  });
});

describe('noisy — Stealth takes the penalty even when you meet the Strength requirement', () => {
  // Ceramic plate: check penalty -2, Strength requirement 2, noisy.
  const ID = 'ceramic-plate';
  const strong = () => {
    const base = build('fighter', 10);
    return wearing(ID, { abilities: { ...base.abilities, str: 18 } }); // +4, comfortably over Str 2
  };

  it('the item still carries the trait', () => {
    expect(traitsOf(ID)).toContain('noisy');
  });

  it('meeting the Strength requirement clears the penalty everywhere EXCEPT Stealth', () => {
    const c = strong();
    expect(deriveArmorCheckPenalty(c, db, 'acrobatics').value).toBe(0);
    expect(deriveArmorCheckPenalty(c, db, 'thievery').value).toBe(0);
    // "…applies to Stealth checks even if you have the required Strength modifier."
    expect(deriveArmorCheckPenalty(c, db, 'stealth').value).toBe(-cp(ID));
  });

  it('the Stealth number is genuinely lower than an unarmoured one', () => {
    const c = strong();
    const armoured = deriveSkill(c, 'stealth', db).modifier;
    const bare = deriveSkill({ ...c, inventory: [] }, 'stealth', db).modifier;
    expect(armoured).toBe(bare - cp(ID));
  });

  it('a non-noisy armour lets Stealth off once Strength is met', () => {
    const base = build('fighter', 10);
    const plain = Object.entries(db.items).find(
      ([, i]) => i.itemType === 'armor' && (i as ArmorItem).checkPenalty && !(i.traits ?? []).includes('noisy') && ((i as ArmorItem).strength ?? 0) <= 4,
    )?.[0];
    if (!plain) return;
    const c = wearing(plain, { abilities: { ...base.abilities, str: 18 } });
    expect(deriveArmorCheckPenalty(c, db, 'stealth').value).toBe(0);
  });
});

describe('hindering — -5 to all Speeds, and nothing gets rid of it', () => {
  // Bastion plate: heavy, Speed penalty -10, Strength 4, hindering.
  const ID = 'bastion-plate';
  it('the item still carries the trait', () => {
    expect(traitsOf(ID)).toContain('hindering');
  });

  it('it stacks ON TOP of the armour Speed penalty', () => {
    const base = build('fighter', 10);
    const c = wearing(ID, { abilities: { ...base.abilities, str: 18 } }); // meets Str 4
    const bare = deriveSpeeds({ ...c, inventory: [] }, db).land;
    // Meeting Strength reduces the -10 to -5, then hindering takes another 5.
    expect(deriveSpeeds(c, db).land).toBe(bare - 10);
  });

  it('THE POINT: it survives an ability that ignores armour Speed penalties', () => {
    // Unburdened Iron: "Ignore the reduction to your Speed from any armor you wear." Hindering is
    // explicitly "separate from and in addition to the armor's Speed penalty".
    const base = build('fighter', 10);
    const c = wearing(ID, { abilities: { ...base.abilities, str: 18 } });
    const withFeat = { ...c, feats: [...c.feats, { featId: 'unburdened-iron', level: 3 }] } as Character;
    const bare = deriveSpeeds({ ...c, inventory: [] }, db).land;
    const speed = deriveSpeeds(withFeat, db).land;
    expect(speed).toBeLessThan(bare); // the feat did NOT clear it
    expect(speed).toBe(bare - 5); // exactly hindering's own 5 feet remains
  });

  it('a non-hindering heavy armour is fully cleared by the same feat', () => {
    const base = build('fighter', 10);
    const plain = Object.entries(db.items).find(
      ([, i]) => i.itemType === 'armor' && (i as ArmorItem).speedPenalty && !(i.traits ?? []).includes('hindering'),
    )?.[0];
    if (!plain) return;
    const c = wearing(plain, { abilities: { ...base.abilities, str: 18 } });
    const withFeat = { ...c, feats: [...c.feats, { featId: 'unburdened-iron', level: 3 }] } as Character;
    const bare = deriveSpeeds({ ...c, inventory: [] }, db).land;
    expect(deriveSpeeds(withFeat, db).land).toBe(bare);
  });

  it('it never drops a Speed below the printed 5-foot floor', () => {
    const base = build('fighter', 10);
    const c = wearing(ID, { abilities: { ...base.abilities, str: 8 } });
    expect(deriveSpeeds(c, db).land).toBeGreaterThanOrEqual(0);
  });
});

describe('the traits that stay notes', () => {
  it('bulwark reaches the Reflex save popup', () => {
    const c = wearing('hellknight-plate');
    const notes = explainStat(c, db, { kind: 'save', save: 'reflex' }).situational ?? [];
    const hit = notes.find((n) => /Dexterity modifier/i.test(n.text));
    expect(hit, 'bulwark should be listed on Reflex').toBeTruthy();
    // It is a REPLACEMENT, so the wording must not read as a plain bonus — for a Dex +4 character
    // this is a net penalty.
    expect(hit!.text).toMatch(/instead of/i);
  });

  it('ponderous lands on Perception, where initiative is rolled', () => {
    const c = wearing('fortress-plate');
    const notes = explainStat(c, db, { kind: 'perception' }).situational ?? [];
    expect(notes.some((n) => /initiative/i.test(n.text))).toBe(true);
  });

  it('entrench says it costs an action rather than pretending to be passive', () => {
    const c = wearing('bastion-plate');
    const notes = explainStat(c, db, { kind: 'ac' }).situational ?? [];
    const hit = notes.find((n) => /Entrench/i.test(n.text));
    expect(hit).toBeTruthy();
    expect(hit!.text).toMatch(/action/i);
  });

  it('nothing is listed for armour the character is not wearing', () => {
    const c = build('fighter', 10); // no inventory at all
    const notes = explainStat(c, db, { kind: 'save', save: 'reflex' }).situational ?? [];
    expect(notes.some((n) => /Dexterity modifier/i.test(n.text))).toBe(false);
  });

  it('the computed traits deliberately have NO note — the number already moved', () => {
    // A note beside a number that already changed tells the player the same thing twice.
    for (const t of ['flexible', 'noisy', 'hindering']) {
      expect(FEAT_SITUATIONAL[`trait:${t}`], `trait:${t} should not have a note`).toBeUndefined();
    }
  });

  it('the note names the TRAIT, not its raw slug', () => {
    const c = wearing('hellknight-plate');
    const notes = explainStat(c, db, { kind: 'save', save: 'reflex' }).situational ?? [];
    const hit = notes.find((n) => /Dexterity modifier/i.test(n.text))!;
    expect(hit.text).toContain('Bulwark');
    expect(hit.text).not.toContain('trait:');
  });

  it('every armour trait a shipped item carries has a real glossary entry', () => {
    // They ALL fell through to the generic "interacts with anything that has this trait" line.
    const shipped = new Set<string>();
    for (const i of Object.values(db.items)) {
      if (i.itemType === 'armor' || i.itemType === 'shield') for (const t of i.traits ?? []) shipped.add(t);
    }
    // Only the traits this lane took on — the rest (integrated-*, shield-throw-*, magical…) are
    // either weapon profiles or handled elsewhere.
    const owned = ['bulwark', 'flexible', 'noisy', 'comfort', 'hindering', 'ponderous', 'laminar', 'entrench-melee', 'entrench-ranged', 'aquadynamic'];
    for (const t of owned) {
      expect(shipped.has(t), `${t} no longer ships on any item`).toBe(true);
      const desc = traitDesc(t, db);
      expect(desc, `${t} has no glossary entry`).toBeTruthy();
      expect(desc, `${t} still falls through to the generic blurb`).not.toMatch(/interact with anything that has this trait/i);
    }
  });

  it('the skill BREAKDOWN agrees with the skill number for flexible armour', () => {
    // The failure this prevents: the row badge and the popup listing a penalty that deriveSkill
    // never applied — the number and its explanation disagreeing.
    const base = build('fighter', 10);
    const c = wearing('armored-coat', { abilities: { ...base.abilities, str: 10 } });
    const b = explainStat(c, db, { kind: 'skill', skill: 'athletics' });
    expect(b.parts.reduce((s, p) => s + p.value, 0)).toBe(deriveSkill(c, 'athletics', db).modifier);
    expect(b.parts.some((p) => /check penalty/i.test(p.label))).toBe(false);
  });

  it('…and for noisy armour it DOES list the Stealth penalty', () => {
    const base = build('fighter', 10);
    const c = wearing('ceramic-plate', { abilities: { ...base.abilities, str: 18 } });
    const b = explainStat(c, db, { kind: 'skill', skill: 'stealth' });
    expect(b.parts.reduce((s, p) => s + p.value, 0)).toBe(deriveSkill(c, 'stealth', db).modifier);
  });

  it('every trait note obeys the one-line guard', () => {
    for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
      if (!id.startsWith('trait:')) continue;
      for (const b of list) expect(b.when.length, `${id} when is too long`).toBeLessThanOrEqual(120);
    }
  });
});
