import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, kineticistElements, type BuildState } from '../src/rules/build';
import { deriveDefenses, deriveSpeeds } from '../src/rules/derive';
import { explainStat, statHasSituational, spellNotesFor } from '../src/rules/explain';
import { COMPANION_MODS, companionModKeys } from '../src/rules/companionGrants';
import { deriveEidolon } from '../src/rules/companions';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';

const db = content();

/**
 * Ruling Q20 — "a choice whose only visible effect is the feat's own label", judged one record at a
 * time by two questions: does the app model a mechanical consequence (build it), and does the choice
 * name a specific stat (star it). Every case below failed the FIRST question: the answer was stored
 * and no code path anywhere read it.
 *
 * ⚠ Each `it` here was verified RED against the pre-change tree before the fix landed. Several of them
 * would still pass on a half-done fix (a record edited without its reader, or the reverse), so they
 * assert the OUTCOME on a built character rather than the presence of a field.
 */

/** A character with one feat dropped into a slot, plus that slot's answer. */
function withFeat(classId: string, level: number, featId: string, slotKey: string, answer?: string, over: Partial<BuildState> = {}) {
  return build(classId, level, {
    featPicks: { [slotKey]: featId } as BuildState['featPicks'],
    ...(answer ? { featChoices: { [slotKey]: answer } as BuildState['featChoices'] } : {}),
    ...over,
  });
}

describe('Q16 — Constant Levitation flies at YOUR Speed, not at 40', () => {
  /** The feat grants the Fly spell's Speed; a psychic's own land Speed decides what that is. */
  const flyOf = (landSpeed: number) => {
    const ch = withFeat('psychic', 16, 'constant-levitation', '16:class');
    // Overwrite the ancestry's land Speed rather than hunting for an ancestry that has the one we
    // want: deriveSpeeds resolves the formula against the accumulated land Speed, which is the value
    // this is about.
    const anc = { ...db.ancestries[ch.ancestryId!], speeds: { land: landSpeed } };
    return deriveSpeeds(ch, { ...db, ancestries: { ...db.ancestries, [ch.ancestryId!]: anc } }).fly;
  };

  it('a Speed-25 character flies at 25, not 40', () => {
    expect(flyOf(25)).toBe(25);
  });

  it('a Speed-10 character flies at 20 — the spell’s floor, not their land Speed', () => {
    expect(flyOf(10)).toBe(20);
  });

  it('a Speed-40 character still flies at 40, so the old number was right for exactly one case', () => {
    expect(flyOf(40)).toBe(40);
  });

  it('the record carries the formula, not a number', () => {
    expect(db.feats['constant-levitation'].speeds?.fly).toBe('max(@actor.speed.land,20)');
  });

  it('the fly Speed still carries its `*` — Q16 restored it and this must not undo it', () => {
    const ch = withFeat('psychic', 16, 'constant-levitation', '16:class');
    expect(statHasSituational(ch, { kind: 'speed' }, db)).toBe(true);
  });
});

describe('Q20 — Shooter’s Camouflage stars the skill its terrain answer changes', () => {
  const gunslinger = (answer?: string) => withFeat('gunslinger', 12, 'shooters-camouflage', '12:class', answer);

  it('Stealth is starred, and the star names the terrain the player chose', () => {
    const ch = gunslinger('natural');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' }, db)).toBe(true);
    const notes = explainStat(ch, db, { kind: 'skill', skill: 'stealth' }).situational ?? [];
    const line = notes.find((n) => /Hide and Sneak/.test(n.text));
    expect(line?.text).toMatch(/natural terrain/);
    expect(line?.text).not.toMatch(/urban/);
  });

  it('the other answer moves the wording, not the target', () => {
    const ch = gunslinger('urban');
    const notes = explainStat(ch, db, { kind: 'skill', skill: 'stealth' }).situational ?? [];
    expect(notes.some((n) => /urban terrain/.test(n.text))).toBe(true);
    // The mark belongs on Stealth (ruling J), not on the answer — "urban" is no skill.
    expect(statHasSituational(ch, { kind: 'skill', skill: 'survival' }, db)).toBe(false);
  });

  it('an unanswered pick stars nothing — it must not guess a terrain', () => {
    const notes = explainStat(gunslinger(), db, { kind: 'skill', skill: 'stealth' }).situational ?? [];
    expect(notes.some((n) => /Hide and Sneak/.test(n.text))).toBe(false);
  });
});

describe('Q20 + Q9 — a kineticist archetype’s element answer gates their impulses', () => {
  /** A fighter who multiclassed into kineticist and chose fire. */
  const archetype = (element?: string, over: Partial<BuildState> = {}): BuildState => ({
    ...emptyBuild(),
    level: 10,
    classId: 'fighter',
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'str',
    featPicks: { '2:class': 'kineticist-dedication' } as BuildState['featPicks'],
    ...(element ? { featChoices: { '2:class': element } as BuildState['featChoices'] } : {}),
    ...over,
  });

  it('the dedication’s answer joins the element set the class picker fills', () => {
    expect(kineticistElements(archetype('fire-gate'), 10)).toEqual(['fire-gate']);
  });

  it('Add Element’s answer joins it too', () => {
    const b = archetype('fire-gate', {
      featPicks: { '2:class': 'kineticist-dedication', '10:class': 'add-element' } as BuildState['featPicks'],
      featChoices: { '2:class': 'fire-gate', '10:class': 'water-gate' } as BuildState['featChoices'],
    });
    expect(kineticistElements(b, 10).sort()).toEqual(['fire-gate', 'water-gate']);
  });

  it('a feat slotted ABOVE the character’s level contributes nothing yet', () => {
    const b = archetype('fire-gate', {
      level: 4,
      featPicks: { '2:class': 'kineticist-dedication', '10:class': 'add-element' } as BuildState['featPicks'],
      featChoices: { '2:class': 'fire-gate', '10:class': 'water-gate' } as BuildState['featChoices'],
    });
    expect(kineticistElements(b, 4)).toEqual(['fire-gate']);
  });

  it('Advanced Element Control offers only impulses of the element they chose', () => {
    const spec = FEAT_PICK_GRANTS['advanced-element-control'];
    const fire = pickableFeats(spec, archetype('fire-gate'), db);
    const water = pickableFeats(spec, archetype('water-gate'), db);
    const impulsesOf = (list: typeof fire) => list.filter((f) => f.traits.includes('impulse'));
    // The unanswered list is the baseline: the point is that answering NARROWS it, not that some
    // arbitrary count came out.
    const unanswered = impulsesOf(pickableFeats(spec, archetype(), db));
    expect(impulsesOf(fire).length).toBeGreaterThan(0);
    expect(unanswered.length).toBeGreaterThan(impulsesOf(fire).length);
    // The gate is real in both directions. Composites are exempt, and for the reason the sibling test
    // states — an impulse carrying BOTH elements matches either gate.
    expect(impulsesOf(fire).some((f) => f.traits.includes('water') && !f.traits.includes('fire'))).toBe(false);
    expect(impulsesOf(water).some((f) => f.traits.includes('fire') && !f.traits.includes('water'))).toBe(false);
    // An ELEMENTLESS impulse works with whichever element you have, so it stays in both lists.
    const elementless = (list: typeof fire) =>
      impulsesOf(list).filter((f) => !['air', 'earth', 'fire', 'metal', 'water', 'wood'].some((t) => f.traits.includes(t)));
    expect(elementless(fire).map((f) => f.id)).toEqual(elementless(water).map((f) => f.id));
  });

  it('the class picker keeps working, and a character with NO elements is not filtered to nothing', () => {
    const kin = {
      ...emptyBuild(),
      level: 10,
      classId: 'kineticist',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'con',
      extraChoices: { element: ['earth-gate'] },
    } as BuildState;
    const slot = { level: 10, category: 'class' } as const;
    const impulsesFor = (b: BuildState) => eligibleFeatsForSlot(b, db, slot).filter((f) => f.traits.includes('impulse'));
    const impulses = impulsesFor(kin);
    expect(impulses.length).toBeGreaterThan(0);
    // A single-element fire impulse is out. A COMPOSITE one carrying earth as well stays in, which is
    // the pre-existing "matches ANY of your elements" rule, and Elemental Overlap depends on it:
    // *"Gain a composite impulse feat that includes your kinetic element. You can use that impulse
    // even though you can't channel all its elements."* Tightening it to ALL would empty that picker.
    expect(impulses.some((f) => f.traits.includes('fire') && !f.traits.includes('earth'))).toBe(false);
    expect(impulses.some((f) => f.traits.includes('fire') && f.traits.includes('composite'))).toBe(true);
    // No gate chosen yet → every impulse stays visible, rather than an empty picker that reads broken.
    expect(impulsesFor({ ...kin, extraChoices: {} }).length).toBeGreaterThan(impulses.length);
  });
});

describe('Q20 — Manifold Modifications hands over the modification it picked', () => {
  const inventor = (pick?: string) =>
    build('inventor', 8, {
      subclassId: 'armor-innovation',
      featPicks: { '8:class': 'manifold-modifications' } as BuildState['featPicks'],
      ...(pick ? { featChoices: { '8:class': pick } as BuildState['featChoices'] } : {}),
    });

  // ⚠ `buildCharacter` does NOT return the sheet — resistances are computed by derive.ts, so a test
  // reading them off the stored character would report "changes nothing" for a change that works.
  const sonicOf = (pick?: string) => deriveDefenses(inventor(pick), db).resistances.find((r) => r.type === 'sonic');

  it('the chosen modification’s own resistance reaches the sheet', () => {
    // Harmonic Oscillator is an armour modification whose record carries force + sonic resistance;
    // before this the answer was stored and `ownedFeatureIds` never saw it, so its mechanics were
    // unreachable however the player answered.
    expect(db.classFeatures['harmonic-oscillator'].resistances?.length).toBeGreaterThan(0);
    expect(sonicOf('harmonic-oscillator')).toBeTruthy();
    expect(sonicOf()).toBeUndefined();
  });

  it('a different answer hands over a different record', () => {
    expect(sonicOf('speed-boosters')).toBeUndefined();
  });
});

describe('Q20 + Q9 — Battle Harbinger Dedication asks its skill question once', () => {
  const harbinger = (answer?: string) =>
    build('cleric', 4, {
      subclassId: 'battle-creed',
      featPicks: { '2:class': 'battle-harbinger-dedication' } as BuildState['featPicks'],
      ...(answer ? { featChoices: { '2:class': answer } as BuildState['featChoices'] } : {}),
    });

  it('the all-sixteen duplicate picker is gone', () => {
    expect(FEAT_GRANTS['battle-harbinger-dedication'].skillChoices).toBeUndefined();
  });

  it('the record’s own answer is what trains the skill', () => {
    expect(harbinger('athletics').proficiencies.skills.athletics).toBe('trained');
    expect(harbinger('acrobatics').proficiencies.skills.acrobatics).toBe('trained');
  });

  it('an answer the feat does not offer trains nothing', () => {
    // The whole defect was that the LIVE picker took any of the sixteen; a stale Occultism answer from
    // that picker must not survive as a grant.
    expect(harbinger('occultism').proficiencies.skills.occultism ?? 'untrained').toBe('untrained');
  });

  it('the record keeps its choice, because battle-creed grants the feat and a choice-less grant is auto-taken', () => {
    // Deleting the field made the subclass hand the dedication over at level 1 — outside the 2nd-level
    // class slot it must occupy, and with the Toughness it grants: +1 HP per level for every one of them.
    expect(db.feats['battle-harbinger-dedication'].choice?.options?.map((o) => o.value)).toEqual(['acrobatics', 'athletics']);
    const noPick = build('cleric', 5, { subclassId: 'battle-creed' });
    expect(noPick.feats.some((f) => f.featId === 'battle-harbinger-dedication')).toBe(false);
    expect(noPick.feats.some((f) => f.featId === 'toughness')).toBe(false);
  });

  it('the clause the app cannot enforce is stated rather than silently dropped', () => {
    expect(db.feats['battle-harbinger-dedication'].note).toMatch(/already trained in BOTH/);
  });
});

describe('Q20 — Sterling Dynamo Dedication grants the attack the player configured', () => {
  const dynamo = (pick?: string) =>
    withFeat('fighter', 4, 'sterling-dynamo-dedication', '2:class', pick).naturalAttacks ?? [];

  it('no Strike is called "Label" any more', () => {
    for (const g of db.feats['sterling-dynamo-dedication'].grantedStrikes ?? []) expect(g.name).not.toBe('Label');
  });

  it('a manual power driver gets the 1d8 shove attack', () => {
    const a = dynamo('feature:dynamo:manual-power');
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({ name: 'Dynamo', die: 'd8', damageType: 'bludgeoning' });
    expect(a[0].traits).toContain('shove');
  });

  it('an automatic percussive striker gets the 1d4 agile finesse attack instead', () => {
    const a = dynamo('feature:dynamo:automatic-percussive');
    expect(a.length).toBe(1);
    expect(a[0].die).toBe('d4');
    expect(a[0].traits).toEqual(expect.arrayContaining(['agile', 'finesse']));
    expect(a[0].traits).not.toContain('shove');
  });

  it('every option has exactly one Strike, and the four differ', () => {
    const seen = new Set<string>();
    for (const o of db.feats['sterling-dynamo-dedication'].choice!.options!) {
      const a = dynamo(o.value);
      expect(a.length, o.value).toBe(1);
      seen.add(`${a[0].die}|${[...a[0].traits].sort().join(',')}`);
    }
    expect(seen.size).toBe(4);
  });
});

describe('Q20 + N2 — Eidolon’s Wrath writes its damage type onto the spell', () => {
  const summoner = (pick?: string) => withFeat('summoner', 6, 'eidolons-wrath', '6:class', pick);

  it('the spell the feat grants carries the chosen type, attributed to the feat', () => {
    const notes = spellNotesFor(summoner('cold'), 'eidolons-wrath');
    expect(notes.length).toBe(1);
    expect(notes[0].from).toBe("Eidolon's Wrath");
    expect(notes[0].note).toMatch(/cold/);
    expect(notes[0].note).not.toMatch(/\{choice\}/);
  });

  it('a different answer writes a different clause', () => {
    expect(spellNotesFor(summoner('void'), 'eidolons-wrath')[0].note).toMatch(/void/);
  });

  it('an unanswered feat writes nothing — never a placeholder, never a guess', () => {
    expect(spellNotesFor(summoner(), 'eidolons-wrath')).toEqual([]);
  });
});

describe('Q20 — the two eidolon pickers reach the Companions tab', () => {
  const eidolonOf = (over: Partial<BuildState>) => {
    const ch = build('summoner', 7, over);
    const cfg = { id: 'e', kind: 'eidolon' as const, name: 'E', eidolon: {} };
    return deriveEidolon(cfg as never, ch, db);
  };

  it('Pushing Attack names WHICH unarmed attack gained the Push action', () => {
    const primary = eidolonOf({
      featPicks: { '6:class': 'pushing-attack' } as BuildState['featPicks'],
      featChoices: { '6:class': 'primary' } as BuildState['featChoices'],
    });
    const secondary = eidolonOf({
      featPicks: { '6:class': 'pushing-attack' } as BuildState['featPicks'],
      featChoices: { '6:class': 'secondary' } as BuildState['featChoices'],
    });
    expect(primary.evoNotes?.some((n) => /Pushing Attack: its Primary/.test(n))).toBe(true);
    expect(secondary.evoNotes?.some((n) => /Pushing Attack: its Secondary/.test(n))).toBe(true);
  });

  it('an unanswered Pushing Attack says the pick is still owed rather than naming an attack', () => {
    const none = eidolonOf({ featPicks: { '6:class': 'pushing-attack' } as BuildState['featPicks'] });
    expect(none.evoNotes?.some((n) => /choose the primary or secondary/.test(n))).toBe(true);
  });

  it('Dual Studies puts the eidolon’s skill on the eidolon’s own block', () => {
    const b = eidolonOf({
      featPicks: { '1:class': 'dual-studies' } as BuildState['featPicks'],
      effectChoices: { 'dual-studies:eidolon-skill': 'medicine' },
    } as Partial<BuildState>);
    expect(b.skills.map((s) => s.toLowerCase())).toContain('medicine');
    // At 7th the feat raises it, and the row is headed "Trained skills" — so the rank is in the note.
    expect(b.evoNotes?.some((n) => /Dual Studies: your eidolon is trained in Medicine, and expert from 7th/.test(n))).toBe(true);
  });

  it('the eidolon skill is the eidolon’s alone — it is not shared with the summoner', () => {
    const ch = build('summoner', 7, {
      featPicks: { '1:class': 'dual-studies' } as BuildState['featPicks'],
      effectChoices: { 'dual-studies:eidolon-skill': 'medicine' },
      featSkillChoices: { 'dual-studies:0': 'stealth' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.stealth).toBe('expert');
    expect(ch.proficiencies.skills.medicine ?? 'untrained').toBe('untrained');
  });
});

describe('Q20 — Creature of Myth gives what the player picked', () => {
  it('each of the five answers has its own companion modification', () => {
    for (const o of db.feats['creature-of-myth'].choice!.options!) {
      const mod = COMPANION_MODS[`creature-of-myth:${o.value}`];
      expect(mod, o.value).toBeDefined();
      expect(mod.kinds).toContain('animal');
      expect(mod.note, o.value).toMatch(/Creature of Myth/);
    }
  });

  it('the answer is what selects it — the feat alone selects nothing', () => {
    const answered = companionModKeys([{ featId: 'creature-of-myth', choice: { value: 'magnificent-flight' } }]);
    expect(answered.has('creature-of-myth:magnificent-flight')).toBe(true);
    expect(companionModKeys([{ featId: 'creature-of-myth' }]).has('creature-of-myth:magnificent-flight')).toBe(false);
  });

  it('Magnificent Flight really grants the fly Speed, and Protective Skin really grants the HP', () => {
    expect(COMPANION_MODS['creature-of-myth:magnificent-flight'].speeds).toEqual({ fly: 'land' });
    expect(COMPANION_MODS['creature-of-myth:protective-skin'].maxHpBonus).toBe(30);
  });

  it('every composite key names a real answer to a real record’s choice', () => {
    const bad: string[] = [];
    for (const key of Object.keys(COMPANION_MODS)) {
      if (!key.includes(':')) continue;
      const featId = key.slice(0, key.indexOf(':'));
      const answer = key.slice(key.indexOf(':') + 1);
      const opts = db.feats[featId]?.choice?.options;
      if (!opts) bad.push(`${key}: ${featId} has no choice`);
      else if (!opts.some((o) => o.value === answer)) bad.push(`${key}: "${answer}" is not one of its options`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the overlay is the only place these edits live', () => {
  it('every record this run changed is written in effect-backfill.json, so `npm run data` cannot undo it', () => {
    const rows = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as { id: string; field: string; value: unknown }[];
    const has = (id: string, field: string) => rows.some((r) => r.id === id && r.field === field);
    expect(has('constant-levitation', 'speeds')).toBe(true);
    expect(has('manifold-modifications', 'choice')).toBe(true);
    expect(has('battle-harbinger-dedication', 'choice')).toBe(true);
    expect(has('sterling-dynamo-dedication', 'grantedStrikes')).toBe(true);
    expect(has('eidolons-wrath', 'spellNotes')).toBe(true);
    expect(has('creature-of-myth', 'choice')).toBe(true);
  });
});
