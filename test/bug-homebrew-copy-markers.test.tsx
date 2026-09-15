// @vitest-environment jsdom
// bug 2026-09-15: homebrew copies inherit markers
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { normalizeCharacter } from '../src/rules/normalize';
import { characterSituationalIds, explainStat, recordMarkersFor, situationalTitle } from '../src/rules/explain';
import { officialIdOf } from '../src/rules/officialId';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { ItemEditorModal } from '../src/sheet/ItemEditorModal';
import { VitalsRail } from '../src/sheet/VitalsRail';
import type { Character, ContentDatabase, InventoryItem, Item, SaveId } from '../src/rules/types';

/**
 * "spell guard shield adds a bonus to saving throws in certain circumstances and WG shows that with
 * a `*` — why don't we?" — owner, 2026-09-15.
 *
 * WE DO, for the shipped record: `FEAT_SITUATIONAL['spellguard-shield']` carries all three saves
 * ("+2 circumstance … against spells that target you, while the shield is Raised"). His shield is a
 * HOMEBREW COPY, made with the editor's "Start from an existing item…", and a copy is saved under a
 * fresh `custom-…` id. Every hand-authored table in the rules layer is keyed by the OFFICIAL id, so
 * the copy contributed a key nothing holds: no star, on any of the three rows.
 *
 * The fix is one resolution step — `officialIdOf` — at the place an inventory row becomes a lookup
 * key, so it covers the whole class rather than the one shield: the situational registry, the record
 * markers, the supersede table, the trust ledger, the companion list and the steadying-hand mark.
 * Two answers, in order: the copy's own `basedOn` (written from now on), then its NAME — which is
 * what rescues HIS shield, saved months before the field existed.
 */
const c0 = content();
const noop = (() => undefined) as never;
const SAVES: SaveId[] = ['fortitude', 'reflex', 'will'];

/** The shipped record every copy below is a copy OF. */
const OFFICIAL = 'spellguard-shield';

const homebrew = (over: Partial<Item> & { id: string; name: string }): Item =>
  ({
    itemType: 'shield', level: 6, rarity: 'common', traits: ['magical'],
    acBonus: 2, hardness: 5, hp: 20, brokenThreshold: 10, bulk: 1,
    description: 'While you have this steel shield raised, you gain its circumstance bonus to saving throws against spells that target you.',
    source: { license: 'homebrew' },
    ...over,
  }) as unknown as Item;

/** His shield, as the editor saves one TODAY: the base is recorded. Renamed on purpose, so only
 *  `basedOn` can be doing the work here. */
const BY_BASE = homebrew({ id: 'custom-warded-aegis-xwtzd', name: 'Warded Aegis', basedOn: OFFICIAL });
/** His shield as it is ON DISK: copied before `basedOn` existed, carrying only the printed name. */
const BY_NAME = homebrew({ id: 'custom-spellguard-shield-xwtzd', name: 'Spellguard Shield' });
/** A shield the player actually invented. Nothing may reach it. */
const INVENTED = homebrew({ id: 'custom-grandmas-door-xwtzd', name: "Grandma's Old Door" });
/** A copy of a RECORD_MARKERS item (the marks land on the Climb and Swim action rows). */
const ARMBANDS = homebrew({
  id: 'custom-strong-bands-xwtzd', name: 'Strong Bands', itemType: 'equipment', usage: 'wornarmbands',
  basedOn: 'armbands-of-athleticism-greater',
});
/** A copy of the Hunter's Brooch, whose id is the only thing that offers the steadying-hand mark. */
const BROOCH = homebrew({ id: 'custom-hunt-pin-xwtzd', name: 'Hunt Pin', itemType: 'equipment', basedOn: 'hunters-brooch' });

const db = ((): ContentDatabase => {
  const extra = [BY_BASE, BY_NAME, INVENTED, ARMBANDS, BROOCH];
  return { ...c0, items: { ...c0.items, ...Object.fromEntries(extra.map((i) => [i.id, i])) } } as ContentDatabase;
})();

/** A plain fighter holding `inventory` — no feat, ancestry or heritage that stars a save, so every
 *  line the saves rows show below came from the shield under test. */
const hero = (inventory: InventoryItem[] = []): Character =>
  normalizeCharacter({
    id: 'g', name: 'G', level: 6, classId: 'fighter', keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [], currency: {}, inventory,
  } as unknown as Character);

const holding = (itemId: string, flags: Partial<InventoryItem> = { equipped: true }): Character =>
  hero([{ instanceId: 'i1', itemId, quantity: 1, ...flags } as InventoryItem]);

/**
 * The situational CLAUSES the three saves rows would show, with the source's name stripped off the
 * front — so a copy and the record it copies compare equal even though they are differently named.
 */
const saveClauses = (ch: Character, database: ContentDatabase = db): string[][] =>
  SAVES.map((save) =>
    (explainStat(ch, database, { kind: 'save', save }).situational ?? []).map((n) => n.text.slice(n.text.indexOf(' — ') + 3)),
  );

/** What the three saves rows say for a fighter carrying NOTHING — the floor every leg measures from
 *  (Bravery already stars Will "against a fear effect", and that is not a defect). */
const BARE = saveClauses(hero());

/** Type into a controlled React input the way a keyboard does (native setter, then `input`). */
function typeInto(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('a homebrew copy of an official item keeps the official record’s markers', () => {
  // bug 2026-09-15: homebrew copies inherit markers
  it('a copy that records basedOn stars the same three saves as the shipped Spellguard Shield', () => {
    const official = saveClauses(holding(OFFICIAL));
    /* The anchor: the shipped record really does add one clause to each of the three rows, so an
     * equality below cannot pass by both sides being empty. Measured AGAINST the bare fighter, who
     * already carries one Will line of his own — Bravery's "against a fear effect". */
    expect(official.map((l, i) => l.length - BARE[i].length), 'one new clause on each of the three').toEqual([1, 1, 1]);
    expect(official.flat().filter((t) => t.includes('while the shield is Raised')).length).toBe(3);
    expect(saveClauses(holding(BY_BASE.id))).toEqual(official);
    expect(characterSituationalIds(holding(BY_BASE.id), db)).toContain(OFFICIAL);
    expect(officialIdOf(BY_BASE.id, db.items)).toBe(OFFICIAL);
  });

  // bug 2026-09-15: homebrew copies inherit markers
  it('HIS shield — a copy saved before basedOn existed — is rescued by its name', () => {
    expect(BY_NAME.basedOn, 'the case this leg exists for: no pointer, only the printed name').toBeUndefined();
    expect(officialIdOf(BY_NAME.id, db.items)).toBe(OFFICIAL);
    expect(saveClauses(holding(BY_NAME.id))).toEqual(saveClauses(holding(OFFICIAL)));
  });

  // bug 2026-09-15: homebrew copies inherit markers
  it('an item the player invented resolves to itself and stars nothing', () => {
    expect(officialIdOf(INVENTED.id, db.items)).toBe(INVENTED.id);
    // Not "no lines" — "no lines this shield put there": the bare fighter's own Bravery line stays.
    expect(saveClauses(holding(INVENTED.id))).toEqual(BARE);
    expect(BARE.flat().some((t) => t.includes('shield'))).toBe(false);
  });

  // bug 2026-09-15: homebrew copies inherit markers
  it('the sheet’s saves rows draw the star, and its hover carries the clause', () => {
    const r = renderDom(createElement(VitalsRail, { character: holding(BY_NAME.id), content: db }));
    const row = [...r.host.querySelectorAll<HTMLElement>('.stat-row')].find((e) =>
      (e.querySelector('.stat-name')?.textContent ?? '').startsWith('Fortitude'),
    );
    expect(row, 'no Fortitude row on the rendered rail').toBeTruthy();
    const star = row!.querySelector<HTMLElement>('.stat-name .sit-star');
    expect(star, 'the `*` the owner is asking for').toBeTruthy();
    // A star that says only "open for details" is the half-answer WG does not give him.
    expect(star!.getAttribute('title')).toContain('while the shield is Raised');
    expect(star!.getAttribute('title')).toContain('+2 circumstance');
    r.stop();
    // The same string the row hands the star, for the other two rows.
    for (const save of SAVES) expect(situationalTitle(holding(BY_NAME.id), { kind: 'save', save }, db)).toContain('while the shield is Raised');
  });

  // bug 2026-09-15: homebrew copies inherit markers
  it('the editor’s "Start from an existing item…" writes basedOn onto the saved record', () => {
    let saved: Item | undefined;
    const r = renderDom(
      createElement(ItemEditorModal, {
        mode: 'create', content: db, onSave: (it: Item) => { saved = it; }, onClose: () => undefined,
      } as never),
    );
    r.click(r.host.querySelector('[data-ctl-title="Base item"]'));
    typeInto(r.host.querySelector<HTMLInputElement>('.picker-overlay input.name-input')!, 'Spellguard Shield');
    const row = [...r.host.querySelectorAll<HTMLButtonElement>('.picker-item')].find(
      (b) => (b.querySelector('.picker-name')?.textContent ?? '').trim() === 'Spellguard Shield',
    );
    expect(row, 'the base-item picker offers no Spellguard Shield').toBeTruthy();
    r.click(row!);
    r.click(r.host.querySelector('.ci-save'));
    r.stop();
    expect(saved!.id.startsWith('custom-'), 'a copy is a new record').toBe(true);
    expect(saved!.basedOn).toBe(OFFICIAL);
    /* …and the pointer carries it ALONE. Renamed first, because the copy comes out of the editor
     * named "Spellguard Shield" and the name fallback would otherwise be what passes this leg. */
    const renamed = { ...saved!, name: 'Something Else Entirely' } as Item;
    const withSaved = { ...db, items: { ...db.items, [renamed.id]: renamed } } as ContentDatabase;
    expect(officialIdOf(renamed.id, withSaved.items)).toBe(OFFICIAL);
    expect(saveClauses(holding(renamed.id), withSaved)).toEqual(saveClauses(holding(OFFICIAL)));
  });

  // bug 2026-09-15: homebrew copies inherit markers
  it('the OTHER tables route the same way — record markers on an action row', () => {
    const official = recordMarkersFor(holding('armbands-of-athleticism-greater', { worn: true }), db, 'action', 'climb');
    expect(official.length, 'the shipped armbands mark the Climb row').toBe(1);
    expect(recordMarkersFor(holding(ARMBANDS.id, { worn: true }), db, 'action', 'climb')).toEqual(official);
    expect(recordMarkersFor(holding(INVENTED.id, { worn: true }), db, 'action', 'climb')).toEqual([]);
  });

  // bug 2026-09-15: homebrew copies inherit markers
  it('the OTHER tables route the same way — a copied Hunter’s Brooch offers the steadying-hand mark', () => {
    const mark = (inventory: InventoryItem[]) => {
      const r = renderDom(createElement(InventoryTab, { character: hero(inventory), content: db, onPlay: noop } as never));
      const card = [...r.host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Longsword'));
      expect(card, 'no inventory card for the Longsword').toBeTruthy();
      r.click(card!);
      const found = [...r.host.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => (b.textContent ?? '').trim() === 'Steadying hand weapon',
      );
      r.stop();
      return found;
    };
    const sword: InventoryItem = { instanceId: 'w1', itemId: 'longsword', quantity: 1, equipped: true };
    expect(mark([sword]), 'nobody without the brooch is offered the mark').toBe(false);
    expect(mark([sword, { instanceId: 'b1', itemId: 'hunters-brooch', quantity: 1, invested: true }]), 'the shipped brooch offers it').toBe(true);
    expect(mark([sword, { instanceId: 'b1', itemId: BROOCH.id, quantity: 1, invested: true }]), 'and so does a copy of it').toBe(true);
    expect(mark([sword, { instanceId: 'b1', itemId: INVENTED.id, quantity: 1, invested: true }]), 'but not an unrelated homebrew').toBe(false);
  });
});
