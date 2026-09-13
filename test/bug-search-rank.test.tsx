// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { NotesTab } from '../src/sheet/NotesTab';
import { MainTab } from '../src/sheet/MainTab';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { ConditionsModal } from '../src/sheet/ConditionsModal';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { FilterableSelect, PickerRow } from '../src/sheet/FilterableSelect';
import { ContentContext } from '../src/sheet/ContentContext';
import { KingmakerRules } from '../src/sheet/KingmakerRules';
import { MythicRules } from '../src/sheet/MythicRules';
import { RefSearchModal } from '../src/sheet/RichEditor';
import { SPELL_SPEC_BUILDER } from '../src/sheet/filterSpecs';
import { NO_MATCH, rankBySearch, searchMatches, searchTier, splitNameText } from '../src/data/searchRank';
import type { Character, Coins, Spell } from '../src/rules/types';

/**
 * bug 2026-09-13: search-rank
 *
 * Owner, with a screenshot of Add items searching "waterskin": *"when i search for a waterskin it is
 * all the way down instead of the first option, i guess its because there is a water skin in the kits
 * but it doesnt change the fact that i searched for water skin that means that water skin needs to be
 * the first thing that appears"*.
 *
 * MEASURED CAUSE: every search box in the app FILTERS and none of them ORDER. The Add-items box
 * matches `${name}\n${description}` (filterSpecs.ts ITEM_SPEC) and the results keep the list's own
 * level-then-name order, so the 15 class kits and the Adventurer's Pack — whose contents list a
 * waterskin — came back ahead of the Waterskin itself purely by spelling.
 *
 * The fix is one rule in one place (src/data/searchRank.ts) wired into every box. These tests pin
 * both halves: the rule's own ordering table, and four real boxes driven through their real inputs.
 */

/** Type into a React-controlled input the way a player does (native setter + input event). */
function type(input: HTMLInputElement | null, text: string) {
  if (!input) throw new Error('search input not found');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The visible row labels of a picker, top to bottom. */
const rowNames = (host: HTMLElement, sel: string) =>
  [...host.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());

const searchBox = (host: HTMLElement) => host.querySelector<HTMLInputElement>('.fsel-results-search input');

/** The spell names in the Spells page card whose heading starts with `heading` ("Spellbook", "Rituals"). */
const sectionCards = (host: HTMLElement, heading: string) =>
  [...host.querySelectorAll('section.card')]
    .filter((s) => (s.querySelector('.ct')?.textContent ?? '').trim().startsWith(heading))
    .flatMap((s) => [...s.querySelectorAll('.spell-card .spell-name')].map((n) => (n.textContent ?? '').trim()));

/** The spell names in one prepared-slot rank group ("4th rank"), in slot order. */
const rankGroupCards = (host: HTMLElement, label: string) => {
  const hdr = [...host.querySelectorAll('.spell-rankhdr')].find((h) => (h.textContent ?? '').trim().startsWith(label));
  return [...(hdr?.parentElement?.querySelectorAll('.spell-card .spell-name') ?? [])].map((n) => (n.textContent ?? '').trim());
};

describe('bug 2026-09-13: search-rank — the rule', () => {
  // bug 2026-09-13: search-rank
  it('orders by match quality: exact name, prefix, whole word, anywhere in the name, other fields', () => {
    const q = 'sword';
    expect(searchTier(q, 'Sword')).toBe(0); // the name IS the query
    expect(searchTier(q, 'Sword Cane')).toBe(1); // the name starts with it
    expect(searchTier(q, 'Bastard Sword')).toBe(2); // it is a whole word in the name
    expect(searchTier(q, 'Longsword')).toBe(3); // it is somewhere in the name
    expect(searchTier(q, 'Scabbard', 'holds a sword')).toBe(5); // only another field has it
    expect(searchTier(q, 'Scabbard')).toBe(NO_MATCH); // …and with no other field, no match at all
    // Strictly better is strictly lower, with no ties between the tiers.
    const tiers = [
      searchTier(q, 'Sword'),
      searchTier(q, 'Sword Cane'),
      searchTier(q, 'Bastard Sword'),
      searchTier(q, 'Longsword'),
      searchTier(q, 'Scabbard', 'holds a sword'),
      searchTier(q, 'Scabbard'),
    ];
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(new Set(tiers).size).toBe(tiers.length);
  });

  // bug 2026-09-13: search-rank
  it('is case-, diacritic-, apostrophe- and whitespace-insensitive', () => {
    expect(searchTier('ETIENNE', 'Étienne')).toBe(0);
    expect(searchTier('etienne', 'Étienne')).toBe(0);
    expect(searchTier('  fire   bolt ', 'Fire Bolt')).toBe(0); // runs of whitespace collapse
    expect(searchTier("adventurer's pack", 'Adventurer’s Pack')).toBe(0); // curly ↔ straight
    // Folding must not invent matches that aren't there.
    expect(searchTier('etienne', 'Etain')).toBe(NO_MATCH);
  });

  // bug 2026-09-13: search-rank
  it('needs every token of a multi-word query, and ranks by the best field they land in', () => {
    // All the tokens in the NAME beats the same tokens spread across name + description.
    expect(searchTier('healing potion', 'Potion of Healing')).toBe(4);
    expect(searchTier('healing potion', 'Potion of Vitality', 'restores hit points, healing you')).toBe(6);
    // A whole-query hit in another field is a tighter match than scattered tokens, and ranks above it.
    expect(searchTier('healing potion', 'Alchemist Kit', 'contains one healing potion')).toBe(5);
    // One token missing everywhere = not a match at all.
    expect(searchTier('healing potion', 'Potion of Flying', 'lets you fly')).toBe(NO_MATCH);
  });

  // bug 2026-09-13: search-rank
  it('keeps ties in the order they arrived, and returns the list untouched with no query', () => {
    const list = [
      { name: 'Bastard Sword' },
      { name: 'Sword' },
      { name: 'Aldori Dueling Sword' },
      { name: 'Longsword' },
      { name: 'Sword Cane' },
    ];
    // Two whole-word ties (Bastard Sword, Aldori Dueling Sword) keep their incoming relative order.
    expect(rankBySearch(list, 'sword', (o) => o.name).map((o) => o.name)).toEqual([
      'Sword',
      'Sword Cane',
      'Bastard Sword',
      'Aldori Dueling Sword',
      'Longsword',
    ]);
    // An empty box must not reorder — nor allocate a new array a memo would see as a change.
    expect(rankBySearch(list, '   ', (o) => o.name)).toBe(list);
  });

  // bug 2026-09-13: search-rank
  it('never drops a row — a record the caller kept but the rule cannot match sorts last', () => {
    const list = [{ name: 'Lantern' }, { name: 'Torch' }];
    const out = rankBySearch(list, 'torch', (o) => o.name);
    expect(out.map((o) => o.name)).toEqual(['Torch', 'Lantern']);
    expect(out).toHaveLength(list.length);
  });

  /*
   * adversarially confirmed 2026-09-13: the ranking half alone still failed the owner's literal
   * query. He wrote *"i searched for water skin"*, and `water skin` (with the space) matched NOTHING
   * in Add items — the substring filter drops "Waterskin" on the space, so there was no row left for
   * the ranking to lift. A one-word query is byte-for-byte the old `includes`; a multi-word one also
   * passes when every token is present, which is exactly what searchTier already scores as tier 4/6.
   */
  // bug 2026-09-13: search-rank
  it('the FILTER takes a multi-word query the same way the ranking scores one', () => {
    expect(searchMatches('waterskin', 'Waterskin\nA leather flask.')).toBe(true);
    expect(searchMatches('water skin', 'Waterskin\nA leather flask.')).toBe(true); // the owner's spelling
    expect(searchMatches('skin water', 'Waterskin\nA leather flask.')).toBe(true); // order is not a rule
    expect(searchMatches('water   skin', 'Waterskin')).toBe(true); // runs of whitespace collapse
    // One token absent = still no match: this widens the filter, it does not blunt it.
    expect(searchMatches('water flask', 'Waterskin')).toBe(false);
    // A single-word query is the old substring test exactly, so no box's existing results move.
    expect(searchMatches('skin', 'Waterskin')).toBe(true);
    expect(searchMatches('skins', 'Waterskin')).toBe(false);
    expect(searchMatches('', 'Waterskin')).toBe(true); // empty box keeps everything
  });

  // bug 2026-09-13: search-rank
  it('reads a picker accessor as name-on-the-first-line, everything else after', () => {
    expect(splitNameText('Waterskin\nA leather flask.')).toEqual({ name: 'Waterskin', other: 'A leather flask.' });
    // Builder's familiar-ability picker declares a name-only accessor — no newline, all name.
    expect(splitNameText('Scent')).toEqual({ name: 'Scent', other: '' });
    // Only the FIRST newline splits: a multi-paragraph description stays in `other` entire.
    expect(splitNameText('Kit\nline one\nline two')).toEqual({ name: 'Kit', other: 'line one\nline two' });
  });
});

describe('bug 2026-09-13: search-rank — Add items (the reported box)', () => {
  const purse: Coins = { gp: 5000 };
  const noop = () => undefined;
  const open = () => renderDom(<AddItemsModal content={content()} currency={purse} onBuy={noop} onGive={noop} onClose={noop} />);

  // bug 2026-09-13: search-rank
  it('puts Waterskin first when you search "waterskin", with the kits that merely list one after it', () => {
    const { host, stop } = open();
    type(searchBox(host), 'waterskin');
    const names = rowNames(host, '.ai-name');
    stop();

    // The owner's screenshot: 19 rows, Waterskin next to last. Same 19 rows now, Waterskin first.
    expect(names).toHaveLength(19);
    expect(names[0]).toBe('Waterskin');
    // Then the other row whose NAME carries the word, ahead of every description-only match — even
    // though it is level 9 and all the rest are level 0, i.e. the level sort no longer decides this.
    expect(names[1]).toBe('Anointed Waterskin');
    // Everything after is a description match: a kit or pack whose CONTENTS list a waterskin.
    const rest = names.slice(2);
    expect(rest.every((n) => !n.toLowerCase().includes('waterskin'))).toBe(true);
    expect(rest).toContain('Alchemist Kit');
    expect(rest).toContain('Swashbuckler Kit');
    // …and among themselves they keep the list's own order, which is alphabetical at level 0.
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  // bug 2026-09-13: search-rank
  it('"water skin" — the owner\'s own spelling — finds Waterskin, and finds it first', () => {
    const { host, stop } = open();
    type(searchBox(host), 'water skin');
    const names = rowNames(host, '.ai-name');
    stop();

    // adversarially confirmed: this returned ZERO rows. Ranking cannot lift a row the filter dropped,
    // and "Waterskin" fails a substring test the moment the player types the space.
    expect(names[0]).toBe('Waterskin');
    expect(names.length).toBeGreaterThan(19); // every "waterskin" row, plus the rows carrying both words
    expect(names).toContain('Anointed Waterskin');
  });

  // bug 2026-09-13: search-rank
  it('"kit" leads with the prefix match, then the kits alphabetically, then the toolkits', () => {
    const { host, stop } = open();
    type(searchBox(host), 'kit');
    const names = rowNames(host, '.ai-name');
    stop();

    // Kite — the only name that STARTS with "kit" — outranks a whole-word match, per the rule.
    expect(names[0]).toBe('Kite');
    const kits = names.filter((n) => / Kit$/.test(n));
    const toolkits = names.filter((n) => /Toolkit/.test(n));
    // Every "<class> Kit" precedes every "…Toolkit": whole word beats contains.
    expect(names.indexOf(kits[kits.length - 1])).toBeLessThan(names.indexOf(toolkits[0]));
    // Ties keep the picker's OWN order, which is level then name — not a re-alphabetisation. The 16
    // level-0 class kits stay alphabetical among themselves…
    const classKits = kits.filter((n) => /^(Alchemist|Barbarian|Bard|Champion|Cleric|Druid|Fighter|Investigator|Monk|Oracle|Ranger|Rogue|Sorcerer|Swashbuckler|Witch|Wizard) Kit$/.test(n));
    expect(classKits).toHaveLength(16);
    expect(classKits).toEqual([...classKits].sort((a, b) => a.localeCompare(b)));
    expect(kits.slice(0, 3)).toEqual(['Alchemist Kit', 'Barbarian Kit', 'Bard Kit']);
    // …and still come before the higher-level kits that alphabet alone would have put first.
    expect(names.indexOf('Wizard Kit')).toBeLessThan(names.indexOf('Armor Polishing Kit'));
    // And a row that only matches in its description is behind all of them.
    expect(names.indexOf("Adventurer's Pack")).toBeGreaterThan(names.indexOf(toolkits[0]));
  });
});

describe('bug 2026-09-13: search-rank — the other pickers', () => {
  // bug 2026-09-13: search-rank
  it('the spell picker: "wish" was the LAST of 51 matches, and is now the first', () => {
    const spells = Object.values(content().spells).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    // The same component and the same spec SpellsTab's ManageSpellsModal hands it.
    const { host, stop } = renderDom(
      <FilterableSelect<Spell>
        title="Learn a spell"
        items={spells}
        spec={SPELL_SPEC_BUILDER}
        rowKey={(s) => s.id}
        onClose={() => undefined}
        renderRow={(s) => <PickerRow name={s.name} />}
      />,
    );
    type(searchBox(host), 'wish');
    const names = rowNames(host, '.picker-name');
    stop();

    expect(names[0]).toBe('Wish');
    // The defect this pins: 50 spells whose TEXT says "wish" sorted ahead of the spell called Wish,
    // because rank-then-name put a rank-1 Message above a rank-10 Wish.
    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain('Message');
    expect(names.indexOf('Message')).toBeGreaterThan(0);
  });

  // bug 2026-09-13: search-rank
  it('a name-only picker (the builder familiar abilities) still gets exact-then-prefix-then-word', () => {
    const abilities = Object.values(content().familiarAbilities).sort((a, b) => a.name.localeCompare(b.name));
    // The spec Builder.tsx declares for this picker verbatim: one text field over the name alone.
    const { host, stop } = renderDom(
      <FilterableSelect
        title="Familiar abilities"
        items={abilities}
        spec={{ fields: [{ id: 'desc', label: 'Description', kind: 'text', accessor: (a) => a.name }] }}
        rowKey={(a) => a.id}
        onClose={() => undefined}
        renderRow={(a) => <PickerRow name={a.name} />}
      />,
    );
    type(searchBox(host), 'scent');
    const names = rowNames(host, '.picker-name');
    stop();

    // Alphabetically Scent was LAST of the four; it is the ability the player typed, so it is first.
    expect(names).toEqual(['Scent', 'Crystal Scent', 'Gold Scent', 'Magic Scent']);
  });

  /*
   * adversarially confirmed 2026-09-13: the description-link picker was ranked and NOT covered —
   * deleting its `rankBySearch` call broke no test. It is the one box where ranking is not cosmetic:
   * the index is in BUCKET order (every feat, then every spell, then every item…) and it is cut at 60
   * rows, so measured over the real index "bat" put the entry actually named Bat at position 64 of 93
   * — past the cap, i.e. unreachable, not merely low down. ("gi" sat at 294 of 534, "cat" at 395.)
   */
  // bug 2026-09-13: search-rank
  it('the description-link picker ranks BEFORE its 60-row cap, so the named entry is reachable at all', () => {
    const { host, stop } = renderDom(
      <ContentContext.Provider value={content()}>
        <RefSearchModal onPick={() => undefined} onClose={() => undefined} />
      </ContentContext.Provider>,
    );
    type(host.querySelector<HTMLInputElement>('input'), 'bat');
    const names = rowNames(host, '.ref-search-name');
    stop();

    expect(names[0]).toBe('Bat');
    expect(names).toHaveLength(60); // the cap still holds — ranking decides WHICH 60, not how many
  });

  /*
   * adversarially confirmed 2026-09-13: the note-page icon picker was left unranked. Measured over
   * its own 214 icons, seven queries put the icon the player named behind one that merely contains
   * the word — "map" offered Map pin first, "book" offered Notebook, "stars" offered Moon stars.
   */
  // bug 2026-09-13: search-rank
  it('the note icon picker: the icon whose name was typed is the first one offered', () => {
    const { host, click, stop } = renderDom(<NotesTab character={build('fighter', 1)} onPlay={() => undefined} />);
    click(host.querySelector('.add-item-btn')); // no notes yet → the empty state opens the icon picker
    type(host.querySelector<HTMLInputElement>('.icon-search-row input'), 'map');
    const labels = [...host.querySelectorAll('.icon-opt')].map((b) => b.getAttribute('title') ?? '');
    stop();

    // The Places group lists Map pin before Map; Map is the one the player asked for.
    expect(labels[0]).toBe('Map');
    expect(labels).toContain('Map pin');
  });
});

/*
 * adversarially confirmed 2026-09-13: the search-rank lane wired fifteen boxes and left the two
 * RULES pages — Kingmaker and Mythic — filtering without ordering, which is the same defect. Measured
 * over their own data before this: "camp" put Camp Management behind Camouflage Campsite, "kingdom"
 * put Kingdom Assurance behind Quick Recovery (Kingdom), "mythic" put Mythic Casting behind Summon
 * Mythic Power, "trade" put Trade Commodities behind Establish Trade Agreement.
 */
describe('bug 2026-09-13: search-rank — the rules pages', () => {
  /** Type `q`, open the section named `tab`, and read the entry names it lists. */
  const pageRows = (el: HTMLElement, click: (n: Element | null) => void, q: string, tab: string) => {
    type(el.querySelector<HTMLInputElement>('.mpr-page-search input'), q);
    click([...el.querySelectorAll('.settings-navitem')].find((b) => (b.textContent ?? '').trim() === tab) ?? null);
    return [...el.querySelectorAll('.mpr-proplist .info-term')].map((n) => (n.textContent ?? '').trim());
  };
  /** The same, split by LEVEL group — which is the scope a feat list is ranked within. */
  const pageGroups = (el: HTMLElement, click: (n: Element | null) => void, q: string, tab: string) => {
    pageRows(el, click, q, tab);
    // `.mpr-proplist` only — a destiny's heading is an InfoTerm too, and it is not one of its rows.
    return [...el.querySelectorAll('.mpr-kind')].map((g) => [...g.querySelectorAll('.mpr-proplist .info-term')].map((n) => (n.textContent ?? '').trim()));
  };
  /** The level group holding `name`, so a leg can assert the order inside the group it belongs to. */
  const groupWith = (groups: string[][], name: string) => groups.find((g) => g.includes(name)) ?? [];

  // bug 2026-09-13: search-rank
  it('Kingmaker: the camping activity whose name was typed leads its list', () => {
    const { host, click, stop } = renderDom(<KingmakerRules content={content()} embedded onClose={() => undefined} />);
    const names = pageRows(host, click, 'camp', 'Camping');
    stop();
    expect(names[0]).toBe('Camp Management');
    expect(names).toContain('Camouflage Campsite'); // …which used to be the row above it
  });

  // bug 2026-09-13: search-rank
  it('Kingmaker: the kingdom activity whose name was typed leads its list', () => {
    const { host, click, stop } = renderDom(<KingmakerRules content={content()} embedded onClose={() => undefined} />);
    const names = pageRows(host, click, 'trade', 'Kingdom activities');
    stop();
    // Alphabetically Establish Trade Agreement and Manage Trade Agreements both came first.
    expect(names).toEqual(['Trade Commodities', 'Establish Trade Agreement', 'Manage Trade Agreements']);
  });

  // bug 2026-09-13: search-rank
  it('Mythic: the destiny feat whose name was typed leads its DESTINY group', () => {
    const { host, click, stop } = renderDom(<MythicRules content={content()} embedded onClose={() => undefined} />);
    const g = groupWith(pageGroups(host, click, 'spell', 'Destinies'), 'Spell Network');
    stop();
    // The destiny's own name matches, so it lists all its feats. Spell Network — the feat the player
    // typed — is the only prefix match and now leads; the two whole-word matches keep the destiny's
    // OWN order behind it (Imbue before Galvanize, which is not alphabetical and must not become so).
    expect(g.slice(0, 3)).toEqual(['Spell Network', 'Imbue Spell', 'Galvanize Spell']);
  });
});

/*
 * adversarially confirmed 2026-09-13: the widened FILTER reached exactly one box — FilterableSelect.
 * Every other box in the app still filtered with a plain lowercased `.includes`, so the owner's own
 * spelling ("water skin", with the space) returned ZERO rows everywhere else: the ranking had nothing
 * to lift because the row was gone. These legs drive four of those boxes through their real inputs
 * with a two-word query their substring filter could not match, each one measured against the real
 * content first. The builder's own three boxes are in test/bug-search-rank-builder.test.tsx, beside
 * the harness that drives the real Builder.
 */
describe('bug 2026-09-13: search-rank — a two-word query reaches every box, not just the picker', () => {
  const noop = () => undefined;

  // bug 2026-09-13: search-rank
  it('Conditions: "off guard" finds Off-Guard — the hyphen is exactly the owner\'s "water skin" case', () => {
    const { host, stop } = renderDom(
      <ConditionsModal conditions={content().conditions} active={[]} onAdd={noop} onRemove={noop} onStepValue={noop} onClose={noop} />,
    );
    type(host.querySelector<HTMLInputElement>('.search input'), 'off guard');
    const names = rowNames(host, '.cond-row .mode-name');
    stop();

    // Measured over the 57 conditions: Off-Guard is the only one carrying both tokens, and a
    // substring filter dropped it — a player who types the condition's name without the hyphen was
    // told the app has no such condition.
    expect(names).toEqual(['Off-Guard']);
  });

  // bug 2026-09-13: search-rank
  it('Play actions: "raise shield" finds Raise a Shield, which the substring filter skipped over', () => {
    const { host, click, stop } = renderDom(<MainTab character={build('fighter', 5)} content={content()} onPlay={noop} />);
    click([...host.querySelectorAll('button.stab')].find((b) => (b.textContent ?? '').trim() === 'Actions') ?? null);
    type(host.querySelector<HTMLInputElement>('.acts-controls .search input'), 'raise shield');
    const names = rowNames(host, '.action-name, .action-chip-name');
    stop();

    // The action is called "Raise a Shield", so the player's own phrasing matched nothing at all.
    // Both rows carry both words; they sit in the page's own SECTIONS (Feat actions before Basic
    // actions), which ranking deliberately does not cross — a row must not jump out of its section.
    expect(names).toEqual(['Shield Block', 'Raise a Shield']);
  });

  // bug 2026-09-13: search-rank
  it('Rituals: "oil slicked walls" finds the ritual the character knows', () => {
    const ch: Character = { ...build('wizard', 7), knownRituals: ['oil-slicked-walls', 'awaken-object'] };
    const { host, stop } = renderDom(<SpellsTab character={ch} content={content()} onPlay={noop} />);
    type(host.querySelector<HTMLInputElement>('.acts-controls .search input'), 'oil slicked walls');
    const names = sectionCards(host, 'Rituals');
    stop();

    // "Oil-Slicked Walls" — again a hyphen the player does not type. The other known ritual drops out,
    // so this is the filter answering, not the section rendering everything.
    expect(names).toEqual(['Oil-Slicked Walls']);
  });
});

/*
 * adversarially confirmed 2026-09-13: the Spells page's own "Search spells" box FILTERED and never
 * RANKED — the one main search box the lane missed. A spell list is in the player's own order (the
 * book's ranks, the repertoire as written), so a match sat wherever that order put it.
 *
 * The prepared SLOTS are the exception and must NOT move: "Prepared slots are addressed by ARRAY
 * INDEX (`preparedKey(entryId, rank, index)`) and PlayState keys its prepared spells and expended
 * flags that way" (types.ts, PreparedSlot) — ranking them would slide every expended pip onto a
 * different spell. So the leg asserts both halves at once: the book reorders, the slots do not.
 */
describe('bug 2026-09-13: search-rank — the Spells page ranks its lists and leaves the slots alone', () => {
  /** A wizard whose book holds Fireball (3rd) before Wall of Fire and Fire Shield (4th), with two
   *  4th-rank slots prepared in that same order. */
  const bookWizard = (): Character => {
    const base = build('wizard', 7);
    return {
      ...base,
      spellcasting: base.spellcasting.map((e) =>
        e.type === 'prepared'
          ? {
              ...e,
              spellbook: { 3: ['fireball'], 4: ['wall-of-fire', 'fire-shield'] },
              prepared: {
                4: [
                  { spellId: 'wall-of-fire', expended: false },
                  { spellId: 'fire-shield', expended: false },
                ],
              },
            }
          : e,
      ),
    };
  };

  // bug 2026-09-13: search-rank
  it('ranks the spellbook by match quality while the prepared slots keep their positions', () => {
    const { host, stop } = renderDom(<SpellsTab character={bookWizard()} content={content()} onPlay={() => undefined} />);
    const box = host.querySelector<HTMLInputElement>('.acts-controls .search input');
    // The page's own order, before anyone types: the book by rank, the slots as prepared.
    expect(sectionCards(host, 'Spellbook')).toEqual(['Fireball', 'Wall of Fire', 'Fire Shield']);
    expect(rankGroupCards(host, '4th')).toEqual(['Wall of Fire', 'Fire Shield']);

    type(box, 'fire');
    // Prefix matches first (Fireball, Fire Shield — ties keep the book's order), then the whole-word
    // one. Unranked, the book answered with Fireball, Wall of Fire, Fire Shield — its own rank order.
    expect(sectionCards(host, 'Spellbook')).toEqual(['Fireball', 'Fire Shield', 'Wall of Fire']);
    // …and the slots did not move, though ranking them WOULD have swapped this pair (Fire Shield is a
    // prefix match, Wall of Fire only a whole-word one).
    expect(rankGroupCards(host, '4th')).toEqual(['Wall of Fire', 'Fire Shield']);

    type(box, 'fire wall');
    // The owner's spelling again: no spell is named "fire wall", and the substring filter answered
    // this page with an empty book.
    expect(sectionCards(host, 'Spellbook')).toEqual(['Wall of Fire']);
    expect(rankGroupCards(host, '4th')).toEqual(['Wall of Fire']);
    stop();
  });
});
