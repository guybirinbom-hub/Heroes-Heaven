// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, emptyBuild, withCustomAnswer, type BuildState } from '../src/rules/build';
import type { ContentDatabase, FeatChoiceDef } from '../src/rules/types';

/**
 * TERRAIN TAKES A TYPED ANSWER — the owner's instruction, verbatim:
 *
 * > "terrain need to be the existing options, add this missing one but also add the ability to write
 * > free text in terrain."
 *
 * Witchlight Follower is the proof the printed nine are not the whole vocabulary: it grants
 * *"Terrain Expertise with both swamp terrain and subterranean bodies of water"*, and the second
 * terrain was a name the app had no way to say. Gold-set principle **I** — *"free-text player input
 * is a legitimate choice type"* — is what makes typing one a real answer rather than a note.
 *
 * The scope is the point of half these assertions. `kind: 'array'` is not the trigger; being a
 * TERRAIN choice whose printed list is illustrative is. A binary ("natural or urban"), a list that
 * drives other feats (Mummy Dedication), and a list a record deliberately NARROWED (Isgeri
 * Reclaimer's two of three) each stay closed, and the negative tests below are what keeps them that way.
 */
const c = () => content();
const noop = () => undefined;

/** Every record in the database that opts into a typed answer, as `bucket/id`. */
function customAnswerRecords(db: ContentDatabase): string[] {
  const out: string[] = [];
  for (const [bucket, records] of Object.entries(db as unknown as Record<string, Record<string, unknown>>)) {
    if (!records || typeof records !== 'object') continue;
    for (const [id, rec] of Object.entries(records)) {
      const def = (rec as { choice?: FeatChoiceDef } | null)?.choice;
      if (def && typeof def === 'object' && def.allowCustom) out.push(`${bucket}/${id}`);
    }
  }
  return out.sort();
}

describe('the terrain the app could not name', () => {
  it('Terrain Expertise offers subterranean bodies of water, and still offers the printed nine', () => {
    const opts = c().feats['terrain-expertise']!.choice!.options!;
    // The nine from Player Core, untouched — a character who picked any of them is unaffected.
    for (const v of ['aquatic', 'arctic', 'desert', 'forest', 'mountain', 'plain', 'sky', 'swamp', 'underground']) {
      expect(opts.some((o) => o.value === v), `${v} must survive`).toBe(true);
    }
    const added = opts.find((o) => o.value === 'subterranean-water');
    expect(added).toBeTruthy();
    // The label is the background's own phrase, so a Witchlight Follower recognises it on sight.
    expect(added!.label).toBe('Subterranean bodies of water');
  });

  it('Witchlight Follower’s printed second terrain is now a value the vocabulary contains', () => {
    // "You gain the Terrain Expertise skill feat with both swamp terrain and subterranean bodies of
    // water." Before this the second half of that sentence could not be expressed at all.
    const desc = c().backgrounds['witchlight-follower']!.description!;
    expect(desc).toContain('subterranean bodies of water');
    expect(c().feats['terrain-expertise']!.choice!.options!.map((o) => o.value)).toContain('subterranean-water');
  });

  it('an already-stored answer keeps working', () => {
    // The whole backwards-compatibility requirement in one line: `swamp` still resolves to Swamp.
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'ranger',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      keyAbility: 'dex',
      featPicks: { '1:skill:0': 'terrain-expertise' },
      featChoices: { '1:skill:0': 'swamp' },
    };
    const ch = buildCharacter(b, c());
    expect(ch.feats.find((f) => f.featId === 'terrain-expertise')?.choice).toEqual({ value: 'swamp', label: 'Swamp' });
  });

  it('a typed answer reaches the sheet as the words the player typed', () => {
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'ranger',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      keyAbility: 'dex',
      featPicks: { '1:skill:0': 'terrain-expertise' },
      featChoices: { '1:skill:0': 'Sunless tidepools' },
    };
    const ch = buildCharacter(b, c());
    // Not a slug, not blank, not "Choose an option" — the answer itself.
    expect(ch.feats.find((f) => f.featId === 'terrain-expertise')?.choice).toEqual({
      value: 'Sunless tidepools',
      label: 'Sunless tidepools',
    });
  });
});

describe('withCustomAnswer — a typed answer has to look answered', () => {
  const def = { flag: 'terrain', prompt: 'Terrain', kind: 'array', options: [], allowCustom: { label: 'x', placeholder: 'y' } } as FeatChoiceDef;
  const base = [{ value: 'swamp', label: 'Swamp' }];

  it('adds a row for an answer that is not on the list', () => {
    expect(withCustomAnswer(base, def, 'Sunless tidepools')).toEqual([
      { value: 'swamp', label: 'Swamp' },
      { value: 'Sunless tidepools', label: 'Sunless tidepools' },
    ]);
  });

  it('adds nothing for an answer that IS on the list, or for no answer', () => {
    expect(withCustomAnswer(base, def, 'swamp')).toEqual(base);
    expect(withCustomAnswer(base, def, '')).toEqual(base);
    expect(withCustomAnswer(base, def, undefined)).toEqual(base);
  });

  it('adds nothing at all where the choice did not opt in', () => {
    // Without this guard a stale answer on ANY choice would resurrect itself as a fake option.
    const closed = { ...def, allowCustom: undefined } as FeatChoiceDef;
    expect(withCustomAnswer(base, closed, 'Sunless tidepools')).toEqual(base);
  });
});

describe('the scope: a list the book declines to close, not choices in general', () => {
  /*
   * ⚠ This assertion used to read "exactly the illustrative TERRAIN lists opt in", and terrain was
   * every member. The property that earns `allowCustom` was never terrain, though — it is a printed
   * list the book itself refuses to close, and terrain was simply the only family anyone had authored.
   * Celestial Form and Fiendish Form are the second: *"the trait appropriate to the type of servitor
   * you've become (archon, angel, or azata, FOR EXAMPLE)"* and *"…(SUCH AS daemon, demon, or devil)"*.
   * Those parentheses are examples of a set the rules leave open, so a closed three-option picker
   * would be authoring an answer we know can be wrong — which is exactly what the flat
   * `grantsCreatureTraits: ["celestial"]` those records shipped with had done, by dropping the clause
   * altogether. The negative cases below are unchanged and are what keeps this from becoming "any
   * `kind: 'array'` choice".
   */
  it('exactly the lists whose printed options are illustrative opt in', () => {
    expect(customAnswerRecords(c())).toEqual([
      // spotter/trailblazer's background-level copies were DELETED in batch 22, and hired-killer's
      // followed in batch 23 — all three were duplicates of the granted feat's own picker, which is
      // the surviving free-text lane below.
      // "the trait appropriate to the type of servitor you've become (…, for example / such as …)"
      'feats/celestial-form',
      'feats/fiendish-form',
      'feats/terrain-expertise',
      'feats/terrain-scout',
      'feats/terrain-stalker',
      'feats/underbrush-trailblazer',
      'feats/wilderness-spotter',
    ]);
  });

  it('a servitor list the book DOES close stays closed', () => {
    // Celestial Rebirth prints "the agathion, angel, archon, or azata trait" — four named options and
    // no "such as", so it is a closed set and takes no typed answer, unlike its two neighbours above.
    expect(c().feats['celestial-rebirth']!.choice!.allowCustom).toBeUndefined();
    expect(c().feats['celestial-rebirth']!.choice!.options).toHaveLength(4);
  });

  it('a terrain-SHAPED choice whose list is closed does NOT opt in', () => {
    // Each of these prints a list that is exhaustive, narrowed on purpose, or load-bearing:
    //  · Shooter's Camouflage / Vindicator — "either natural or urban", a binary with no third case.
    //  · Mummy Dedication — "arctic, desert, mountain, or swamp… may alter the effects of some of
    //    your feats", so an answer off the list would drive nothing.
    //  · Mottle-Coat Centaur / Camouflage Tripkee — six and three of the nine; the record narrowed
    //    the list, and reopening it by the back door would undo that.
    expect(c().feats['shooters-camouflage']!.choice!.allowCustom).toBeUndefined();
    expect(c().feats['mummy-dedication']!.choice!.allowCustom).toBeUndefined();
    expect(c().classFeatures['vindicator']!.choice!.allowCustom).toBeUndefined();
    expect(c().heritages['mottle-coat-centaur']!.choice!.allowCustom).toBeUndefined();
  });

  /*
   * Isgeri Reclaimer used to be in that list, as a background whose OWN choice held the two terrains.
   * Ruling Q9 moved it: the narrowing now lives on `choiceOptionLimits` against Terrain Stalker, and
   * the duplicate question was deleted. Terrain Stalker itself keeps `allowCustom` — correctly, since
   * a player who takes the feat normally may name a tenth terrain — so the "closed list" property has
   * to be asserted where it now lives, or the guarantee quietly moves out from under this file.
   */
  it('Isgeri Reclaimer’s narrowing closes Terrain Stalker’s list instead', () => {
    const bg = c().backgrounds['isgeri-reclaimer']!;
    expect(bg.choice, 'the duplicate question is gone').toBeUndefined();
    const limit = bg.choiceOptionLimits![0];
    expect(limit.target).toBe('terrain-stalker');
    expect(limit.allow.map((a) => a.value)).toEqual(['rubble', 'underbrush']);
    // The feat stays open for everyone else — a narrowing belongs to the record that imposes it.
    expect(c().feats['terrain-stalker']!.choice!.allowCustom).toBeDefined();
  });
});

/** Open level `lvl`, then the picker inside the SubCard whose label contains `label`. */
function openFeatSubPicker(r: ReturnType<typeof renderDom>, lvl: string, label: string) {
  const tab = [...r.host.querySelectorAll<HTMLButtonElement>('button')].find((x) => (x.textContent ?? '').trim() === lvl);
  r.click(tab ?? null);
  const card = [...r.host.querySelectorAll<HTMLElement>('.lvl-subcard')].find((el) => (el.textContent ?? '').includes(label));
  r.click(card?.querySelector('button.popsel, button.lvl-card') ?? null);
}
const rowNames = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('.picker-item .picker-name, .pick-row .picker-name')].map((el) => (el.textContent ?? '').trim());
/** Type into a controlled React input the way a keyboard does (the native setter, then `input`). */
function typeInto(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the builder actually offers it — the pixel, not the predicate', () => {
  // Level 2 is where a skill-feat slot first exists; `featSlots` is indexed by POSITION, so the
  // ranger's second slot at level 2 is the skill one.
  const b = (featId: string): BuildState => ({
    ...emptyBuild(),
    name: 't',
    level: 2,
    classId: 'ranger',
    ancestryId: 'human',
    backgroundId: 'acolyte',
    keyAbility: 'dex',
    featPicks: { '2:skill:1': featId },
  });

  it('the terrain picker carries a "type your own" row beside the listed terrains', () => {
    const r = renderDom(<Builder content={c()} initial={b('terrain-expertise')} onCancel={noop} onCreate={noop} />);
    openFeatSubPicker(r, '2', 'Terrain');
    const names = rowNames(r.host);
    expect(names).toContain('Swamp');
    expect(names).toContain('Subterranean bodies of water');
    expect(names.some((n) => n.startsWith('Type another terrain'))).toBe(true);
    r.stop();
  });

  it('typing one answers the card — it does not read as an unmade pick', () => {
    // The half that is easy to get wrong: the answer is stored and the filled control renders by
    // looking the value up in its own options, so without `withCustomAnswer` the card would still
    // show the placeholder and a pending `!` over an answer the player just gave.
    const r = renderDom(<Builder content={c()} initial={b('terrain-expertise')} onCancel={noop} onCreate={noop} />);
    openFeatSubPicker(r, '2', 'Terrain');
    r.click([...r.host.querySelectorAll<HTMLElement>('.picker-item')].find((el) =>
      (el.textContent ?? '').trim().startsWith('Type another terrain'),
    ) ?? null);
    typeInto(r.host.querySelector<HTMLInputElement>('.popsel-custom input')!, 'Sunless tidepools');
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('.popsel-custom-actions button')].find((x) =>
      (x.textContent ?? '').trim() === 'Add',
    ) ?? null);
    const card = [...r.host.querySelectorAll<HTMLElement>('.lvl-subcard')].find((el) => (el.textContent ?? '').includes('Terrain'))!;
    expect(card.querySelector('.popsel-val')?.textContent).toBe('Sunless tidepools');
    expect(card.querySelector('.lvl-pending')).toBeNull();
    r.stop();
  });

  it('the granted-feat picker (now the ONLY terrain lane for Trailblazer) offers it too', () => {
    /* Batch 22 deleted Trailblazer's background-level terrain choice — a duplicate of the granted
     * Terrain Expertise's own picker, the one whose answer the sheet actually reads. The free-text
     * opt-in must survive on the surviving lane, and no Terrain card may appear on setup at all. */
    const tb: BuildState = { ...emptyBuild(), name: 't', level: 1, classId: 'ranger', ancestryId: 'human', backgroundId: 'trailblazer', keyAbility: 'dex' };
    const r = renderDom(<Builder content={c()} initial={tb} onCancel={noop} onCreate={noop} />);

    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
    const bgCard = [...r.host.querySelectorAll<HTMLElement>('.lvl-subcard')].find((el) => (el.textContent ?? '').startsWith('Terrain'));
    expect(bgCard, 'the duplicate setup-page terrain card is gone').toBeUndefined();

    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
    const grantCard = [...r.host.querySelectorAll<HTMLElement>('.lvl-subcard')].find((el) =>
      (el.textContent ?? '').includes('Terrain Expertise:'),
    )!;
    r.click(grantCard.querySelector('button.popsel, button.lvl-card'));
    const names = rowNames(r.host);
    expect(names).toContain('Subterranean bodies of water');
    expect(names.some((n) => n.startsWith('Type another terrain'))).toBe(true);
    r.stop();
  });

  it('a non-terrain array choice’s picker carries no such row', () => {
    // Specialty Crafting is the same `kind: 'array'` shape one card over. If free text leaked from
    // the shape rather than from the opt-in, this is where it would show.
    const r = renderDom(<Builder content={c()} initial={b('specialty-crafting')} onCancel={noop} onCreate={noop} />);
    openFeatSubPicker(r, '2', 'Specialty crafting');
    const names = rowNames(r.host);
    expect(names).toContain('Blacksmithing');
    expect(names.some((n) => n.startsWith('Type another'))).toBe(false);
    r.stop();
  });
});
