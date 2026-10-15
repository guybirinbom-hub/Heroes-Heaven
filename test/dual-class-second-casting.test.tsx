// @vitest-environment jsdom
/*
 * DUAL CLASS — THE SECOND CLASS CASTS EXACTLY AS THE FIRST (lane C2, 2026-10-14).
 *
 * Gamemastery Guide, Dual-Class Characters (AoN rules-1330): *"Dual-class spellcasters get full access
 * to all the spells of any spellcasting classes they have. For instance, a sorcerer/wizard gets five
 * cantrips in their spell repertoire from sorcerer, five prepared cantrips from wizard … and three
 * 1st-level prepared spell slots from wizard (or four, for a specialist). They keep these spells
 * entirely separate and get the full benefits of both spellcasting class features."*
 *
 * The second class's entry was a separate, thinner copy of the first's (build.ts), measured before the
 * fix: only a second-class WIZARD had a book, with a plain +1 slot instead of its curriculum; a
 * second-class witch, magus or necromancer prepared rank 1+ off the whole tradition; no second-class
 * cantrip could be re-prepared on the sheet; no patron, bloodline, muse or conscious-mind spell
 * arrived; a divine dragon cast arcane and a Wandering Reverie psychic cast with Intelligence. The
 * builder's second-class card read no widening, no book row and no dragon. Now both entries are built
 * by one `classCasting` and both cards by one body — every case below failed on the old code (the
 * lane report lists the run), and each asserts a real list or number with a control beside it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, setupMissing, type BuildState } from '../src/rules/build';
import {
  applyPlayState,
  initialPlay,
  learnSpell,
  playForRebuild,
  removeRepertoireSpell,
  setPreparedCantrip,
  setRestrictedSpell,
  spellBlendingEntryId,
  type PlayState,
} from '../src/rules/play';
import { cantripsOverOf, chosenAt, grantedPlaces, ownPlacesBeside, pickerSpellOptions, repertoireCap, variantGiftCount } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import { keptOffListNote, notInBookNote, overGiftNote, variantGiftNote } from '../src/rules/spellcasting';
import type { Character, SpellcastingEntry } from '../src/rules/types';

const db = content();
const CORE = enabledBookSet(undefined);
const noop = () => undefined;

/** Ten cantrips on the arcane list (a wizard's whole book). */
const ARCANE10 = ['detect-magic', 'light', 'shield', 'daze', 'electric-arc', 'frostbite', 'ignition', 'prestidigitation', 'telekinetic-hand', 'message'];
/** Ten on the occult list (a Baba Yaga witch's familiar; the first eight, a necromancer's dirge). */
const OCCULT10 = ['daze', 'detect-magic', 'figment', 'light', 'message', 'prestidigitation', 'shield', 'telekinetic-hand', 'void-warp', 'forbidding-ward'];

const first = (classId: string) => db.classes[classId]?.subclass?.options[0]?.id ?? null;
/** A dual-class build: `a` first, `b` second, each on its first subclass unless overridden. */
const dual = (a: string, b: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Dual caster',
    level,
    classId: a,
    subclassId: first(a),
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: db.classes[a]?.keyAbility?.length === 1 ? db.classes[a].keyAbility[0] : 'int',
    variantRules: { dualClass: true },
    classId2: b,
    subclassId2: first(b),
    ...over,
  }) as BuildState;
const built = (b: BuildState): Character => buildCharacter(b, db);
const entryOf = (ch: Character, classId: string): SpellcastingEntry | undefined => ch.spellcasting.find((e) => e.id === `${classId}-casting`);
const sheetOf = (ch: Character, play: PlayState = initialPlay(ch, db)) => applyPlayState(ch, play, db);
/** The sheet's picker for one entry (Manage spells), `keep` = the asking cantrip opening's own pick. */
const offered = (ch: Character, classId: string, rank: number, play: PlayState = initialPlay(ch, db), keep?: string | null): string[] => {
  const sheet = sheetOf(ch, play);
  return pickerSpellOptions({ character: sheet, entry: entryOf(sheet, classId)!, content: db }, rank, undefined, CORE, keep).map((s) => s.id);
};
const bookIds = (e: SpellcastingEntry | undefined) => new Set(Object.entries(e?.spellbook ?? {}).flatMap(([r, ids]) => (Number(r) > 0 ? ids : [])));

describe('a second-class BOOK caster prepares rank 1+ only from its book', () => {
  // mutation-proof
  it('Fighter/Witch (Baba Yaga): a familiar holding the patron\'s spell, and the picker offers only it', () => {
    const ch = built(dual('fighter', 'witch', 3, { subclassId2: 'baba-yaga', cantrips2: OCCULT10, spells2: { 1: ['fear', 'command'] } }));
    const witch = entryOf(ch, 'witch');
    expect(witch?.tradition, 'the patron\'s tradition').toBe('occult');
    expect(witch?.bookNoun).toBe('familiar');
    // *"your familiar learns chilling spray"* — the patron's spell is in the book, beside the picks.
    expect([...bookIds(witch)].sort()).toEqual(['chilling-spray', 'command', 'fear']);
    expect(witch?.bookCantrips, 'the whole familiar of ten cantrips').toEqual(OCCULT10);
    // The picker: exactly the book — `sleep` is on the occult list and not in the familiar.
    expect(db.spells.sleep?.traditions, 'fixture').toContain('occult');
    expect(offered(ch, 'witch', 1).sort()).toEqual(['chilling-spray', 'command', 'fear']);
  });

  // mutation-proof
  it('Fighter/Magus: the spellbook (Studious Spells\' gifts in it) — never the whole arcane list', () => {
    const ch = built(dual('fighter', 'magus', 7, { cantrips2: ARCANE10.slice(0, 8), spells2: { 1: ['grease', 'fear'], 3: ['haste'] } }));
    const magus = entryOf(ch, 'magus');
    const book = bookIds(magus);
    expect([...book]).toEqual(expect.arrayContaining(['grease', 'fear', 'haste']));
    expect(magus?.bookCantrips).toHaveLength(8);
    const at3 = offered(ch, 'magus', 3);
    expect(at3.length, 'the picker offers something').toBeGreaterThan(2);
    expect(at3.filter((id) => !book.has(id)), 'nothing outside the book').toEqual([]);
    expect(at3).not.toContain('fireball');
  });

  // mutation-proof
  it('Fighter/Necromancer: the dirge, harm free in it, and the picker offers only the dirge', () => {
    const ch = built(dual('fighter', 'necromancer', 5, { subclassId2: 'reaper', cantrips2: OCCULT10.slice(0, 8), spells2: { 1: ['fear', 'command'], 2: ['blur'] } }));
    const necro = entryOf(ch, 'necromancer');
    expect(necro?.bookNoun).toBe('dirge');
    expect([...bookIds(necro)].sort()).toEqual(['blur', 'command', 'fear', 'harm']);
    expect(offered(ch, 'necromancer', 1).sort()).toEqual(['command', 'fear', 'harm']);
    // The standing preparation is the player's own list, slot by slot — harm only where one is empty.
    expect(necro?.prepared?.[1]?.map((s) => s.spellId)).toEqual(['fear', 'command']);
  });
});

describe('a second-class wizard is a specialist: three slots and its curriculum slot', () => {
  // mutation-proof
  it('Sorcerer/Wizard (battle magic): 3 + 1 curriculum slot at 1st, the curriculum its own list', () => {
    const ch = built(dual('sorcerer', 'wizard', 5, { subclassId2: 'school-of-battle-magic', cantrips2: ARCANE10, spells2: { 1: ['fear', 'grease', 'force-barrage'] } }));
    const wiz = entryOf(ch, 'wizard')!;
    // *"three 1st-level prepared spell slots from wizard (or four, for a specialist)"*.
    expect(wiz.prepared?.[1]).toHaveLength(3);
    const curriculum = (wiz.restrictedSlots ?? []).filter((s) => s.label === 'Curriculum');
    expect(curriculum.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(curriculum[0].allowed).toEqual(['breathe-fire', 'force-barrage', 'mystic-armor']);
    // …and the first class's sorcerer slots are untouched by it (full-plus table: 4 at 5th).
    expect(entryOf(ch, 'sorcerer')?.slots?.[1]?.max).toBe(4);
  });

  // mutation-proof
  it('Rooted Wisdom read from the second subclass\'s own answer (`feature:<option>`)', () => {
    const curriculum1 = (b: BuildState) => (entryOf(built(b), 'wizard')?.restrictedSlots ?? []).find((s) => s.id === 'wizard-casting:curriculum:1')?.allowed ?? [];
    const base = dual('sorcerer', 'wizard', 3, { subclassId2: 'school-of-rooted-wisdom' });
    expect(curriculum1(base), 'the trunk alone').toEqual(['alarm']);
    const branched = curriculum1({ ...base, featChoices: { 'feature:school-of-rooted-wisdom': 'cascade-bearers' } });
    expect(branched).toEqual(expect.arrayContaining(['alarm', 'force-barrage', 'mystic-armor']));
  });

  // mutation-proof
  it('a Sorcerer/Wizard (runelord)\'s Sin Reservoir holds ITS curriculum — the school\'s plus the chosen sin\'s', () => {
    // *"Only one of your curriculum spells"* — resolved against the curriculum of the entry the slot
    // lands on. It took the FIRST class's (a sorcerer has none), so the slot had no list at all.
    const ch = built(dual('sorcerer', 'wizard', 8, { subclassId2: 'runelord', featPicks: { '8:class': 'sin-reservoir' }, featChoices: { 'feature:runelord': 'envy' } }));
    const reservoir = entryOf(ch, 'wizard')?.restrictedSlots?.find((s) => s.label === 'Sin Reservoir');
    expect(reservoir, 'the Sin Reservoir slot').toBeTruthy();
    expect(reservoir?.allowed ?? []).toEqual(expect.arrayContaining(['runic-weapon', 'fly', 'enfeeble', 'containment']));
  });

  it('Unified Magical Theory as the second class: no curriculum slot, one cantrip fewer', () => {
    const wiz = entryOf(built(dual('sorcerer', 'wizard', 5, { subclassId2: 'school-of-unified-magical-theory' })), 'wizard')!;
    expect(wiz.restrictedSlots ?? []).toEqual([]);
    expect(wiz.prepared?.[1]).toHaveLength(3);
    expect(wiz.cantripCap).toBe(5);
  });
});

describe('the second class\'s own subclass sets its tradition and key attribute', () => {
  // mutation-proof
  it('Cleric/Sorcerer (draconic, divine dragon): the sorcerer list is divine; the cleric\'s stays divine', () => {
    const ch = built(dual('cleric', 'sorcerer', 5, { subclassId2: 'bloodline-draconic', dragonExemplar: 'divine' }));
    expect(entryOf(ch, 'sorcerer')?.tradition).toBe('divine');
    expect(entryOf(ch, 'cleric')?.tradition).toBe('divine');
    // Control: an arcane dragon casts arcane — the dragon decides, not the bloodline's own `tradition`.
    expect(entryOf(built(dual('cleric', 'sorcerer', 5, { subclassId2: 'bloodline-draconic', dragonExemplar: 'arcane' })), 'sorcerer')?.tradition).toBe('arcane');
  });

  // mutation-proof
  it('…and the dragon\'s bloodline skill arrives under Dual Class, whatever the first class\'s subclass', () => {
    const skill = (dragon: string) => built(dual('rogue', 'sorcerer', 1, { subclassId2: 'bloodline-draconic', dragonExemplar: dragon })).proficiencies.skills.occultism;
    expect(skill('primal'), 'control: a primal dragon gives Nature, not Occultism').toBe('untrained');
    expect(skill('occult')).toBe('trained');
  });

  // mutation-proof
  it('Fighter/Psychic: the subconscious mind sets the psychic\'s key attribute, and the conscious mind its psi cantrips', () => {
    const psy = (mind: string) => entryOf(built(dual('fighter', 'psychic', 5, { extraChoices: { 'subconscious-mind': [mind] } })), 'psychic')!;
    expect(psy('wandering-reverie').keyAbility).toBe('cha');
    expect(psy('gathered-lore').keyAbility).toBe('int');
    expect(psy('wandering-reverie').grantedCantrips?.length, 'the conscious mind\'s psi cantrips').toBeGreaterThan(0);
  });
});

describe('a second-class wizard\'s cantrips re-prepare on the sheet, from its book only', () => {
  // mutation-proof
  it('six openings out of a book of ten; a book cantrip goes in, an off-book one is not offered', () => {
    const ch = built(dual('fighter', 'wizard', 1, { subclassId2: 'school-of-battle-magic', cantrips2: ARCANE10 }));
    const wiz = entryOf(ch, 'wizard')!;
    expect(wiz.cantripsPrepared).toBe(true);
    expect(wiz.cantripCap).toBe(6);
    expect(wiz.bookCantrips).toEqual(ARCANE10);
    expect(entryOf(sheetOf(ch), 'wizard')?.cantripSlots).toEqual(ARCANE10.slice(0, 6));
    // `message` is the tenth cantrip of the book — not prepared today, so the first opening can take it.
    const play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 0, 'message');
    expect(entryOf(sheetOf(ch, play), 'wizard')?.cantripSlots?.[0]).toBe('message');
    const choices = offered(ch, 'wizard', 0, play, 'message');
    expect(choices.filter((id) => !ARCANE10.includes(id)), 'only the book').toEqual([]);
    expect(db.spells.figment?.traditions, 'fixture: figment is arcane').toContain('arcane');
    expect(choices).not.toContain('figment');
  });
});

describe('a dual-class save from before keeps drawing its stored second-class picks', () => {
  // mutation-proof
  it('the old plain +1 slot\'s pick is drawn in the curriculum slot — marked when it is not a curriculum spell', () => {
    const ch = built(dual('fighter', 'wizard', 5, {
      subclassId2: 'school-of-battle-magic',
      cantrips2: ARCANE10.slice(0, 6),
      spells2: { 1: ['fear', 'grease', 'force-barrage', 'sleep'], 2: ['mist', 'blur'], 3: ['haste'] },
    }));
    // What the sheet stored while the wizard had four plain 1st-rank slots and three 2nd: index 3 at
    // 1st (grease — in the book, NOT battle-magic curriculum) and at 2nd (mist — curriculum).
    const play: PlayState = { ...initialPlay(ch, db), preparedSpells: { 'wizard-casting:1:0': 'sleep', 'wizard-casting:1:3': 'grease', 'wizard-casting:2:3': 'mist' } };
    const shown = entryOf(sheetOf(ch, play), 'wizard')!;
    expect(shown.prepared?.[1]?.[0].spellId, 'an ordinary slot\'s pick is where it was').toBe('sleep');
    const cur = (rank: number) => shown.restrictedSlots?.find((s) => s.id === `wizard-casting:curriculum:${rank}`);
    expect(cur(1)?.spellId).toBe('grease');
    expect(cur(1)?.keptOffList, 'not a curriculum spell — said, not hidden').toBe(true);
    expect(cur(2)?.spellId).toBe('mist');
    expect(cur(2)?.keptOffList).toBeUndefined();
    // …and the sheet says it, on the card.
    const r = renderDom(<SpellsTab character={sheetOf(ch, play)} content={db} onPlay={noop} />);
    try {
      // The curriculum slot's own card ("1st rank · curriculum"), not the book card that lists Grease too.
      const cards = [...r.host.querySelectorAll<HTMLElement>('.spell-card')].filter((c) => /curriculum/.test(c.querySelector('.spell-meta-text')?.textContent ?? ''));
      const grease = cards.find((c) => c.querySelector('.spell-name')?.textContent === 'Grease');
      expect(grease, 'the curriculum card draws Grease').toBeTruthy();
      expect(grease?.querySelector('.spell-offbook-note')?.textContent).toBe(keptOffListNote('Curriculum'));
      const mist = cards.find((c) => c.querySelector('.spell-name')?.textContent === 'Mist');
      expect(mist?.querySelector('.spell-offbook-note'), 'a curriculum spell carries no marker').toBeNull();
    } finally {
      r.stop();
    }
    // The first pick into the slot is the player's answer from then on: the old key is no longer read.
    const repicked = entryOf(sheetOf(ch, setRestrictedSpell(play, 'wizard-casting:curriculum:1', 'force-barrage')), 'wizard')!;
    const slot = repicked.restrictedSlots?.find((s) => s.id === 'wizard-casting:curriculum:1');
    expect(slot?.spellId).toBe('force-barrage');
    expect(slot?.keptOffList).toBeUndefined();
  });

  // mutation-proof
  it('…but never twice, and never lost: with a Ring of Wizardry each old key is drawn exactly once — the last one in the curriculum slot', () => {
    /* Before lane C2 this rank had 3 slots, the plain +1 slot (`:1:3`) and the ring's two (`:1:4`, `:1:5`).
     * Now it has 3, the ring's two (`:1:3`, `:1:4`) and the curriculum slot. The curriculum slot's legacy
     * key was set only where the rank had no bonus slot, so with the ring the LAST old key (`:1:5`,
     * `command`) was read by no slot at all — drawn nowhere, no marker (C2 check round 3, c2chk4/ring.ts).
     * Lane C3: the key is the index just past every slot the rank has now. */
    const b = dual('fighter', 'wizard', 5, {
      subclassId2: 'school-of-battle-magic',
      spells2: { 1: ['fear', 'grease', 'force-barrage', 'sleep'] },
      inventory: [{ itemId: 'ring-of-wizardry-type-i', quantity: 1, worn: true, invested: true }],
    });
    const ch = built(b);
    const wiz = entryOf(ch, 'wizard')!;
    expect(wiz.prepared?.[1], 'fixture: three slots and the ring\'s two').toHaveLength(5);
    expect(wiz.restrictedSlots?.find((s) => s.id === 'wizard-casting:curriculum:1')?.legacyKey).toBe('wizard-casting:1:5');
    // None of the three is prepared by default (`sleep` is the book's fourth; alarm and command are not in
    // the book), so every drawn copy is the stored pick.
    const STORED = { 'wizard-casting:1:3': 'sleep', 'wizard-casting:1:4': 'alarm', 'wizard-casting:1:5': 'command' };
    const play: PlayState = { ...initialPlay(ch, db), preparedSpells: STORED };
    const shown = entryOf(sheetOf(ch, play), 'wizard')!;
    expect(shown.prepared?.[1]?.[3]?.spellId, 'the ring\'s first slot draws the old +1 slot\'s pick').toBe('sleep');
    expect(shown.prepared?.[1]?.[4]?.spellId, 'its second, the old first ring slot\'s').toBe('alarm');
    const cur = shown.restrictedSlots?.find((s) => s.id === 'wizard-casting:curriculum:1');
    expect(cur?.spellId, 'the curriculum slot, the last one').toBe('command');
    expect(cur?.keptOffList, 'not battle magic — marked, not hidden').toBe(true);
    const drawn = [...(shown.prepared?.[1] ?? []).map((s) => s.spellId), ...(shown.restrictedSlots ?? []).map((s) => s.spellId)];
    for (const id of Object.values(STORED)) expect(drawn.filter((x) => x === id), `${id} drawn exactly once`).toHaveLength(1);
    // Control, no ring: the key is still the plain +1 slot's own (`count`), as before.
    const bare = entryOf(built({ ...b, inventory: [] }), 'wizard')!;
    expect(bare.restrictedSlots?.find((s) => s.id === 'wizard-casting:curriculum:1')?.legacyKey).toBe('wizard-casting:1:3');
  });

  // mutation-proof
  it('the same key on a NEW character (the ring taken off, a level-down) is drawn the same way — and the marker claims no history it cannot know', () => {
    // C2 check round 2: nothing stored says which app wrote `wizard-casting:<rank>:<count>` (schemaVersion
    // is re-stamped by every build; the play state has no version), so a ring slot's or a higher level's
    // pick reaches the curriculum slot too. Kept, not hidden — and the marker used to say "prepared before
    // this slot was limited to them", false for these two. It now says only what is true of all three.
    const spells2 = { 1: ['fear', 'grease', 'force-barrage', 'sleep'] };
    const ringOff = built(dual('fighter', 'wizard', 5, { subclassId2: 'school-of-battle-magic', spells2, inventory: [] }));
    const slotOf = (ch: Character, play: PlayState) => entryOf(sheetOf(ch, play), 'wizard')?.restrictedSlots?.find((s) => s.id === 'wizard-casting:curriculum:1');
    const ring = slotOf(ringOff, { ...initialPlay(ringOff, db), preparedSpells: { 'wizard-casting:1:3': 'sleep' } });
    expect(ring?.spellId, 'the ring slot\'s pick is kept, not hidden').toBe('sleep');
    expect(ring?.keptOffList, 'sleep is not battle magic — marked').toBe(true);
    const down = built(dual('fighter', 'wizard', 1, { subclassId2: 'school-of-battle-magic', spells2 }));
    const lower = slotOf(down, { ...initialPlay(down, db), preparedSpells: { 'wizard-casting:1:2': 'sleep' } });
    expect(lower?.spellId, 'a level-down\'s third-slot pick, kept').toBe('sleep');
    expect(lower?.keptOffList).toBe(true);
    // The words hold for an old save, a ring that came off and a level-down alike.
    const note = keptOffListNote('Curriculum');
    expect(note).toBe('Not a curriculum spell — prepared in a slot you no longer have');
    expect(note).not.toMatch(/before this slot was limited/);
  });

  // mutation-proof
  it('a second-class witch\'s pick from before its familiar was modelled stays drawn, marked "Not in your familiar"', () => {
    const ch = built(dual('fighter', 'witch', 3, { subclassId2: 'baba-yaga', cantrips2: OCCULT10.slice(0, 5), spells2: { 1: ['fear', 'command'] } }));
    const play: PlayState = { ...initialPlay(ch, db), preparedSpells: { 'witch-casting:1:0': 'sleep' } };
    const shown = entryOf(sheetOf(ch, play), 'witch')!;
    expect(shown.prepared?.[1]?.[0].spellId).toBe('sleep');
    expect(shown.notInBook).toEqual(['sleep']);
    expect(notInBookNote(shown.bookNoun)).toBe('Not in your familiar — add it in the builder');
  });
});

/*
 * LANE C3 (2026-10-15) — what C2's second-class book broke on the sheet.
 *
 * Spell Blending is a WIZARD thesis, and the dual-class casters *"keep these spells entirely separate"*.
 * Its Trade slots button was gated on "a prepared entry with a book", true of the wizard alone until C2
 * gave a second-class witch, magus and necromancer their book — so a Wizard (Spell Blending)/Magus had the
 * button on the magus card, and a trade stored there gave the magus a bonus slot (c2chk4/blend.ts). And
 * the Spells tab drew only the FIRST book, so a Wizard/Witch's familiar — with what the witch learned —
 * was listed in no section.
 */
describe('Spell Blending trades the wizard\'s own slots — on whichever card, in whichever class order', () => {
  const tradeButtons = (ch: Character, play: PlayState) => {
    const r = renderDom(<SpellsTab character={sheetOf(ch, play)} content={db} onPlay={noop} />);
    try {
      return [...r.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')]
        .filter((x) => x.title === 'Spell Blending — trade slots')
        .map((x) => x.closest<HTMLElement>('.sc-head')?.dataset.entry ?? '?');
    } finally {
      r.stop();
    }
  };

  // mutation-proof
  it('Wizard (Spell Blending)/Magus: the button on the wizard card only; a trade stored under the magus is not applied — and not deleted', () => {
    const ch = built(dual('wizard', 'magus', 7, { subclassId: 'school-of-battle-magic', keyAbility: 'int', extraChoices: { thesis: ['spell-blending'] } }));
    expect(entryOf(ch, 'magus')?.spellbook, 'fixture: the magus has its own book since C2').toBeTruthy();
    expect(entryOf(ch, 'magus')?.prepared?.[2], 'fixture: two 2nd-rank magus slots to trade').toHaveLength(2);
    expect(spellBlendingEntryId(ch, db)).toBe('wizard-casting');
    const play: PlayState = {
      ...initialPlay(ch, db),
      spellTrades: {
        'magus-casting': [{ from: 2, to: 3, indices: [0, 1] }],
        'wizard-casting': [{ from: 1, to: 3, indices: [1, 2] }],
      },
    };
    const sheet = sheetOf(ch, play);
    const magus = entryOf(sheet, 'magus')!;
    expect(magus.prepared?.[2]?.some((s) => s.traded), 'no magus slot is spent').toBe(false);
    expect(magus.prepared?.[3]?.some((s) => s.bonusFrom != null), 'and no free bonus slot appears').toBe(false);
    // Control: the wizard's own trade is applied, exactly as for a single-class wizard.
    const wiz = entryOf(sheet, 'wizard')!;
    expect(wiz.prepared?.[1]?.filter((s) => s.traded)).toHaveLength(2);
    expect(wiz.prepared?.[3]?.some((s) => s.bonusFrom === 1)).toBe(true);
    // The stored trade stays in the store through a Save — ignored, never thrown away.
    expect(playForRebuild(play).spellTrades?.['magus-casting']).toEqual([{ from: 2, to: 3, indices: [0, 1] }]);
    expect(tradeButtons(ch, play)).toEqual(['wizard-casting']);
  });

  // mutation-proof
  it('…the same with the wizard SECOND (Magus/Wizard, Witch/Wizard), and no thesis means no button anywhere', () => {
    for (const first of ['magus', 'witch']) {
      const ch = built(dual(first, 'wizard', 7, { keyAbility: 'int', subclassId2: 'school-of-battle-magic', extraChoices: { thesis: ['spell-blending'] } }));
      expect(entryOf(ch, first)?.spellbook, `fixture: the ${first} keeps a book`).toBeTruthy();
      expect(tradeButtons(ch, initialPlay(ch, db)), `${first}/wizard`).toEqual(['wizard-casting']);
    }
    const plain = built(dual('wizard', 'magus', 7, { subclassId: 'school-of-battle-magic', keyAbility: 'int' }));
    expect(spellBlendingEntryId(plain, db)).toBeUndefined();
    expect(tradeButtons(plain, initialPlay(plain, db))).toEqual([]);
  });
});

describe('one book section per book — a Wizard/Witch\'s familiar is listed, with what the witch learned', () => {
  // mutation-proof
  it('Wizard/Witch: "Wizard — Spellbook" and "Witch — Familiar’s spells", each holding its own book', () => {
    const ch = built(dual('wizard', 'witch', 3, {
      subclassId: 'school-of-battle-magic',
      keyAbility: 'int',
      cantrips: ARCANE10,
      spells: { 1: ['grease', 'force-barrage'] },
      subclassId2: 'baba-yaga',
      cantrips2: OCCULT10,
      spells2: { 1: ['fear', 'command'] },
    }));
    // Learn a Spell merges a book caster's learned spell into its book — the familiar here.
    const play = learnSpell(initialPlay(ch, db), 'witch-casting', 1, 'sleep');
    const r = renderDom(<SpellsTab character={sheetOf(ch, play)} content={db} onPlay={noop} />);
    try {
      const books = [...r.host.querySelectorAll<HTMLElement>('section.card[data-book-entry]')];
      // The header's text less its "N spells" note.
      const titleOf = (s: HTMLElement) => (s.querySelector('.ct')?.textContent ?? '').replace(s.querySelector('.ct .ct-note')?.textContent ?? '', '').trim();
      expect(books.map((s) => s.dataset.bookEntry)).toEqual(['wizard-casting', 'witch-casting']);
      expect(books.map(titleOf)).toEqual(['Wizard — Spellbook', 'Witch — Familiar’s spells']);
      const names = (s: HTMLElement) => [...s.querySelectorAll('.spell-card .spell-name')].map((x) => x.textContent);
      const familiar = names(books[1]);
      expect(familiar, 'the witch\'s picks').toEqual(expect.arrayContaining(['Fear', 'Command']));
      expect(familiar, 'the patron\'s spell').toContain(db.spells['chilling-spray']!.name);
      expect(familiar, 'the spell the witch learned').toContain('Sleep');
      expect(familiar, 'the familiar\'s cantrips').toContain(db.spells['void-warp']!.name);
      expect(names(books[0]), 'the wizard\'s book is its own').toEqual(expect.arrayContaining(['Grease', 'Force Barrage']));
      expect(names(books[0])).not.toContain('Sleep');
    } finally {
      r.stop();
    }
    // A single book keeps its plain title — no class name where there is nothing to tell apart.
    const solo = built(dual('fighter', 'witch', 3, { subclassId2: 'baba-yaga', cantrips2: OCCULT10, spells2: { 1: ['fear'] } }));
    const r2 = renderDom(<SpellsTab character={sheetOf(solo)} content={db} onPlay={noop} />);
    try {
      const books = [...r2.host.querySelectorAll<HTMLElement>('section.card[data-book-entry]')];
      expect(books.map((s) => (s.querySelector('.ct')?.textContent ?? '').replace(s.querySelector('.ct .ct-note')?.textContent ?? '', '').trim())).toEqual(['Familiar’s spells']);
    } finally {
      r2.stop();
    }
  });
});

describe('the round trip (deriveBuildFromCharacter) gives the player\'s own picks back, per class', () => {
  // mutation-proof
  it('Fighter/Witch: the whole familiar, minus the patron\'s gift, and the same entry after a rebuild', () => {
    const b = dual('fighter', 'witch', 3, { subclassId2: 'baba-yaga', cantrips2: OCCULT10, spells2: { 1: ['fear', 'command'] } });
    const ch = built(b);
    const back = deriveBuildFromCharacter(ch, db);
    expect(back.cantrips2).toEqual(OCCULT10);
    expect(back.spells2?.[1]).toEqual(['fear', 'command']);
    const again = entryOf(buildCharacter({ ...b, ...back, variantRules: b.variantRules }, db), 'witch');
    expect(again?.prepared?.[1]?.map((s) => s.spellId)).toEqual(entryOf(ch, 'witch')?.prepared?.[1]?.map((s) => s.spellId));
  });

  // mutation-proof
  it('Wizard/Sorcerer (aberrant): the bloodline\'s daze is not taken out of the WIZARD\'s book', () => {
    const ch = built(dual('wizard', 'sorcerer', 1, { subclassId: 'school-of-battle-magic', subclassId2: 'bloodline-aberrant', cantrips: ARCANE10 }));
    expect(deriveBuildFromCharacter(ch, db).cantrips).toEqual(ARCANE10);
    expect(db.classes.sorcerer?.subclass?.options.find((o) => o.id === 'bloodline-aberrant')?.grantedSpells, 'fixture: the bloodline grants daze').toContain('daze');
  });

  // mutation-proof
  it('a single-class witch\'s patron spell does not come back as a pick (it reordered the preparation)', () => {
    const b: BuildState = { ...dual('witch', 'witch', 3, { subclassId: 'baba-yaga', cantrips: OCCULT10, spells: { 1: ['fear', 'command'] } }), variantRules: {}, classId2: null, subclassId2: null };
    const ch = built(b);
    const back = deriveBuildFromCharacter(ch, db);
    expect(back.spells[1]).toEqual(['fear', 'command']);
    expect(entryOf(buildCharacter(back, db), 'witch')?.prepared?.[1]?.map((s) => s.spellId)).toEqual(['fear', 'command', 'chilling-spray']);
  });
});

describe('each class\'s own feats and archetypes reach its own entry', () => {
  // mutation-proof
  it('a Wizard/Witch\'s Lesson of Vengeance teaches the WITCH\'s familiar Phantom Pain, not the wizard\'s book', () => {
    const ch = built(dual('wizard', 'witch', 2, { subclassId2: 'baba-yaga', featPicks: { '2:class': 'basic-lesson' }, featChoices: { '2:class': 'aon-lesson-of-vengeance' } }));
    expect(entryOf(ch, 'witch')?.spellbook?.[1] ?? [], 'the witch\'s familiar').toContain('phantom-pain');
    expect(entryOf(ch, 'wizard')?.spellbook?.[1] ?? [], 'the wizard\'s book').not.toContain('phantom-pain');
  });

  // mutation-proof
  it('Wellspring Mage (a sorcerer archetype) cuts a Wizard/Sorcerer\'s sorcerer cantrips, never the wizard\'s', () => {
    const ch = built(dual('wizard', 'sorcerer', 2, { subclassId: 'school-of-battle-magic', featPicks: { '2:class': 'wellspring-mage-dedication' } }));
    expect(entryOf(ch, 'wizard')?.cantripCap).toBe(6);
    expect(entryOf(ch, 'sorcerer')?.cantripCap).toBe(4);
  });

  // mutation-proof
  it('Ultimate Polymath makes a Sorcerer/Bard\'s BARD repertoire signature — and only the bard\'s', () => {
    const ch = built(dual('sorcerer', 'bard', 20, {
      featPicks: { '20:class': 'ultimate-polymath' },
      spells: { 1: ['fear', 'grease'] },
      spells2: { 1: ['fear', 'soothe'], 2: ['blur'] },
    }));
    const bard = entryOf(ch, 'bard')!;
    expect([...(bard.signature ?? [])].sort()).toEqual([...new Set(Object.values(bard.repertoire ?? {}).flat())].sort());
    expect(entryOf(ch, 'sorcerer')?.signature ?? []).not.toContain('grease');
  });
});

/*
 * THE BUILDER'S SECOND-CLASS CARD, through the real Builder on the Level 0 page — the book row of lane
 * C1's shape, the second entry's own tradition, the dragon question, and the widenings aimed at it.
 */
describe('the builder: the second class\'s card is built like the first class\'s', () => {
  afterEach(() => {
    for (const n of [...document.body.children]) n.remove();
  });
  const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
  const openAt = (b: BuildState, level: number) => {
    const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
    return r;
  };
  const card = (host: HTMLElement, label: string) => host.querySelector<HTMLElement>(`[data-setupcard="${label}"]`);
  const cantripRow = (el: HTMLElement | null) => {
    const row = [...(el?.querySelectorAll<HTMLElement>('.spell-pick-row') ?? [])].find((x) => /cantrips/i.test(x.querySelector('.spr-head span')?.textContent ?? ''));
    return {
      label: (row?.querySelector('.spr-head span')?.textContent ?? '').trim(),
      count: (row?.querySelector('.spr-count')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hint: (row?.querySelector('.book-cantrip-hint')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      add: row?.querySelector<HTMLButtonElement>('button.spr-add') ?? null,
    };
  };
  /** The names the picker opened by a second-class row's "+ add" offers. */
  const pickerNames = (r: ReturnType<typeof renderDom>, el: HTMLElement | null, ctlTitle: string): string[] => {
    r.click(el?.querySelector(`[data-ctl-title="${ctlTitle}"]`) ?? null);
    return [...document.querySelectorAll('.pick-row .picker-name')].map((x) => (x.textContent ?? '').trim());
  };

  // mutation-proof
  it('Fighter/Wizard: "Spellbook cantrips 0 / 10", the first six prepared — and a seventh goes in', async () => {
    const r = openAt(dual('fighter', 'wizard', 1, { subclassId2: 'school-of-battle-magic', cantrips2: ARCANE10.slice(0, 6) }), 0);
    try {
      const el = card(r.host, 'Wizard spells — Arcane prepared');
      expect(el, 'the second-class card').toBeTruthy();
      const row = cantripRow(el);
      expect(row.label).toBe('Spellbook cantrips');
      expect(row.count).toBe('6 / 10');
      expect(row.hint).toBe('The first 6 are prepared each morning by default — change them on the sheet (Spells tab).');
      expect(row.add?.getAttribute('data-ctl-options')).toBe('10');
      r.click(row.add);
      await flush();
      const addable = [...document.querySelectorAll<HTMLElement>('.pick-row')].find(
        (x) => !x.classList.contains('chosen') && !(x.querySelector<HTMLButtonElement>('button.pick-add')?.disabled ?? true),
      );
      expect(addable, 'an unchosen cantrip is on offer').toBeTruthy();
      r.click(addable!.querySelector('button.pick-add'));
      await flush();
      expect(cantripRow(card(r.host, 'Wizard spells — Arcane prepared')).count, 'the seventh went in').toBe('7 / 10');
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('Cleric/Sorcerer (draconic, divine dragon): the card casts divine, and the dragon is asked', () => {
    const r = openAt(dual('cleric', 'sorcerer', 1, { subclassId2: 'bloodline-draconic', dragonExemplar: 'divine' }), 0);
    try {
      expect(card(r.host, 'Sorcerer spells — Divine spontaneous'), 'the second card\'s tradition is the dragon\'s').toBeTruthy();
      expect(card(r.host, 'Sorcerer spells — Arcane spontaneous')).toBeNull();
      expect(r.host.querySelector('[data-subcard="Dragon"]'), 'the Dragon question on the Level 0 page').toBeTruthy();
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('a single-class draconic sorcerer with a divine dragon is offered divine spells (the first class read the bloodline\'s arcane)', () => {
    const b: BuildState = { ...dual('sorcerer', 'sorcerer', 1, { subclassId: 'bloodline-draconic', dragonExemplar: 'divine' }), variantRules: {}, classId2: null, subclassId2: null };
    const r = openAt(b, 1);
    try {
      expect(r.host.textContent ?? '').toContain('Spells — Divine spontaneous');
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('Wizard/Cleric (Sarenrae): the cleric card offers the deity\'s Fireball at 3rd rank', () => {
    const r = openAt(dual('wizard', 'cleric', 5, { subclassId: 'school-of-battle-magic', subclassId2: 'cloistered-cleric', deityId: 'sarenrae', divineFont: 'heal' }), 0);
    try {
      expect(db.spells.fireball?.traditions, 'fixture: fireball is not divine').not.toContain('divine');
      const names = pickerNames(r, card(r.host, 'Cleric spells — Divine prepared'), 'Rank 3 spell (second class)');
      expect(names.length, 'the picker opened').toBeGreaterThan(10);
      expect(names).toContain('Fireball');
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('Fighter/Summoner (fey eidolon): the arcane illusions and mental spells — not the whole arcane list', () => {
    const r = openAt(dual('fighter', 'summoner', 1, { subclassId2: 'fey-eidolon' }), 0);
    try {
      const names = pickerNames(r, card(r.host, 'Summoner spells — Primal spontaneous'), 'Rank 1 spell (second class)');
      expect(db.spells['disguise-magic']?.traditions, 'fixture').not.toContain('primal');
      expect(db.spells['force-barrage']?.traditions, 'fixture').not.toContain('primal');
      expect(names).toContain('Disguise Magic');
      expect(names, 'not an arcane spell without the illusion or mental trait').not.toContain('Force Barrage');
    } finally {
      r.stop();
    }
  });
});

/*
 * A SORCERER'S GIFT IS ONE OF ITS PLACES — EVERY PICK IS DRAWN, AND THE EXTRA ONE IS SAID (lane C2's
 * check, 2026-10-14).
 *
 * *"you learn two 1st-rank spells of your choice and four cantrips of your choice, as well as an
 * additional spell and cantrip from your bloodline"*, *"your first new spell is always the sorcerous
 * gift spell for that rank"* (class-62): the gift counts INSIDE the rank's places. The build kept that
 * count by slicing the player's LAST pick off behind the gift, while the builder offered every place
 * beside it — so the last pick at every full rank was drawn nowhere and marked nowhere. Lane C2 gave
 * the second class the first class's code, gift included, so a Fighter/Sorcerer save that drew all of
 * its picks before the lane lost one per rank. Now: the builder offers the places less the gift, the
 * sheet's gate the same, and a save from the old builder draws every pick with the extra one reported.
 */
describe('a sorcerer\'s bloodline gift is one of its places — every pick is drawn, and the extra one is said', () => {
  /** Five occult cantrips, none of them aberrant's gift (daze) — the old builder's full row. */
  const FIVE = ['detect-magic', 'light', 'shield', 'message', 'prestidigitation'];
  /** Four 1st- and 2nd-rank picks at 7th level, where each rank has four places, the gift among them. */
  const OLD_SPELLS = { 1: ['fear', 'grease', 'command', 'alarm'], 2: ['blur', 'mist', 'invisibility', 'see-the-unseen'] };
  const fighterSorc = (): BuildState => dual('fighter', 'sorcerer', 7, { subclassId2: 'bloodline-aberrant', cantrips2: FIVE, spells2: OLD_SPELLS });
  const singleSorc = (level: number, over: Partial<BuildState>): BuildState => ({
    ...dual('sorcerer', 'sorcerer', level, { subclassId: 'bloodline-aberrant', ...over }),
    variantRules: {},
    classId2: null,
    subclassId2: null,
  });

  // mutation-proof
  it('Fighter/Sorcerer (aberrant), a save from the old builder: every pick drawn, each extra one reported', () => {
    const ch = built(fighterSorc());
    const sorc = entryOf(sheetOf(ch), 'sorcerer')!;
    expect(sorc.grantedRepertoire?.[1], 'fixture: the bloodline\'s 1st-rank gift').toEqual(['phantom-pain']);
    expect(sorc.grantedCantrips, 'fixture: daze is the gift cantrip, and not one of the picks').toEqual(['daze']);
    expect(sorc.slots?.[1]?.max, 'fixture: four 1st-rank places, the gift among them').toBe(4);
    expect(sorc.repertoire?.[1]).toEqual(['phantom-pain', ...OLD_SPELLS[1]]);
    expect(sorc.repertoire?.[2]).toEqual(['stupefy', ...OLD_SPELLS[2]]);
    expect(sorc.overCap, 'one over at each full rank — said, not hidden').toEqual([
      { rank: 1, by: 1 },
      { rank: 2, by: 1 },
    ]);
    expect(sorc.cantrips).toEqual(['daze', ...FIVE]);
    expect(cantripsOverOf(sorc), 'and one cantrip over the printed five').toBe(1);
    // …and a character with no stored build (an import, a GM's copy) gets every pick back.
    const back = deriveBuildFromCharacter(ch, db);
    expect(back.spells2?.[1]).toEqual(OLD_SPELLS[1]);
    expect(back.cantrips2).toEqual(FIVE);
  });

  // mutation-proof
  it('a single-class sorcerer: the same rule through the same code', () => {
    const sorc = entryOf(sheetOf(built(singleSorc(7, { cantrips: FIVE, spells: OLD_SPELLS }))), 'sorcerer')!;
    expect(sorc.repertoire?.[1]).toEqual(['phantom-pain', ...OLD_SPELLS[1]]);
    expect(sorc.overCap).toEqual([
      { rank: 1, by: 1 },
      { rank: 2, by: 1 },
    ]);
    expect(cantripsOverOf(sorc)).toBe(1);
  });

  // mutation-proof
  it('the sheet\'s Add gate counts the gift as one of the rank\'s places — a bard\'s muse spell still rides on top', () => {
    const legal = entryOf(sheetOf(built(dual('fighter', 'sorcerer', 7, { subclassId2: 'bloodline-aberrant', spells2: { 1: ['fear', 'grease', 'command'] } }))), 'sorcerer')!;
    expect(chosenAt(legal, 1)).toBe(3);
    expect(repertoireCap(legal, 1), 'four places, the gift one of them').toBe(3);
    expect(legal.overCap, 'three picks beside the gift is the printed four').toBeUndefined();
    expect(cantripsOverOf(legal)).toBe(0);
    // Control: a grant print puts ON TOP (the bard's muse, *"in addition"*) does not shrink the gate.
    const bard = entryOf(sheetOf(built(dual('fighter', 'bard', 7))), 'bard')!;
    expect(bard.grantedRepertoire?.[1], 'fixture: the enigma muse grants a 1st-rank spell').toEqual(['sure-strike']);
    expect(repertoireCap(bard, 1)).toBe(bard.slots?.[1]?.max);
  });

  // mutation-proof
  it('a record listing EVERY variant\'s gift: the gifts take ONE place, as print gives one — no pick of the player\'s own is called over', () => {
    /* Lane C4 (2026-10-15). For one round (C3) each listed gift took a place of its own, so a draconic
     * sorcerer had NO 2nd-rank place left: its print-correct picks were all marked "Past your allowance…
     * remove one", and removing one never cleared the note — following it deleted every correct pick
     * while the other dragons' gifts stayed (C3 check round 1). Print gives ONE gift per rank (class-62),
     * so the gifts take one place. The record cannot yet say which of them is the character's own
     * (`variantGiftCount`), so all of them are drawn, each card saying so (`variantGiftNote`). */
    const b = dual('fighter', 'sorcerer', 7, { subclassId2: 'bloodline-draconic', dragonExemplar: 'divine', spells2: { 2: ['blur', 'mist', 'invisibility'] } });
    const ch = built(b);
    const sorc = entryOf(sheetOf(ch), 'sorcerer')!;
    const gifts2 = sorc.grantedRepertoire?.[2] ?? [];
    expect(gifts2.length, 'fixture: the record lists four 2nd-rank gifts, one per dragon tradition').toBe(4);
    expect(sorc.slots?.[2]?.max, 'fixture: four 2nd-rank places').toBe(4);
    expect(grantedPlaces(sorc, 2), 'four gifts listed, ONE place').toBe(1);
    expect(repertoireCap(sorc, 2), 'three of the player\'s own beside the gift').toBe(3);
    expect(sorc.repertoire?.[2], 'every pick drawn, beside the record\'s gifts').toEqual(expect.arrayContaining(['blur', 'mist', 'invisibility']));
    expect(sorc.overCap, 'three of their own is the printed four, not over').toBeUndefined();
    // The builder offers the same three, and a gift the player also picked gives its place back.
    const own = entryOf(ch, 'sorcerer');
    expect(ownPlacesBeside(own, 2, 4, ['blur', 'mist', 'invisibility'])).toBe(3);
    expect(ownPlacesBeside(own, 2, 4, ['augury'])).toBe(4);
    expect(variantGiftCount(sorc, 2)).toBe(4);
    expect(variantGiftCount(sorc, 1), 'control: one gift at 1st (fear) is no variant list').toBe(0);
    // The cards: no pick says "over"; each listed gift says only one of them is the character's.
    const r = renderDom(<SpellsTab character={sheetOf(ch)} content={db} onPlay={noop} />);
    try {
      const notesOf = (name: string) =>
        [...r.host.querySelectorAll<HTMLElement>('.spell-card')]
          .filter((c) => c.querySelector('.spell-name')?.textContent === name)
          .map((c) => c.querySelector('.spell-offbook-note')?.textContent ?? null);
      for (const pick of ['Blur', 'Mist', 'Invisibility']) expect(notesOf(pick), pick).toEqual([null]);
      for (const id of gifts2) expect(notesOf(db.spells[id].name), id).toEqual([variantGiftNote(4)]);
      expect(notesOf('Fear'), 'a one-gift rank\'s gift carries no marker').toEqual([null]);
      expect(r.host.textContent ?? '').not.toMatch(/Past your allowance|One too many/);
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('…and an elemental sorcerer at 1st level keeps the four cantrips and two 1st-rank spells print gives it', () => {
    const MINE = ['detect-magic', 'light', 'prestidigitation', 'know-the-way'];
    expect(MINE.every((id) => db.spells[id]?.traditions?.includes('primal')), 'fixture: four primal cantrips').toBe(true);
    const elem = entryOf(sheetOf(built(singleSorc(1, { subclassId: 'bloodline-elemental', cantrips: MINE, spells: { 1: ['fear', 'grease'] } }))), 'sorcerer')!;
    expect(elem.grantedCantrips?.length, 'fixture: six gift cantrips, one per element').toBe(6);
    expect(elem.grantedRepertoire?.[1]?.length, 'fixture: six 1st-rank gifts').toBe(6);
    expect(elem.cantripCap, 'fixture: five cantrips, the gift among them').toBe(5);
    expect(cantripsOverOf(elem), 'four of their own beside the gift is the printed five').toBe(0);
    expect(repertoireCap(elem, 1), 'two of their own beside the gift').toBe(2);
    expect(elem.overCap).toBeUndefined();
    expect(variantGiftCount(elem, 0)).toBe(6);
    // A gift listed twice (Chain Lightning, air and metal) is one of five at 6th — and still one place.
    const elem11 = entryOf(built(singleSorc(11, { subclassId: 'bloodline-elemental' })), 'sorcerer')!;
    expect(elem11.grantedRepertoire?.[6]?.filter((id) => id === 'chain-lightning'), 'fixture: listed twice').toHaveLength(2);
    expect(variantGiftCount(elem11, 6)).toBe(5);
    expect(grantedPlaces(elem11, 6)).toBe(1);
  });

  // mutation-proof
  it('only draconic, elemental and genie list one gift per variant — phoenix\'s 4th-rank gift is filed at 4th', () => {
    /* C3 check round 1: phoenix is no variant bloodline. AoN bloodline-15 prints "4th Remove Curse";
     * our own text, "4th: Cleanse Affliction" — a 2nd-rank spell, so filing the gift under the spell's
     * own rank gave every phoenix two 2nd-rank gifts and none at 4th. The bloodline's grant ladder
     * (classFeatures/bloodline.grantedSpells, the psychic's shape) now says the rung. */
    const multi: string[] = [];
    for (const o of db.classes.sorcerer!.subclass!.options) {
      const e = entryOf(built(singleSorc(19, { subclassId: o.id, dragonExemplar: o.dragonChoice?.[0]?.slug ?? null })), 'sorcerer')!;
      if ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].some((rank) => variantGiftCount(e, rank) > 0)) multi.push(o.id);
    }
    expect(multi.sort()).toEqual(['bloodline-draconic', 'bloodline-elemental', 'bloodline-genie']);
    const phoenix = (level: number) => entryOf(built(singleSorc(level, { subclassId: 'bloodline-phoenix' })), 'sorcerer')!;
    const p7 = phoenix(7);
    expect(p7.grantedRepertoire?.[2]).toEqual(['see-the-unseen']);
    expect(p7.grantedRepertoire?.[4]).toEqual(['cleanse-affliction']);
    expect(p7.repertoire?.[4]).toContain('cleanse-affliction');
    expect(grantedPlaces(p7, 2)).toBe(1);
    expect(grantedPlaces(p7, 4), 'the gift is one of the 4th rank\'s places').toBe(1);
    const p5 = phoenix(5);
    expect(p5.grantedRepertoire?.[2], 'control: before the 4th-rank spells arrive').toEqual(['see-the-unseen']);
    expect(Object.values(p5.repertoire ?? {}).flat()).not.toContain('cleanse-affliction');
  });

  // mutation-proof
  it('a builder star set on a gift while it sat at the old rank still applies after the gift is re-filed', () => {
    /* C3 check round 2, low: a phoenix who starred Cleanse Affliction in the builder while it was filed
     * at 2nd stored the star under rank 2; the re-filing row moved the gift to 4th and the build's
     * signature pass looked for it at 2nd only, so the star stopped applying with nothing said. */
    const p7 = entryOf(built(singleSorc(7, { subclassId: 'bloodline-phoenix', signatures: { 2: 'cleanse-affliction' } })), 'sorcerer')!;
    expect(p7.signature).toEqual(['cleanse-affliction']);
    // Control: a star on a spell the repertoire does not hold at its stored rank — and no grant — stays off.
    const ctl = entryOf(built(singleSorc(7, { subclassId: 'bloodline-phoenix', signatures: { 2: 'haste' } })), 'sorcerer')!;
    expect(ctl.signature).toBeUndefined();
  });

  // mutation-proof
  it('the Spells tab marks the extra pick on its own card — the cantrip and the spell — and nothing else', () => {
    const r = renderDom(<SpellsTab character={sheetOf(built(fighterSorc()))} content={db} onPlay={noop} />);
    try {
      const notesOf = (name: string) =>
        [...r.host.querySelectorAll<HTMLElement>('.spell-card')]
          .filter((c) => c.querySelector('.spell-name')?.textContent === name)
          .map((c) => c.querySelector('.spell-offbook-note')?.textContent ?? null);
      expect(notesOf('Prestidigitation')).toEqual([overGiftNote(5, true)]);
      expect(notesOf('Alarm')).toEqual([overGiftNote(4, false)]);
      expect(notesOf('See the Unseen')).toEqual([overGiftNote(4, false)]);
      expect(notesOf('Fear'), 'a pick inside the allowance carries no marker').toEqual([null]);
      expect(notesOf('Daze'), 'nor the gift').toEqual([null]);
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('a rank the player set on the SHEET is fixed with the Repertoire button, not the builder — the marker says which', () => {
    // C2 check round 2: the marker said "remove one in the builder" on every rank, but at a rank the
    // store holds (Manage spells under the old gate, which let the gift ride free), the builder's picks
    // are not read: removing one there changed nothing. Rank 1 here is the store's, rank 2 the build's.
    // Four occult picks of its own at 1st (the store draws only what the occult list offers).
    const MINE = ['fear', 'command', 'soothe', 'alarm'];
    expect(MINE.every((id) => db.spells[id]?.traditions?.includes('occult')), 'fixture: all four are occult').toBe(true);
    const b = dual('fighter', 'sorcerer', 7, { subclassId2: 'bloodline-aberrant', spells2: { 1: MINE, 2: OLD_SPELLS[2] } });
    const ch = built(b);
    const stored: PlayState = { ...initialPlay(ch, db), repertoireSpells: { 'sorcerer-casting': { 1: MINE } } };
    const sorc = entryOf(sheetOf(ch, stored), 'sorcerer')!;
    expect(sorc.repertoireOnSheet, 'the store holds rank 1 only').toEqual([1]);
    expect(sorc.overCap).toEqual([
      { rank: 1, by: 1 },
      { rank: 2, by: 1 },
    ]);
    // The instruction each marker gives is the one that works: the builder does nothing at rank 1…
    const builderFix = entryOf(sheetOf(built({ ...b, spells2: { ...b.spells2, 1: ['fear', 'command', 'soothe'] } }), stored), 'sorcerer')!;
    expect(builderFix.overCap?.find((o) => o.rank === 1), 'removing it in the builder leaves rank 1 over').toEqual({ rank: 1, by: 1 });
    // …the Repertoire button's writer does.
    const sheetFix = entryOf(sheetOf(ch, removeRepertoireSpell(stored, 'sorcerer-casting', 1, 'alarm', [], sorc.grantedRepertoire?.[1])), 'sorcerer')!;
    expect(sheetFix.overCap?.find((o) => o.rank === 1)).toBeUndefined();
    // No store at all: no ranks listed, and the marker keeps pointing at the builder.
    expect(entryOf(sheetOf(ch), 'sorcerer')?.repertoireOnSheet).toBeUndefined();
    const r = renderDom(<SpellsTab character={sheetOf(ch, stored)} content={db} onPlay={noop} />);
    try {
      const notesOf = (name: string) =>
        [...r.host.querySelectorAll<HTMLElement>('.spell-card')]
          .filter((c) => c.querySelector('.spell-name')?.textContent === name)
          .map((c) => c.querySelector('.spell-offbook-note')?.textContent ?? null);
      expect(notesOf('Alarm')).toEqual([overGiftNote(4, false, true)]);
      expect(overGiftNote(4, false, true)).toMatch(/with the Repertoire button$/);
      expect(notesOf('See the Unseen'), 'the build\'s rank still says the builder').toEqual([overGiftNote(4, false)]);
      expect(overGiftNote(4, false)).toMatch(/in the builder$/);
      // The button the marker names is on the page, under that name.
      expect([...r.host.querySelectorAll('button.ms-btn')].some((x) => (x.textContent ?? '').trim() === 'Repertoire')).toBe(true);
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('the setup list counts the SECOND class\'s unanswered Dragon question, as it does the first\'s', () => {
    const b = dual('fighter', 'sorcerer', 1, { subclassId2: 'bloodline-draconic', dragonExemplar: null });
    expect(setupMissing(b, db)).toContain('Dragon exemplar');
    const slug = db.classes.sorcerer.subclass!.options.find((o) => o.id === 'bloodline-draconic')!.dragonChoice![0].slug;
    expect(setupMissing({ ...b, dragonExemplar: slug }, db)).not.toContain('Dragon exemplar');
    expect(setupMissing({ ...b, variantRules: {} }, db), 'a classId2 left with Dual Class off is no class').not.toContain('Dragon exemplar');
  });

  describe('…and the builder offers the places print gives, the gift drawn locked among them', () => {
    afterEach(() => {
      for (const n of [...document.body.children]) n.remove();
    });
    const openAt = (b: BuildState, level: number) => {
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
      return r;
    };
    const row = (el: ParentNode | null, head: RegExp) => {
      const x = [...(el?.querySelectorAll<HTMLElement>('.spell-pick-row') ?? [])].find((y) => head.test((y.querySelector('.spr-head span')?.textContent ?? '').trim()));
      return {
        count: (x?.querySelector('.spr-count')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        gifts: [...(x?.querySelectorAll('.spr-chip-gift') ?? [])].map((c) => (c.textContent ?? '').trim()),
        giftTitles: [...(x?.querySelectorAll('.spr-chip-gift') ?? [])].map((c) => c.getAttribute('title') ?? ''),
        giftNotes: [...(x?.querySelectorAll('.spr-gift-note') ?? [])].map((c) => (c.textContent ?? '').trim()),
        add: x?.querySelector<HTMLButtonElement>('button.spr-add') ?? null,
      };
    };

    // mutation-proof
    it('a sorcerer\'s level-1 page: four cantrips and two 1st-rank spells beside the gifts', () => {
      const r = openAt(singleSorc(1, { cantrips: FIVE, spells: { 1: ['fear', 'grease', 'command'] } }), 1);
      try {
        const c = row(r.host, /^Cantrips$/);
        expect(c.count, 'the old save\'s five, against four places').toBe('5 / 4');
        expect(c.gifts).toEqual(['Daze']);
        expect(c.add?.disabled).toBe(true);
        const s = row(r.host, /^1st rank$/);
        expect(s.count).toBe('3 / 2 known (+2 this level)');
        expect(s.gifts).toEqual(['Phantom Pain']);
        expect(s.add?.disabled).toBe(true);
      } finally {
        r.stop();
      }
      // A fresh sorcerer is offered exactly the places print gives, with the add open.
      const fresh = openAt(singleSorc(1, {}), 1);
      try {
        expect(row(fresh.host, /^Cantrips$/).count).toBe('0 / 4');
        expect(row(fresh.host, /^1st rank$/).count).toBe('0 / 2 known (+2 this level)');
        expect(row(fresh.host, /^1st rank$/).add?.disabled).toBe(false);
      } finally {
        fresh.stop();
      }
    });

    // mutation-proof
    it('the Fighter/Sorcerer card: the same places, the same locked gifts', () => {
      const r = openAt(fighterSorc(), 0);
      try {
        const el = r.host.querySelector<HTMLElement>('[data-setupcard="Sorcerer spells — Occult spontaneous"]');
        expect(el, 'the second-class card').toBeTruthy();
        const c = row(el, /^Cantrips$/);
        expect(c.count).toBe('5 / 4');
        expect(c.gifts).toEqual(['Daze']);
        const s = row(el, /^1st rank$/);
        expect(s.count).toBe('4 / 3 known');
        expect(s.gifts).toEqual(['Phantom Pain']);
        expect(s.add?.disabled).toBe(true);
      } finally {
        r.stop();
      }
    });

    // mutation-proof
    it('a draconic card: three places of its own at 2nd beside the four listed gifts, each chip saying only one is theirs', () => {
      // Lane C4: C3 offered "3 / 0 known" here — no 2nd-rank pick of the player's own at all.
      const r = openAt(dual('fighter', 'sorcerer', 7, { subclassId2: 'bloodline-draconic', dragonExemplar: 'divine', spells2: { 2: ['blur', 'mist', 'invisibility'] } }), 0);
      try {
        const el = r.host.querySelector<HTMLElement>('[data-setupcard="Sorcerer spells — Divine spontaneous"]');
        expect(el, 'the second-class card').toBeTruthy();
        const s = row(el, /^2nd rank$/);
        expect(s.count).toBe('3 / 3 known');
        expect([...s.gifts].sort()).toEqual(['Augury', 'Blazing Bolt', 'Blood Vendetta', 'Shatter']);
        expect(s.giftTitles.every((t) => t.startsWith(variantGiftNote(4))), s.giftTitles.join(' | ')).toBe(true);
        // A title is hover-only — a phone never shows it — so the row also SAYS it, once, as text
        // (C3 check round 2, low: the chips explained themselves to a mouse alone).
        expect(s.giftNotes).toEqual([`${variantGiftNote(4)}; together they take one of these places.`]);
        // Control: a one-gift rank keeps its words.
        const one = row(el, /^1st rank$/);
        expect(one.gifts).toEqual(['Fear']);
        expect(one.giftTitles).toEqual(['Granted by your bloodline — one of these places, and always known']);
        expect(one.giftNotes, 'a one-gift rank needs no sentence').toEqual([]);
      } finally {
        r.stop();
      }
    });
  });
});
