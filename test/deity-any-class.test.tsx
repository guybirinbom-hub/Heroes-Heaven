// @vitest-environment jsdom
/*
 * ANY CHARACTER MAY FOLLOW A DEITY (the owner, 2026-10-14).
 *
 * The Deity card rendered only when `buildUsesDeity` was true — a deity-choosing class or subclass,
 * Raised by Belief, or a picked feat with a domains / own-deity-spell / deity spell-list field. So:
 *
 *   - a fighter who worships Sarenrae could not pick her (Player Core: anyone can follow a deity);
 *   - a character who took CLERIC DEDICATION — *"Choose a deity as you would if you were a cleric"*
 *     (AoN feat-5066) — never saw the card, because the record ships only a sanctification choice
 *     whose note says "your deity". Champion Dedication (*"Choose a deity."*) and the ranger's
 *     Vindicator (*"You must choose a deity to be a follower of"*) had the same dead end;
 *   - the dedications' holy / unholy / none picker offered all three whatever the deity allowed.
 *
 * What must stay true, and what each block below pins:
 *   1. the card is drawn for EVERY character — "Deity (optional)" when nothing needs it, never a
 *      pending mark and never in the choices left;
 *   2. a plain follower gets nothing a class gives: no favored weapon, no domains, no divine font, no
 *      sanctification — and is not asked the deity's sanctification question at all;
 *   3. the records that say "choose a deity" make it required (a corpus scan, so a new one fails here);
 *   4. a sanctification that follows the deity offers only what the deity's entry allows.
 */
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { OriginPickers, requestDeityChange, type BuilderActions } from '../src/builder/shared';
import {
  buildChoiceOptions,
  buildCharacter,
  buildNeedsDeity,
  buildUsesDeity,
  DEITY_CHOOSING_FEATS,
  effectChoiceOffered,
  emptyBuild,
  levelChoices,
  SANCTIFICATION_FROM_DEITY,
  setupMissing,
  type BuildState,
} from '../src/rules/build';
import { sanctificationOf } from '../src/rules/derive';
import { setEngineTrustOff } from '../src/rules/trustLanes';
import { ContentContext } from '../src/sheet/ContentContext';
import { DetailsTab } from '../src/sheet/DetailsTab';
import type { FeatChoiceDef } from '../src/rules/types';

const db = content();
const anc = Object.keys(db.ancestries)[0];
const bg = Object.keys(db.backgrounds)[0];

const fighter = (over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 't',
    level: 4,
    classId: 'fighter',
    ancestryId: anc,
    backgroundId: bg,
    keyAbility: 'str',
    ...over,
  }) as BuildState;

/** The options the builder's picker shows for a record's plain `choice`, the one funnel every feat
 *  and class-feature picker goes through (Builder.tsx renderChoice → buildChoiceOptions). */
const picker = (recordId: string, def: FeatChoiceDef, b: BuildState) => buildChoiceOptions(recordId, def, b, db, buildCharacter(b, db));
const greyed = (opts: { value: string; disabled?: string }[]) => opts.filter((o) => o.disabled).map((o) => o.value).sort();

/** `bucket/id` of every feat, class feature, heritage and background whose printed text matches. */
function scan(re: RegExp): string[] {
  const out: string[] = [];
  for (const bucket of ['feats', 'classFeatures', 'heritages', 'backgrounds'] as const) {
    for (const [id, r] of Object.entries(db[bucket] as Record<string, { description?: string }>)) if (re.test(r.description ?? '')) out.push(`${bucket}/${id}`);
  }
  return out;
}

/** A build that holds the record: a feat in a class slot at its level, a class's own feature, or a
 *  subclass option. Undefined for anything else, so the caller can say what it cannot build. */
function buildFor(key: string, over: Partial<BuildState> = {}): BuildState | undefined {
  const [bucket, id] = key.split('/');
  if (bucket === 'feats') {
    const lvl = Math.max(2, db.feats[id].level);
    return fighter({ level: lvl, featPicks: { [`${lvl}:class:0`]: id }, ...over });
  }
  if (bucket !== 'classFeatures') return undefined;
  const owner = Object.values(db.classes).find((c) => c.features?.some((f) => f.featureId === id));
  if (owner) return fighter({ classId: owner.id, ...over });
  const sub = Object.values(db.classes).find((c) => c.subclass?.options.some((o) => o.id === id));
  return sub ? fighter({ classId: sub.id, subclassId: id, ...over }) : undefined;
}

const noActions = { patch: () => undefined } as unknown as BuilderActions;
const pageDeityChoices = (b: BuildState) => levelChoices(b, db).filter((c) => /deity|sanctification/i.test(c.label));

describe('1 · every character may pick a deity, and an optional one never nags', () => {
  it('a fighter is not REQUIRED to pick one — nothing about a deity in the choices left, with or without one', () => {
    expect(buildUsesDeity(fighter(), db)).toBe(false);
    expect(pageDeityChoices(fighter())).toEqual([]);
    expect(pageDeityChoices(fighter({ deityId: 'iomedae' }))).toEqual([]);
  });

  it('the Builder draws "Deity (optional)" for a fighter, and plain "Deity" once a record needs one', () => {
    const page = (b: BuildState) => renderDom(<OriginPickers build={b} actions={noActions} content={db} />);
    const plain = page(fighter());
    expect(plain.host.querySelector('[data-setupcard="Deity (optional)"]'), 'a fighter has no Deity card at all').toBeTruthy();
    expect(plain.host.querySelector('[data-setupcard="Deity"]')).toBeNull();
    plain.stop();
    const dedicant = page(fighter({ featPicks: { '2:class:0': 'cleric-dedication' } }));
    expect(dedicant.host.querySelector('[data-setupcard="Deity"]'), 'Cleric Dedication must show the required Deity card').toBeTruthy();
    dedicant.stop();
  });

  it('with every deity book off, the optional card carries no "turn books on" warning; a required one still does', () => {
    /* No deity is printed in a Core book and a new character starts on the Core books, so an optional
     * card that warned would warn on every new fighter. `useContent()` is the full database the app
     * provides; `content` is what this character's books let through. */
    const page = (b: BuildState) =>
      renderDom(
        <ContentContext.Provider value={db}>
          <OriginPickers build={b} actions={noActions} content={{ ...db, deities: {} }} />
        </ContentContext.Provider>,
      );
    const WARN = 'Every deity is printed in a book this character has switched off.';
    const plain = page(fighter());
    expect(plain.host.querySelector('[data-setupcard="Deity (optional)"]')!.textContent).not.toContain(WARN);
    plain.stop();
    const cleric = page(fighter({ classId: 'cleric', subclassId: 'cloistered-cleric', keyAbility: 'wis' }));
    expect(cleric.host.querySelector('[data-setupcard="Deity"]')!.textContent, 'the required card lost its hint').toContain(WARN);
    cleric.stop();
  });

  it('an optional deity can be cleared again ("No deity"); a required one offers no such action', () => {
    const changed: string[] = [];
    const actions = { patch: () => undefined, changeDeity: (id: string) => changed.push(id) } as unknown as BuilderActions;
    const open = (b: BuildState, title: string) => {
      const r = renderDom(<OriginPickers build={b} actions={actions} content={db} />);
      const card = r.host.querySelector(`[data-setupcard="${title}"]`)!;
      r.click(card.querySelector('.ss-replace'));
      return r;
    };
    const r = open(fighter({ deityId: 'sarenrae' }), 'Deity (optional)');
    const clear = r.host.querySelector('.picker .picker-clear');
    expect(clear?.textContent, 'no way back to "no deity" for a follower').toContain('No deity');
    // An action below the list, never a fake option counted among the 486 deities.
    expect([...r.host.querySelectorAll('.picker-name')].some((el) => el.textContent === 'No deity')).toBe(false);
    r.click(clear);
    expect(changed).toEqual(['']);
    r.stop();
    const cleric = open({ ...fighter({ classId: 'cleric', subclassId: 'cloistered-cleric', keyAbility: 'wis' }), deityId: 'sarenrae' }, 'Deity');
    expect(cleric.host.querySelector('.picker .picker-clear')).toBeNull();
    cleric.stop();
  });

  it('a Razmiran priest who takes Cleric Dedication is offered only Razmir', () => {
    const b = fighter({ level: 6, featPicks: { '2:class:0': 'razmiran-priest-dedication', '4:class:0': 'cleric-dedication' } });
    const r = renderDom(<OriginPickers build={b} actions={noActions} content={db} />);
    const control = r.host.querySelector('[data-setupcard="Deity"] [data-ctl="search"]');
    expect(control?.getAttribute('data-ctl-options')).toBe(String(Object.keys(db.deities).length));
    expect(control?.getAttribute('data-ctl-live'), 'every deity but Razmir must be greyed').toBe('1');
    r.stop();
    expect(setupMissing({ ...b, deityId: 'sarenrae' }, db).some((s) => s.startsWith('Deity — ') && /Razmir/.test(s))).toBe(true);
    expect(setupMissing({ ...b, deityId: 'razmir' }, db).some((s) => s.startsWith('Deity'))).toBe(false);
    // …even while Razmir's book is switched off (the picked feats stay; the record drops out of the list).
    const { razmir: _gone, ...noRazmir } = db.deities;
    expect(setupMissing({ ...b, deityId: 'sarenrae' }, { ...db, deities: noRazmir }).some((s) => /Razmir/.test(s))).toBe(true);
  });

  it('a fighter changing deity is not asked to give up a divine font they never had', () => {
    /* The reducer settles a one-font deity's font on ANY build (Sarenrae → heal), and the swap dialog
     * listed it: found in the browser, a fighter going Sarenrae → Asmodeus was asked to confirm
     * "This clears Divine font — Heal". The cleric's half of this dialog is pinned in
     * test/bug-change-subclass-deity-confirm.test.tsx. */
    const calls: string[] = [];
    requestDeityChange('asmodeus', fighter({ deityId: 'sarenrae', divineFont: 'heal' }), db, { changeDeity: (id: string) => calls.push(id) } as unknown as BuilderActions);
    expect(calls, 'a dialog stood between the fighter and the change').toEqual(['asmodeus']);
  });

  it('the Details tab prints a fighter’s deity', () => {
    const r = renderDom(<DetailsTab character={buildCharacter(fighter({ deityId: 'sarenrae' }), db)} content={db} />);
    expect(r.host.textContent).toContain('Sarenrae');
    r.stop();
  });
});

describe('2 · a plain follower gets only what every follower gets', () => {
  const ch = buildCharacter(fighter({ deityId: 'sarenrae' }), db);

  it('no favored-weapon proficiency', () => {
    expect(buildNeedsDeity(fighter({ deityId: 'sarenrae' }), db)).toBe(false);
    expect(ch.proficiencies.weaponOverrides?.['scimitar']).toBeUndefined();
  });

  it('a Cleric Dedication caster of Sarenrae, carrying a stored "heal" font, gets no divine font and no domain spell', () => {
    /* The swap reducer settles a one-font deity's font on ANY build, so a dedicant really does carry
     * `divineFont: 'heal'`. It has a spellcasting entry for a font to land on — and must not get one:
     * Cleric Dedication prints "You don't gain any other abilities from your choice of deity". */
    const ded = buildCharacter(fighter({ level: 6, deityId: 'sarenrae', divineFont: 'heal', featPicks: { '2:class:0': 'cleric-dedication', '4:class:0': 'basic-cleric-spellcasting' } }), db);
    expect(ded.spellcasting.length, 'the dedication must build a casting entry for this check to mean anything').toBeGreaterThan(0);
    expect(ded.spellcasting.some((e) => e.font)).toBe(false);
    expect(ded.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.prepared ?? {}).flat())).toEqual([]);
    expect(ded.proficiencies.weaponOverrides?.['scimitar']).toBeUndefined();
  });

  it('no sanctification — a "must be holy" deity does not make a fighter holy, and the card does not ask', () => {
    const iomedae = fighter({ deityId: 'iomedae' });
    const built = buildCharacter(iomedae, db);
    expect(sanctificationOf(built, db)).toBeNull();
    expect((built.effectPicks ?? []).filter((p) => p.recordId === 'iomedae')).toEqual([]);
    expect(built.chosenCreatureTraits ?? []).toEqual([]);
    const r = renderDom(<OriginPickers build={fighter({ deityId: 'lurlup' })} actions={{ patch: () => undefined } as unknown as BuilderActions} content={db} />);
    const card = r.host.querySelector('[data-setupcard="Deity (optional)"]')!;
    expect(card.querySelector('[data-ctl-title="Sanctification"]'), 'a fighter is asked a question nothing reads').toBeNull();
    r.stop();
  });

  it('…while a cleric is still asked it, and still gets the trait', () => {
    const cleric = { ...fighter({ classId: 'cleric', subclassId: 'cloistered-cleric', keyAbility: 'wis' }), deityId: 'lurlup' } as BuildState;
    const r = renderDom(<OriginPickers build={cleric} actions={{ patch: () => undefined } as unknown as BuilderActions} content={db} />);
    expect(r.host.querySelector('[data-setupcard="Deity"] [data-ctl-title="Sanctification"]')).toBeTruthy();
    r.stop();
    const iomedae = buildCharacter({ ...cleric, deityId: 'iomedae' }, db);
    expect((iomedae.chosenCreatureTraits ?? []).map((t) => t.trait)).toContain('holy');
  });
});

describe('3 · every record that says "choose a deity" makes the deity required', () => {
  /** Records whose text says it and whose deity question is answered somewhere else, each with why. */
  const ASKED_ELSEWHERE: Record<string, string> = {
    'feats/divine-access': "the deity Divine Access draws on, asked by the feat's own text field — not your own deity",
    'classFeatures/divine-access': 'the same Divine Access deity, on its oracle feature twin',
    'heritages/forge-blessed-dwarf': "the family's patron dwarven deity, asked by the heritage's own picker",
    'feats/vigilant-benediction': "a deity from the feat's own list, chosen only to name the spell it grants (\"select a deity the GM deems appropriate\")",
  };
  const found = scan(/\b(?:choose|select)\s+(?:a|one)\s+deity\b|\bmust choose a deity\b/i);

  it('the scan finds the records it was written against', () => {
    for (const k of ['feats/cleric-dedication', 'feats/champion-dedication', 'classFeatures/vindicator', 'classFeatures/avenger', 'classFeatures/deity-champion'])
      expect(found).toContain(k);
  });

  it.each(found)('%s', (key) => {
    if (ASKED_ELSEWHERE[key]) return;
    const b = buildFor(key);
    expect(b, `${key} says "choose a deity" but is no feat, class feature or subclass this test can build — handle it or add it to ASKED_ELSEWHERE with a reason`).toBeTruthy();
    expect(buildUsesDeity(b!, db), `${key} prints "choose a deity" and the Deity card stays optional`).toBe(true);
    expect(setupMissing(b!, db)).toContain('Deity');
    expect(setupMissing({ ...b!, deityId: 'sarenrae' }, db)).not.toContain('Deity');
  });

  it('a dedication that needs a deity still gets no favored weapon (that is a cleric benefit)', () => {
    for (const id of DEITY_CHOOSING_FEATS) {
      const lvl = Math.max(2, db.feats[id].level);
      const b = fighter({ level: lvl, deityId: 'sarenrae', featPicks: { [`${lvl}:class:0`]: id } });
      expect(buildNeedsDeity(b, db), id).toBe(false);
      expect(buildCharacter(b, db).proficiencies.weaponOverrides?.['scimitar'], id).toBeUndefined();
    }
  });

  it('Mortal Herald Dedication ("a mortal herald of your deity") makes the deity required too', () => {
    // It never says "choose a deity" — its prerequisite is already a worshiper of a specific deity.
    const b = fighter({ level: 12, featPicks: { '12:class:0': 'mortal-herald-dedication' } });
    expect(setupMissing(b, db)).toContain('Deity');
  });
});

describe('3b · every record that hands over "your deity\'s sanctification" delivers it', () => {
  /* Two shapes: a record with its OWN sanctification choice that must follow the deity
   * (`SANCTIFICATION_FROM_DEITY`, pinned in section 4), and a record with none, whose sanctification IS
   * the answer on the deity's card (the cleric, the Vindicator, the Mortal Herald). The second shape is
   * the one the any-class gate could silently switch off. */
  const found = scan(/your deity's sanctification|that deity's divine sanctification|according to your deity|depending on your deity, their sanctification/i);

  it('the scan finds the records it was written against', () => {
    for (const k of ['feats/cleric-dedication', 'classFeatures/deity-champion', 'classFeatures/deity-cleric', 'classFeatures/vindicator', 'feats/mortal-herald-dedication'])
      expect(found).toContain(k);
  });

  it.each(found)('%s', (key) => {
    const id = key.split('/')[1];
    if (SANCTIFICATION_FROM_DEITY.has(id)) return; // its own choice follows the deity — section 4
    const b = buildFor(key, { deityId: 'iomedae' });
    expect(b, `${key} hands over the deity's sanctification but is nothing this test can build`).toBeTruthy();
    // A "must be holy" deity makes them holy without a click…
    expect((buildCharacter(b!, db).chosenCreatureTraits ?? []).map((t) => t.trait), `${key}: Iomedae must make them holy`).toContain('holy');
    // …and a "can be" deity asks them, on the Deity card.
    const abadar = db.deities['abadar'].effectChoices!.find((e) => e.id === 'sanctification')!;
    expect(effectChoiceOffered(abadar, { ...b!, deityId: 'abadar' }, db, 'abadar'), `${key}: the Deity card must ask`).toBe(true);
  });

  const traits = (b: BuildState) => (buildCharacter(b, db).chosenCreatureTraits ?? []).map((t) => t.trait).sort();
  const herald = (over: Partial<BuildState> = {}) => fighter({ level: 12, featPicks: { '12:class:0': 'mortal-herald-dedication' }, ...over });

  it('a "can be" deity left unanswered is named in the choices left for a Vindicator or Mortal Herald', () => {
    const vin = fighter({ classId: 'ranger', subclassId: 'vindicator', deityId: 'abadar' });
    expect(setupMissing(vin, db)).toContain('Sanctification (Abadar)');
    expect(setupMissing({ ...vin, effectChoices: { 'abadar:sanctification': 'none' } }, db)).not.toContain('Sanctification (Abadar)');
    expect(setupMissing(herald({ deityId: 'abadar' }), db)).toContain('Sanctification (Abadar)');
    expect(setupMissing(herald({ deityId: 'iomedae' }), db).some((s) => s.startsWith('Sanctification')), 'a "must be" deity asks nothing').toBe(false);
  });

  it('a Mortal Herald pick above the character\'s level sanctifies nobody', () => {
    // The Builder keeps a pick when the level is lowered; buildCharacter drops the feat, and so must this.
    expect(traits(herald({ level: 11, deityId: 'iomedae' }))).toEqual([]);
    expect(traits(herald({ deityId: 'iomedae' }))).toEqual(['holy']);
  });

  it('a Mortal Herald who already answers through Cleric Dedication gets ONE sanctification, not two', () => {
    const b = fighter({
      level: 12,
      deityId: 'abadar',
      featPicks: { '2:class:0': 'cleric-dedication', '12:class:0': 'mortal-herald-dedication' },
      featChoices: { '2:class:0': 'holy' },
      effectChoices: { 'abadar:sanctification': 'unholy' },
    });
    expect(traits(b)).toEqual(['holy']);
    const abadar = db.deities['abadar'].effectChoices!.find((e) => e.id === 'sanctification')!;
    expect(effectChoiceOffered(abadar, b, db, 'abadar'), 'the card must not ask a second time').toBe(false);
  });

  /*
   * mutation-proof — THE TRUST LANE. The Mortal Herald's holy/unholy trait is a benefit the feat
   * delivers in CODE, so scripts/data/trust-lanes.json lists it `"kind": "trait", "gated": true` — a
   * claim trust-lanes-check cannot verify (it asks only that the id is listed). Drop the `forTrait`
   * guard in takesDeitySanctification and this `it` is the only failure. Only the trait read is the
   * lane: asking and counting the deity card's question is builder structure (docs/trust-gate.md
   * section 1), and the Vindicator is class-owned, so neither may go quiet with it.
   */
  it('the Mortal Herald\'s trait goes quiet while its engine lane is off; the question and a Vindicator\'s trait do not', () => {
    const vin = fighter({ classId: 'ranger', subclassId: 'vindicator', deityId: 'iomedae' });
    const vinHerald = { ...vin, level: 12, featPicks: { '12:class:0': 'mortal-herald-dedication' } } as BuildState;
    const abadar = db.deities['abadar'].effectChoices!.find((e) => e.id === 'sanctification')!;
    setEngineTrustOff(['mortal-herald-dedication']);
    try {
      expect(traits(herald({ deityId: 'iomedae' })), 'the trait is the lane, and the lane is off').toEqual([]);
      expect(traits(vin), 'a Vindicator is class-owned, never this lane').toEqual(['holy']);
      expect(traits(vinHerald), 'a Vindicator who also took the feat keeps the trait through the subclass').toEqual(['holy']);
      expect(effectChoiceOffered(abadar, herald({ deityId: 'abadar' }), db, 'abadar'), 'the question is builder structure').toBe(true);
      expect(setupMissing(herald({ deityId: 'abadar' }), db)).toContain('Sanctification (Abadar)');
    } finally {
      // The setter is module-global: a leaked OFF list would silently darken the rest of the suite.
      setEngineTrustOff([]);
    }
    // …and with it back on, the trait returns — so the empty list above is the gate, not a bug.
    expect(traits(herald({ deityId: 'iomedae' }))).toEqual(['holy']);
    expect(traits(vinHerald)).toEqual(['holy']);
  });

  it("…and a champion's explicit 'none' is not overruled by a stale deity-card answer", () => {
    const b = {
      ...herald({ classId: 'champion', keyAbility: 'str', deityId: 'abadar' }),
      featChoices: { 'feature:deity-champion': 'none' },
      effectChoices: { 'abadar:sanctification': 'holy' },
    } as BuildState;
    expect(traits(b)).toEqual([]);
  });
});

describe('4 · a sanctification that follows the deity offers only what the deity allows', () => {
  const ded = (featId: string, deityId: string | null, answer?: string) =>
    fighter({ deityId, featPicks: { '2:class:0': featId }, featChoices: answer ? { '2:class:0': answer } : {} });

  it.each(['cleric-dedication', 'champion-dedication'])('%s: greyed by the deity, with the reason', (featId) => {
    const def = db.feats[featId].choice!;
    expect(greyed(picker(featId, def, ded(featId, null))), 'no deity yet: the whole list').toEqual([]);
    expect(greyed(picker(featId, def, ded(featId, 'sarenrae'))), 'Sarenrae: can be holy').toEqual(['unholy']);
    expect(greyed(picker(featId, def, ded(featId, 'abadar'))), 'Abadar: can be holy or unholy').toEqual([]);
    expect(greyed(picker(featId, def, ded(featId, 'iomedae'))), 'Iomedae: must be holy').toEqual(['none', 'unholy']);
    expect(greyed(picker(featId, def, ded(featId, 'pharasma'))), 'Pharasma: no sanctification').toEqual(['holy', 'unholy']);
    expect(picker(featId, def, ded(featId, 'sarenrae')).find((o) => o.value === 'unholy')?.disabled).toBe('Sarenrae allows only: holy, none.');
  });

  it("the champion's own Deity feature follows the deity the same way", () => {
    const def = db.classFeatures['deity-champion'].choice!;
    const champ = { ...fighter({ classId: 'champion', keyAbility: 'str' }), deityId: 'asmodeus' } as BuildState;
    expect(greyed(picker('deity-champion', def, champ))).toEqual(['holy', 'none']);
  });

  it('an answer the deity does not allow is named in the choices left, on the dedication\'s own level, never swapped', () => {
    const b = ded('cleric-dedication', 'sarenrae', 'unholy');
    const off = levelChoices(b, db).filter((c) => /Sanctification/.test(c.label));
    expect(off).toEqual([{ page: 2, label: 'Level 2 — Sanctification (Cleric Dedication): Unholy — Sarenrae allows only: holy, none.', required: true }]);
    expect(b.featChoices['2:class:0']).toBe('unholy');
    expect(levelChoices(ded('cleric-dedication', 'sarenrae', 'holy'), db).some((c) => /Sanctification/.test(c.label))).toBe(false);
    // A pick above the character's level is not held — no warning for a page the strip does not show.
    expect(levelChoices({ ...b, level: 1 }, db).some((c) => /Sanctification/.test(c.label))).toBe(false);
  });

  it("an exemplar's Sanctified Soul belongs to no deity and is never narrowed by one", () => {
    const def = db.feats['sanctified-soul']?.choice;
    expect(def?.flag).toBe('sanctification');
    expect(greyed(picker('sanctified-soul', def!, fighter({ deityId: 'pharasma', featPicks: { '1:class:0': 'sanctified-soul' } })))).toEqual([]);
  });
});
