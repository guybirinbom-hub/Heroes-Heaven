// @vitest-environment jsdom
/*
 * A SORCERER IS DRAWN ITS OWN DRAGON'S, ELEMENT'S OR GENIE'S GIFTS (2026-10-21).
 *
 * Three bloodlines give a different sorcerous gift per VARIANT at some ranks:
 *   · draconic (bloodline-23) — per dragon exemplar at 2nd, 5th and 8th; each exemplar's own page
 *     (draconic-exemplar-1 to -44) prints its row;
 *   · elemental (bloodline-24) — per elemental influence at cantrip, 1st, 3rd and 6th;
 *   · genie (bloodline-11) — per genie type at 2nd, 5th and 8th.
 * The record carried one flat `grantedSpells` list, so the app drew every variant's gift at once with
 * "the app can't tell which yet" (lane C4) — the owner's screenshot showed a draconic sorcerer's 2nd
 * rank holding Blazing Bolt, Augury, Blood Vendetta and Shatter. `giftVariants` carries each variant's
 * row; the dragon is answered by the exemplar question the builder already asked, the element and the
 * genie type by a question of their own on Level 0.
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { OriginPickers, type BuilderActions } from '../src/builder/shared';
import { Builder } from '../src/builder/Builder';
import { ContentContext } from '../src/sheet/ContentContext';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { sourceCatalog } from '../src/rules/sources';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, levelChoices, optionGiftVariant, setupMissing, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { repertoireCap, variantGiftCount } from '../src/rules/spellOptions';
import { unansweredGiftNote, variantGiftNote } from '../src/rules/spellcasting';
import type { Character, ContentDatabase, SpellcastingEntry, SubclassOption } from '../src/rules/types';

const db = content();
const noop = () => undefined;
const option = (id: string): SubclassOption => db.classes.sorcerer!.subclass!.options.find((o) => o.id === id)!;
const sorc = (level: number, subclassId: string, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Gift test',
    level,
    classId: 'sorcerer',
    subclassId,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'cha',
    ...over,
  }) as BuildState;
const entry = (ch: Character): SpellcastingEntry => ch.spellcasting.find((e) => e.id === 'sorcerer-casting')!;
const casting = (b: BuildState) => entry(buildCharacter(b, db));
const ranksOf = (o: SubclassOption) => [...new Set(o.giftVariants!.options.flatMap((v) => v.gifts.map((g) => g.rank)))].sort((a, b) => a - b);
const giftsAt = (e: SpellcastingEntry, rank: number) => (rank === 0 ? e.grantedCantrips : e.grantedRepertoire?.[rank]) ?? [];

describe('the data: every printed variant carries its own gifts', () => {
  it('draconic: one row per printed exemplar, at 2nd, 5th and 8th, keyed by the builder\'s dragon list', () => {
    const o = option('bloodline-draconic');
    expect(o.giftVariants?.answeredBy).toBe('dragon');
    expect(o.giftVariants?.options).toHaveLength(44);
    expect(ranksOf(o)).toEqual([2, 5, 8]);
    const row = (slug: string) => o.giftVariants!.options.find((v) => v.slug === slug)?.gifts.map((g) => `${g.rank}:${g.id}`);
    // Player Core 2 pg. 150 (draconic-exemplar-41 to -44) and two Draconic Codex rows.
    expect(row('arcane')).toEqual(['2:blazing-bolt', '5:subconscious-suggestion', '8:quandary']);
    expect(row('divine')).toEqual(['2:augury', '5:divine-immolation', '8:divine-inspiration']);
    expect(row('occult')).toEqual(['2:blood-vendetta', '5:slither', '8:unrelenting-observation']);
    expect(row('primal')).toEqual(['2:shatter', '5:howling-blizzard', '8:earthquake']);
    expect(row('adamantine')).toEqual(['2:shatter', '5:impaling-spike', '8:earthquake']);
    // The Sovereign dragon's 5th-rank gift is a 3rd-rank spell: the row says the rung print names.
    expect(row('sovereign')).toEqual(['2:clear-mind', '5:overwhelming-memory', '8:dream-council']);
    expect(db.spells['overwhelming-memory']?.rank, 'fixture').toBe(3);
    // Every dragon the builder offers resolves to a row — its own, or (the ten older dragons) its tradition's.
    for (const d of o.dragonChoice!) {
      const v = optionGiftVariant(o, { dragonExemplar: d.slug });
      expect(v, d.slug).toBeTruthy();
      expect([d.slug, d.tradition], d.slug).toContain(v!.slug);
    }
    // …and every row is a dragon's, and exactly the ten older dragons have none of their own. A row whose
    // slug no dragon carries (a typo, a regen) would leave its dragon on the tradition's gifts with every
    // other check green (a final check, 2026-10-21).
    const dragons = new Set(o.dragonChoice!.map((d) => d.slug));
    expect(o.giftVariants!.options.filter((v) => !dragons.has(v.slug)).map((v) => v.slug)).toEqual([]);
    const rows = new Set(o.giftVariants!.options.map((v) => v.slug));
    expect(o.dragonChoice!.filter((d) => !rows.has(d.slug)).map((d) => d.slug).sort()).toEqual(
      ['black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'red', 'silver', 'white'],
    );
  });

  it('elemental: six influences at cantrip, 1st, 3rd and 6th; genie: five types at 2nd, 5th and 8th', () => {
    const el = option('bloodline-elemental');
    expect(el.giftVariants?.answeredBy).toBe('choice');
    expect(el.giftVariants?.options.map((v) => v.slug)).toEqual(['air', 'earth', 'fire', 'metal', 'water', 'wood']);
    expect(ranksOf(el)).toEqual([0, 1, 3, 6]);
    expect(el.giftVariants!.options.find((v) => v.slug === 'fire')!.gifts.map((g) => g.id)).toEqual(['ignition', 'breathe-fire', 'fireball', 'tree-of-seasons']);
    expect(el.giftVariants!.options.find((v) => v.slug === 'metal')!.gifts.map((g) => g.id)).toEqual(['electric-arc', 'thunderstrike', 'lightning-bolt', 'chain-lightning']);
    const ge = option('bloodline-genie');
    expect(ge.giftVariants?.options.map((v) => v.slug)).toEqual(['janni', 'jaathoom', 'ifrit', 'faydhaan', 'jabali']);
    expect(ranksOf(ge)).toEqual([2, 5, 8]);
    expect(ge.giftVariants!.options.find((v) => v.slug === 'janni')!.gifts.map((g) => g.id)).toEqual(['create-food', 'banishment', 'confusing-colors']);
  });

  it('every gift is a real spell, and no variant gift is also one of the shared gifts', () => {
    for (const id of ['bloodline-draconic', 'bloodline-elemental', 'bloodline-genie']) {
      const o = option(id);
      const variant = new Set(o.giftVariants!.options.flatMap((v) => v.gifts.map((g) => g.id)));
      for (const g of variant) expect(db.spells[g], `${id}: ${g}`).toBeTruthy();
      // `optionGifts` drops every variant id from the flat list, so a shared gift listed by a variant too
      // would vanish from every character. The shared lists, exactly:
      const shared = (o.grantedSpells ?? []).filter((s) => !variant.has(s));
      expect(shared, id).toEqual(
        {
          'bloodline-draconic': ['shield', 'fear', 'haste', 'fly', 'dragon-form', 'mask-of-terror', 'overwhelming-presence'],
          'bloodline-elemental': ['resist-energy', 'unfettered-movement', 'elemental-form', 'energy-aegis', 'earthquake', 'wrathful-storm'],
          'bloodline-genie': ['detect-magic', 'illusory-disguise', 'enthrall', 'creation', 'truesight', 'energy-aegis', 'resplendent-mansion'],
        }[id],
      );
    }
  });
});

describe('the build draws the chosen variant\'s gifts, and only them', () => {
  // mutation-proof
  it('draconic: every dragon in the builder\'s list gets its own row at 2nd/5th/8th, in its own tradition', () => {
    const o = option('bloodline-draconic');
    for (const d of o.dragonChoice!) {
      const e = casting(sorc(17, 'bloodline-draconic', { dragonExemplar: d.slug }));
      // The expected row from the data, not from `optionGiftVariant` — the build's own lookup.
      const v = o.giftVariants!.options.find((x) => x.slug === d.slug) ?? o.giftVariants!.options.find((x) => x.slug === d.tradition)!;
      for (const g of v.gifts) expect(giftsAt(e, g.rank), `${d.slug} ${g.rank}`).toEqual([g.id]);
      expect(e.tradition, d.slug).toBe(d.tradition);
      for (let r = 0; r <= 9; r++) expect(variantGiftCount(e, r), `${d.slug} rank ${r}`).toBe(0);
      expect(e.giftVariantAsk).toBeUndefined();
    }
  });

  it('draconic: the shared gifts stay, a re-filed gift sits at print\'s rank, an unchosen dragon casts and gifts as the first', () => {
    const sov = casting(sorc(9, 'bloodline-draconic', { dragonExemplar: 'sovereign' }));
    expect(giftsAt(sov, 5)).toEqual(['overwhelming-memory']);
    expect(giftsAt(sov, 3), 'Haste, the shared 3rd-rank gift, alone at 3rd').toEqual(['haste']);
    expect(giftsAt(sov, 1)).toEqual(['fear']);
    expect(sov.cantrips).toContain('shield');
    // One fallback for tradition and gifts: an unanswered dragon casts arcane, so its gifts are arcane's —
    // and the builder still lists the question as unanswered.
    const none = sorc(9, 'bloodline-draconic');
    expect(casting(none).tradition).toBe('arcane');
    expect(giftsAt(casting(none), 2)).toEqual(['blazing-bolt']);
    expect(setupMissing(none, db)).toContain('Dragon exemplar');
    // …and the entry names the open question and the three gifts it decides, so each can say so.
    expect(casting(none).giftVariantAsk).toBe('Dragon exemplar');
    expect(casting(none).giftVariantIds).toEqual(['blazing-bolt', 'subconscious-suggestion', 'quandary']);
    expect(casting(sorc(9, 'bloodline-draconic', { dragonExemplar: 'arcane' })).giftVariantIds).toBeUndefined();
  });

  // mutation-proof
  it('elemental and genie: each answer draws its own row; unanswered draws all, says which question, and is listed', () => {
    for (const v of option('bloodline-elemental').giftVariants!.options) {
      const b = sorc(11, 'bloodline-elemental', { subclassVariant: { 'bloodline-elemental': v.slug } });
      const e = casting(b);
      for (const g of v.gifts) expect(giftsAt(e, g.rank), `${v.slug} ${g.rank}`).toEqual([g.id]);
      expect(giftsAt(e, 2), 'the shared 2nd-rank gift').toEqual(['resist-energy']);
      expect(giftsAt(e, 5)).toEqual(['elemental-form']);
      expect(e.giftVariantAsk).toBeUndefined();
      expect(setupMissing(b, db)).not.toContain('Elemental influence');
    }
    for (const v of option('bloodline-genie').giftVariants!.options) {
      const e = casting(sorc(15, 'bloodline-genie', { subclassVariant: { 'bloodline-genie': v.slug } }));
      for (const g of v.gifts) expect(giftsAt(e, g.rank), `${v.slug} ${g.rank}`).toEqual([g.id]);
      expect(giftsAt(e, 3)).toEqual(['enthrall']);
    }
    const open = sorc(11, 'bloodline-elemental');
    expect(casting(open).giftVariantAsk).toBe('Elemental influence');
    expect(giftsAt(casting(open), 0)).toHaveLength(6);
    expect(setupMissing(open, db)).toContain('Elemental influence');
    // An answer that names no variant (a typo, an older name) is no answer.
    const stale = sorc(5, 'bloodline-genie', { subclassVariant: { 'bloodline-genie': 'djinni' } });
    expect(casting(stale).giftVariantAsk).toBe('Genie type');
    expect(giftsAt(casting(stale), 2)).toHaveLength(5);
    expect(setupMissing(stale, db)).toContain('Genie type');
    // A bloodline with no variants asks nothing.
    expect(setupMissing(sorc(5, 'bloodline-angelic'), db)).not.toContain('Elemental influence');
  });

  // mutation-proof
  it('another genie\'s gift is a pick of the player\'s own: it takes a place, and survives a rebuild from the sheet', () => {
    // Jaathoom's 2nd-rank gift is Invisibility; a janni sorcerer who learns it spends a place on it.
    const b = sorc(7, 'bloodline-genie', { subclassVariant: { 'bloodline-genie': 'janni' }, spells: { 2: ['invisibility', 'blur', 'mist'] } });
    const ch = buildCharacter(b, db);
    const e = entry(applyPlayState(ch, initialPlay(ch, db), db));
    expect(e.grantedRepertoire?.[2]).toEqual(['create-food']);
    expect(e.repertoire?.[2]).toEqual(['create-food', 'invisibility', 'blur', 'mist']);
    expect(repertoireCap(e, 2)).toBe(3);
    expect(e.overCap).toBeUndefined();
    // The reverse build (a character with no stored build) reads back only what the entry was drawn as
    // a gift — the option's whole list took Invisibility for a gift and lost the pick.
    expect(deriveBuildFromCharacter(ch, db).spells[2]).toEqual(['invisibility', 'blur', 'mist']);
  });

  // mutation-proof
  it('the reverse build reads the answer back from the gifts drawn, and leaves it open where they fit several', () => {
    const back = (b: BuildState) => deriveBuildFromCharacter(buildCharacter(b, db), db);
    const variant = (b: BuildState) => back(b).subclassVariant ?? {};
    // A character with no stored build lost the element, and the rebuilt one drew all six again.
    expect(variant(sorc(11, 'bloodline-elemental', { subclassVariant: { 'bloodline-elemental': 'fire' } }))).toEqual({ 'bloodline-elemental': 'fire' });
    expect(variant(sorc(1, 'bloodline-elemental', { subclassVariant: { 'bloodline-elemental': 'water' } }))).toEqual({ 'bloodline-elemental': 'water' });
    expect(variant(sorc(5, 'bloodline-genie', { subclassVariant: { 'bloodline-genie': 'janni' } }))).toEqual({ 'bloodline-genie': 'janni' });
    // Before 2nd rank no genie gift is drawn: nothing tells the types apart, so nothing is guessed.
    expect(variant(sorc(1, 'bloodline-genie', { subclassVariant: { 'bloodline-genie': 'janni' } }))).toEqual({});
    expect(variant(sorc(11, 'bloodline-elemental'))).toEqual({});
    // The Sky dragon shares Augury (2nd) with the Divine row and differs at 5th: open at level 3, read back at 9.
    expect(back(sorc(3, 'bloodline-draconic', { dragonExemplar: 'sky' })).dragonExemplar ?? null).toBeNull();
    expect(back(sorc(9, 'bloodline-draconic', { dragonExemplar: 'sky' })).dragonExemplar).toBe('sky');
    expect(back(sorc(17, 'bloodline-draconic', { dragonExemplar: 'divine' })).dragonExemplar).toBe('divine');
    // The ten older dragons cast arcane and use the Arcane row, so an arcane row names no one dragon.
    expect(back(sorc(17, 'bloodline-draconic', { dragonExemplar: 'red' })).dragonExemplar ?? null).toBeNull();
    // What it reads back draws the same gifts again.
    const rebuilt = back(sorc(9, 'bloodline-draconic', { dragonExemplar: 'sky' }));
    expect(giftsAt(entry(buildCharacter({ ...rebuilt, level: 9 } as BuildState, db)), 5)).toEqual(['lightning-storm']);
  });

  // mutation-proof
  it('an entry built before the question existed answers nothing: it drew several gifts at one rank', () => {
    // The old flat list drew the four tradition rows at 2nd, 5th and 8th. The row of the entry's own
    // tradition is one of the 44 and always fit, so an Umbral dragon came back "occult" and an
    // Adamantine one "primal" — a guess the next Save would have stored (a final check, 2026-10-21).
    const OLD: Record<number, string[]> = {
      2: ['blazing-bolt', 'augury', 'blood-vendetta', 'shatter'],
      5: ['subconscious-suggestion', 'divine-immolation', 'slither', 'howling-blizzard'],
      8: ['quandary', 'divine-inspiration', 'unrelenting-observation', 'earthquake'],
    };
    const oldShape = (b: BuildState) => {
      const ch = buildCharacter(b, db);
      const e = entry(ch);
      for (const [r, ids] of Object.entries(OLD)) if (e.grantedRepertoire?.[Number(r)]?.length) e.grantedRepertoire[Number(r)] = [...ids];
      return deriveBuildFromCharacter(ch, db);
    };
    expect(oldShape(sorc(3, 'bloodline-draconic', { dragonExemplar: 'umbral' })).dragonExemplar ?? null).toBeNull();
    expect(oldShape(sorc(5, 'bloodline-draconic', { dragonExemplar: 'sage' })).dragonExemplar ?? null).toBeNull();
    expect(oldShape(sorc(17, 'bloodline-draconic', { dragonExemplar: 'adamantine' })).dragonExemplar ?? null).toBeNull();
    // An entry drawn with the answer is still read back.
    expect(deriveBuildFromCharacter(buildCharacter(sorc(17, 'bloodline-draconic', { dragonExemplar: 'adamantine' }), db), db).dragonExemplar).toBe('adamantine');
    // …even when a FEAT drew another element's gift beside its own: an air sorcerer who learns Breathe
    // Fire (fire's 1st-rank gift) through Adaptive Adept is still air (a re-check, 2026-10-21).
    const adept = sorc(6, 'bloodline-elemental', {
      subclassVariant: { 'bloodline-elemental': 'air' },
      featPicks: { '1:ancestry:0': 'adapted-cantrip', '5:ancestry:0': 'adaptive-adept' },
      featChoices: { '1:ancestry:0': 'frosts-touch', '5:ancestry:0': 'breathe-fire' },
    } as Partial<BuildState>);
    const adeptCh = buildCharacter(adept, db);
    expect(entry(adeptCh).grantedRepertoire?.[1], 'fixture: two element gifts at 1st, one of them the feat\'s').toEqual(['tailwind', 'breathe-fire']);
    expect(entry(adeptCh).spellSources?.['breathe-fire']).toBe('Adaptive Adept');
    expect(deriveBuildFromCharacter(adeptCh, db).subclassVariant).toEqual({ 'bloodline-elemental': 'air' });
    // …and the player's OWN Breathe Fire at 3rd stays theirs: the feat's copy at 1st made fire's gift
    // look drawn, and the rebuild dropped the pick as a gift (a last check, 2026-10-21).
    const ownToo = buildCharacter({ ...adept, spells: { 3: ['breathe-fire'] } } as BuildState, db);
    expect(entry(ownToo).repertoire?.[3], 'fixture: the own pick at 3rd').toContain('breathe-fire');
    expect(deriveBuildFromCharacter(ownToo, db).spells[3]).toEqual(['breathe-fire']);
  });
});

describe('the builder asks the element and genie questions on Level 0', () => {
  function page(build: BuildState, title: string) {
    const patches: Partial<BuildState>[] = [];
    const actions = { patch: (p: Partial<BuildState>) => patches.push(p) } as unknown as BuilderActions;
    const r = renderDom(<OriginPickers build={build} actions={actions} content={db} />);
    const control = [...r.host.querySelectorAll('[data-ctl="popup"]')].find((el) => el.getAttribute('data-ctl-title') === title);
    return { ...r, patches, control };
  }

  // mutation-proof
  it('an elemental sorcerer: an empty six-answer question, each answer naming its gifts; choosing Fire stores it', () => {
    const r = page(sorc(1, 'bloodline-elemental'), 'Elemental influence');
    try {
      expect(r.control, 'Level 0 mounts no element question').toBeTruthy();
      expect(r.control!.getAttribute('data-ctl-options')).toBe('6');
      expect(r.control!.getAttribute('data-ctl-state')).toBe('empty');
      r.click(r.control!);
      const fire = [...r.host.querySelectorAll('.picker-item')].find((x) => (x.textContent ?? '').includes('Fire'));
      expect(fire, 'no Fire row').toBeTruthy();
      expect(fire!.textContent).toContain('Cantrip: Ignition · 1st rank: Breathe Fire · 3rd rank: Fireball · 6th rank: Tree of Seasons');
      r.click(fire!);
    } finally {
      r.stop();
    }
    expect(Object.assign({}, ...r.patches).subclassVariant).toEqual({ 'bloodline-elemental': 'fire' });
    // Answered, the control shows it.
    const done = page(sorc(1, 'bloodline-elemental', { subclassVariant: { 'bloodline-elemental': 'fire' } }), 'Elemental influence');
    try {
      expect(done.control!.getAttribute('data-ctl-state')).toBe('picked');
    } finally {
      done.stop();
    }
  });

  it('a genie sorcerer gets the genie-type question; a dragon\'s answers name their gifts; other bloodlines get neither', () => {
    const g = page(sorc(1, 'bloodline-genie'), 'Genie type');
    try {
      expect(g.control?.getAttribute('data-ctl-options')).toBe('5');
    } finally {
      g.stop();
    }
    const d = page(sorc(1, 'bloodline-draconic'), 'Dragon exemplar');
    try {
      d.click(d.control!);
      const adamantine = [...d.host.querySelectorAll('.picker-item')].find((x) => (x.textContent ?? '').includes('Adamantine'));
      expect(adamantine?.textContent).toContain('2nd rank: Shatter · 5th rank: Impaling Spike · 8th rank: Earthquake');
    } finally {
      d.stop();
    }
    // The Dragon card carries the same "still to answer" mark as every other open question.
    const pendingMark = (b: BuildState) => {
      const r = renderDom(<OriginPickers build={b} actions={{ patch: noop } as unknown as BuilderActions} content={db} />);
      try {
        return !!r.host.querySelector('[data-subcard="Dragon exemplar"] .lvl-pending');
      } finally {
        r.stop();
      }
    };
    expect(pendingMark(sorc(1, 'bloodline-draconic')), 'unanswered').toBe(true);
    expect(pendingMark(sorc(1, 'bloodline-draconic', { dragonExemplar: 'adamantine' })), 'answered').toBe(false);
    for (const title of ['Elemental influence', 'Genie type']) {
      const a = page(sorc(1, 'bloodline-angelic'), title);
      try {
        expect(a.control, title).toBeUndefined();
      } finally {
        a.stop();
      }
    }
  });
});

describe('a gift from a book that is switched off still shows its name', () => {
  // The Cinder dragon's 5th- and 8th-rank gifts are Rage of Elements spells. The builder lists from the
  // book-filtered database; the browser check of 2026-10-21 showed "5th flame-dancer · 8th rainbow-fumarole".
  const ROE = 'Pathfinder Rage of Elements';
  const books = sourceCatalog(db).allBooks;
  const filtered: ContentDatabase = { ...db, spells: Object.fromEntries(Object.entries(db.spells).filter(([, s]) => s.source?.book !== ROE)) };

  // mutation-proof
  it('the dragon question names them from the full database', () => {
    expect(books, 'fixture').toContain(ROE);
    expect(filtered.spells['flame-dancer'], 'fixture: the book is off').toBeUndefined();
    const actions = { patch: noop } as unknown as BuilderActions;
    const r = renderDom(
      <ContentContext.Provider value={db}>
        <OriginPickers build={sorc(1, 'bloodline-draconic')} actions={actions} content={filtered} />
      </ContentContext.Provider>,
    );
    try {
      r.click([...r.host.querySelectorAll('[data-ctl="popup"]')].find((el) => el.getAttribute('data-ctl-title') === 'Dragon exemplar') ?? null);
      const cinder = [...r.host.querySelectorAll('.picker-item')].find((x) => (x.textContent ?? '').includes('Cinder'));
      expect(cinder?.textContent).toContain('2nd rank: Floating Flame · 5th rank: Flame Dancer · 8th rank: Rainbow Fumarole');
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('the builder\'s spells box names the locked gift chip from the full database', () => {
    const b = sorc(9, 'bloodline-draconic', { dragonExemplar: 'cinder', enabledSources: books.filter((x) => x !== ROE) });
    const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
    try {
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '9') ?? null);
      const row = [...r.host.querySelectorAll<HTMLElement>('.spell-pick-row')].find((y) => (y.querySelector('.spr-head span')?.textContent ?? '').trim() === '5th rank');
      expect(row, 'no 5th-rank row on the level-9 page').toBeTruthy();
      expect([...row!.querySelectorAll('.spr-chip-gift')].map((c) => (c.textContent ?? '').trim())).toEqual(['Flame Dancer']);
    } finally {
      r.stop();
    }
  });
});

describe('the sheet', () => {
  const notesOf = (host: HTMLElement, name: string) =>
    [...host.querySelectorAll<HTMLElement>('.spell-card')]
      .filter((c) => c.querySelector('.spell-name')?.textContent === name)
      .map((c) => c.querySelector('.spell-offbook-note')?.textContent ?? null);
  const sheet = (b: BuildState) => {
    const ch = buildCharacter(b, db);
    return renderDom(<SpellsTab character={applyPlayState(ch, initialPlay(ch, db), db)} content={db} onPlay={noop} />);
  };

  // mutation-proof
  it('unanswered: each element\'s cantrip says only one is theirs and where to choose; answered: one cantrip, no note', () => {
    const r = sheet(sorc(1, 'bloodline-elemental'));
    try {
      for (const name of ['Gale Blast', 'Scatter Scree', 'Ignition', 'Electric Arc', 'Frostbite', 'Tangle Vine'])
        expect(notesOf(r.host, name), name).toEqual([variantGiftNote(6, 'Elemental influence')]);
      expect(variantGiftNote(6, 'Elemental influence')).toBe('Only one of these 6 is yours. Choose your elemental influence in the builder');
    } finally {
      r.stop();
    }
    const fire = sheet(sorc(1, 'bloodline-elemental', { subclassVariant: { 'bloodline-elemental': 'fire' } }));
    try {
      expect(notesOf(fire.host, 'Ignition')).toEqual([null]);
      expect(notesOf(fire.host, 'Gale Blast')).toEqual([]);
      expect(fire.host.textContent ?? '').not.toMatch(/only one of these|can’t tell which/);
    } finally {
      fire.stop();
    }
  });

  // mutation-proof
  it('an unchosen dragon: the one gift drawn in its place says the dragon decides it; a chosen dragon says nothing', () => {
    // Before the fix the arcane fallback's gift sat on the sheet like any other spell, with no hint that
    // it would change.
    const r = sheet(sorc(3, 'bloodline-draconic'));
    try {
      expect(notesOf(r.host, 'Blazing Bolt')).toEqual([unansweredGiftNote('Dragon exemplar')]);
      expect(unansweredGiftNote('Dragon exemplar')).toBe('This gift follows your dragon exemplar, which isn’t chosen yet. Choose it in the builder');
      expect(notesOf(r.host, 'Fear'), 'a shared gift is the same for every dragon').toEqual([null]);
    } finally {
      r.stop();
    }
    const chosen = sheet(sorc(3, 'bloodline-draconic', { dragonExemplar: 'arcane' }));
    try {
      expect(notesOf(chosen.host, 'Blazing Bolt')).toEqual([null]);
    } finally {
      chosen.stop();
    }
  });
});

describe('the Level 1 page asks the bloodline\'s question under its own bloodline card', () => {
  // mutation-proof
  it('an elemental sorcerer picked on Level 1 is asked the element there; another bloodline is not', () => {
    const open = (b: BuildState) => {
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
      return r;
    };
    const titles = (host: HTMLElement) => [...host.querySelectorAll('[data-ctl="popup"]')].map((el) => el.getAttribute('data-ctl-title'));
    const el = open(sorc(1, 'bloodline-elemental'));
    try {
      expect(titles(el.host)).toContain('Elemental influence');
      expect(el.host.querySelector('[data-subcard="Elemental influence"] .lvl-pending'), 'unanswered').toBeTruthy();
    } finally {
      el.stop();
    }
    const an = open(sorc(1, 'bloodline-angelic'));
    try {
      expect(titles(an.host)).not.toContain('Elemental influence');
    } finally {
      an.stop();
    }
  });

  // mutation-proof
  it('the open question counts on that page too: its header says one more choice left than once answered', () => {
    // A final check (2026-10-21): the card showed its "!" under a header saying "all set", because the
    // question counted on Level 0 only (`MissingChoice.alsoPage`).
    const left = (b: BuildState) => {
      const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
      try {
        r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
        const tag = (r.host.querySelector('.lvl-page-head .lvl-pending-tag')?.textContent ?? '').trim();
        return Number(/(\d+) choices? left/.exec(tag)?.[1] ?? 0);
      } finally {
        r.stop();
      }
    };
    expect(left(sorc(1, 'bloodline-elemental'))).toBe(left(sorc(1, 'bloodline-elemental', { subclassVariant: { 'bloodline-elemental': 'fire' } })) + 1);
    expect(left(sorc(1, 'bloodline-draconic'))).toBe(left(sorc(1, 'bloodline-draconic', { dragonExemplar: 'divine' })) + 1);
    // Listed once in the Create/Save list all the same.
    expect(levelChoices(sorc(1, 'bloodline-elemental'), db).filter((m) => m.label === 'Elemental influence')).toEqual([
      { page: 0, label: 'Elemental influence', required: true, alsoPage: 1 },
    ]);
  });
});

describe('the builder\'s spells box at a rank above cantrips (the owner\'s screenshot)', () => {
  const rowAt = (b: BuildState, level: number, head: string) => {
    const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
    try {
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
      const row = [...r.host.querySelectorAll<HTMLElement>('.spell-pick-row')].find((y) => (y.querySelector('.spr-head span')?.textContent ?? '').trim() === head);
      return {
        found: !!row,
        chips: [...(row?.querySelectorAll('.spr-chip-gift') ?? [])].map((c) => ({ name: (c.textContent ?? '').trim(), title: c.getAttribute('title') })),
        notes: [...(row?.querySelectorAll('.spr-gift-note') ?? [])].map((c) => (c.textContent ?? '').trim()),
      };
    } finally {
      r.stop();
    }
  };

  // mutation-proof
  it('an unchosen dragon\'s 2nd rank: ONE locked gift, saying the dragon decides it; a chosen dragon\'s: its own, no note', () => {
    const open = rowAt(sorc(3, 'bloodline-draconic'), 3, '2nd rank');
    expect(open.found, 'no 2nd-rank row on the level-3 page').toBe(true);
    expect(open.chips).toEqual([{ name: 'Blazing Bolt', title: unansweredGiftNote('Dragon exemplar') }]);
    expect(open.notes).toEqual([`${unansweredGiftNote('Dragon exemplar')}.`]);
    const divine = rowAt(sorc(3, 'bloodline-draconic', { dragonExemplar: 'divine' }), 3, '2nd rank');
    expect(divine.chips.map((c) => c.name)).toEqual(['Augury']);
    expect(divine.notes).toEqual([]);
  });

  // mutation-proof
  it('an unanswered genie\'s 2nd rank: every genie type\'s gift, each saying only one is theirs, on the builder and the sheet', () => {
    const o = option('bloodline-genie');
    const ids = [...new Set(o.giftVariants!.options.map((v) => v.gifts.find((g) => g.rank === 2)!.id))];
    const names = ids.map((id) => db.spells[id]!.name);
    const note = variantGiftNote(ids.length, 'Genie type');
    const b = sorc(5, 'bloodline-genie');
    const row = rowAt(b, 3, '2nd rank');
    expect(row.chips.map((c) => c.name).sort()).toEqual([...names].sort());
    expect(row.chips.every((c) => c.title?.startsWith(note)), row.chips.map((c) => c.title).join(' | ')).toBe(true);
    expect(row.notes).toEqual([`${note}. Together they take one of these places.`]);
    const ch = buildCharacter(b, db);
    const r = renderDom(<SpellsTab character={applyPlayState(ch, initialPlay(ch, db), db)} content={db} onPlay={noop} />);
    try {
      for (const name of names)
        expect(
          [...r.host.querySelectorAll<HTMLElement>('.spell-card')].filter((c) => c.querySelector('.spell-name')?.textContent === name).map((c) => c.querySelector('.spell-offbook-note')?.textContent ?? null),
          name,
        ).toEqual([note]);
    } finally {
      r.stop();
    }
  });
});
