// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { addedKeyRowViolations, addedMapKeyViolations, booksOnlyInAddedMaps } from './_sources-added-maps';
import { applySources, buildCharacter, chosenFromBooks, classSubPickOrder, collectChosenIds, emptyBuild, levelGrants, removeChosenIds, runesmithRuneOptions, type BuildState } from '../src/rules/build';
import { offersSpell, pickerSpellOptions, restrictedAllowedOnBooks, spellOptions } from '../src/rules/spellOptions';
import { deriveSkill } from '../src/rules/derive';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { dailyChoicesFor } from '../src/rules/dailyChoices';
import { dailyItemOptions, dailyItemSlots } from '../src/rules/dailyItems';
import { FORMULA_BOOK_ITEM_ID, formulaOptions, formulaSlots } from '../src/rules/formulaBook';
import { FormulaBookPanel } from '../src/sheet/FormulaBookPanel';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { applyPlayState, buyCompanion, emptyPlay, initialPlay, setPreparedSpell } from '../src/rules/play';
import {
  BOOK_FOLDS,
  BOOK_SPLITS,
  CHOOSABLE_SOURCE_MAPS,
  CLASS_OPTION_REPRINTS,
  CORE_BOOKS,
  SOURCE_MAPS_ADDED_2026_09_30,
  classOptionInBook,
  classOptionOn,
  classOptionRecords,
  enabledBookSet,
  entrySourceOn,
  mythicCallingRecords,
  sourceCatalog,
  sourceRowLabelsFor,
  storedSources,
} from '../src/rules/sources';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { ItemEditorModal } from '../src/sheet/ItemEditorModal';
import { AlchemyPicker } from '../src/sheet/AlchemyPanel';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { Builder } from '../src/builder/Builder';
import { FormulaBookCard, OriginPickers, SnareFormulasCard, SourcesCard, useBuilderActions, type BuilderActions } from '../src/builder/shared';
import type { Character, ClassDef, CompanionConfig, ContentDatabase, FeatChoiceDef, InventoryItem, Item, SiegeWeaponStat } from '../src/rules/types';

/*
 * desk sources-apply-to-everything — the owner, 2026-09-30, asked whether the Sources filter should cover siege
 * weapons too: "yes the player sources should aplly to everything he has accses to".
 *
 * Until then siegeWeapons, vehicles and runesmithRune were not in CHOOSABLE_SOURCE_MAPS, so a Core-only character
 * was offered every Guns & Gears, Battlecry! and Howl of the Wild siege weapon in the sheet's Add items shop and
 * in the Add companion picker's Siege tab, and the companion editor's Type selects, familiar ability picker and
 * specialization picker offered every book whatever the character's Sources said.
 *
 * The siege weapon below is the Bombard (AoN siege-weapon-81), printed in Guns & Gears only. Vehicles carried no
 * book (0 of 107) until the regenerating lane of 2026-09-30 gave each the book of its joined Archives document
 * (scripts/import-core-v2.mjs): 103 of 107 now carry one, and "vehicles follow the character's books" below
 * holds them to it (the Ice Breaker, Battlecry!).
 *
 * MUTATION LINES (each proven on a scratch copy restored byte-identically, 2026-09-30)
 *   1. src/rules/sources.ts: drop 'siegeWeapons' from SOURCE_MAPS_ADDED_2026_09_30 → (a) goes red (the Builder's
 *      filtered content keeps the Bombard) and (f) goes red (the siege-only book gets no Sources row).
 *   2. src/sheet/AddItemsModal.tsx: drop `.filter(bookOn)` on the siege weapons → (a) goes red (the shop row).
 *   3. src/sheet/CompanionsTab.tsx addRows: drop `.filter(allowed)` on the siege rows → (a) goes red (Siege tab).
 *   4. src/sheet/CompanionsTab.tsx EditChoices: drop `r.id === current ||` from offeredOrHeld → (c) and the
 *      animal Type select case go red (a held Bombard / Antelope vanishes from its own Type select).
 *
 * THE CLASS SUB-PICKS (refuter's finding, same day). The Builder offers a school, bloodline, patron, eidolon,
 * apparition … from `classes.<id>.subclass.options` / `extraChoices[].options`, and each option's book is its
 * own classFeatures record's (classOptionRecords, src/rules/sources.ts). Before the fix a Core-only wizard was
 * offered the Impossible Magic schools and a summoner every Secrets of Magic eidolon.
 *   5. src/rules/build.ts applySources: drop the class-options pass → the (e) sub-pick cases go red (the Arcane
 *      School popup offers School of Nexian Spaces to a Core-only wizard; apparitions from #216 stay).
 *   6. src/sheet/CompanionsTab.tsx addRows: drop the eidolon `.filter(...)` → the Eidolon tab case goes red.
 *   7. src/sheet/CompanionsTab.tsx EditChoices: drop `o.id === cfg.typeId ||` from the eidolon select's filter
 *      → the held-eidolon case goes red.
 *   8. src/rules/sources.ts sourceCatalog: drop `lists.push(classOptionRecords(...))` → (f)'s sub-pick book
 *      gets no Sources row, and that case goes red.
 *   9. src/rules/build.ts applySources: drop `|| (!!classBook && …)` from keepOpt → the held-animist case goes red,
 *      and so does test/batch28-engine.test.ts's psychic class card ("Key: Int/Cha", read off the held psychic's
 *      own Dark Archive subconscious minds).
 *
 * THE REFUTER'S PASS (same day): the eidolons Impossible Magic prints again, and the held runesmith.
 *  10. src/rules/sources.ts classOptionOn: drop `|| !!r.reprintBooks?.some(...)` → the Eidolon tab, the eidolon
 *      type select, The Unseen Broker and the classOptionOn cases go red (4).
 *  11. src/rules/build.ts applySources: drop `|| (!!book && ownBooks.has(book))` → the held-runesmith case goes red.
 *  12. src/rules/sources.ts classOptionInBook: drop `|| !!r.reprintBooks?.includes(b)` → the held summoner (13, not
 *      Aberrant and Ooze alone) and the classOptionInBook cases go red.
 *
 * THE SECOND REFUTER'S PASS (same day): the Builder's Mythic Calling picker.
 *  14. src/rules/build.ts applySources: never drop a calling → the applySources, both rendered Builder and the
 *      Scenario #6-09 cases go red (4; the Core-only picker offers 18).
 *  15. src/rules/sources.ts sourceCatalog: drop `lists.push(mythicCallingRecords(...))` → the Scenario #6-09 row
 *      case goes red here, and test/sources.test.ts's every-row guard (the exemption) and memo-safe cases go red.
 *  16. src/rules/build.ts collectChosenIds: drop `add(build.mythicCalling)` → both keep-the-chosen-calling cases
 *      go red.
 *  17. src/builder/shared.tsx: never show the empty-list hint → the Core-only rendered case goes red.
 *
 * THE THIRD REFUTER'S PASS (same day): the sub-picks a FEAT asks for, Scenario #6-09's own row, and the sheet's
 * formula book, temporary items and daily open choices.
 *  18. src/rules/build.ts applySources: never assign the feats' narrowed choices → the three Wizard Dedication /
 *      lesson cases go red (applySources, keep-what-you-hold, the rendered Builder).
 *  19. src/rules/build.ts namesClassFeatures: drop the every-option-a-class-sub-pick arm → the same three go red
 *      (Wizard Dedication has no `ownsFeature`); widen it to ANY option → the Advanced Domain / Advanced Weapon
 *      Training case goes red ("time" and "shield" are not class features).
 *  20. src/rules/build.ts collectChosenIds: drop grantedFeatChoices → the keep-what-you-hold case goes red.
 *  21. src/rules/sources.ts sourceCatalog: `ownRow` never true → the Scenario #6-09 row case goes red here, and
 *      test/sources.test.ts's every-row guard ("a 2026-09-30 key has a row of its own").
 *  22. src/rules/formulaBook.ts formulaOptions: drop the `enabled` filter → the formulaOptions case goes red.
 *  23. src/rules/dailyItems.ts: the book check always passes → the dailyItemOptions and rendered dialog cases.
 *  24. src/rules/dailyChoices.ts: drop the book filter → the dailyChoicesFor and rendered dialog cases.
 *  25. src/sheet/CharacterSheet.tsx: call dailyChoicesFor, or dailyItemOptions, without the books → the rendered
 *      dialog case goes red (each alone).
 *  26. src/sheet/FormulaBookPanel.tsx: Add formula offers every item → the rendered Formula Book case goes red.
 *
 * THE CLOSING PASS (same day): property runes, Advanced Alchemy, stored spells, eidolon cantrips, the item editor.
 * Each proven on a scratch copy restored byte-identically (file hash before = after), 2026-09-30.
 *  27. src/rules/build.ts applySources: the runes pass never drops → the Living rune card case goes red (Assisting
 *      offered Core only).
 *  28. src/rules/build.ts collectChosenIds: drop `add(build.bodyRune)` → the chosen-Assisting case goes red (the
 *      card reads empty).
 *  29. src/rules/build.ts chosenFromBooks: drop `bodyRune: null` → the same case goes red (the card lists it).
 *  30. src/sheet/ItemEditorModal.tsx RuneEditor: the book filter always passes → the rune slot case goes red; drop
 *      the etched keep → the same case goes red (an etched Authorized vanishes).
 *  31. src/sheet/ItemEditorModal.tsx: the "Start from an existing item…" filter always passes, or drops the carried
 *      keep → the copy-from case goes red; the bound-spell filter always passes, or drops the bound keep → the
 *      bound-spell case goes red (1400 ≠ 1401; 'empty' ≠ 'picked').
 *  32. src/sheet/AlchemyPanel.tsx: the book filter always passes, or drops the known-formula keep → the Advanced
 *      Alchemy case goes red.
 *  33. src/sheet/ItemDetail.tsx: the stored-spell book filter always passes, or drops the stored keep → the scroll
 *      case goes red.
 *  34. src/sheet/CompanionsTab.tsx: the eidolon cantrip filter always passes, drops the chosen keep, or drops the
 *      granting feat's own book → the Magical Understudy case goes red (each alone).
 *
 * THE CLOSING ROUND'S SECOND FIX (same day): the Spells tab's Prepare / Add and Learn a spell pickers (rituals
 * included), the Builder's Formula book and Snare formulas cards, and a rune etched on held gear. Proven in three
 * scratch runs, each mutation on a code path no other mutation in its run reaches; every file restored
 * byte-identically (hash before = after), 2026-09-30.
 *  35. src/rules/spellOptions.ts pickerSpellOptions: the book filter always passes → the Prepare picker and
 *      pickerSpellOptions cases go red; drop `|| held.has(s.id)` → both go red (the prepared and the named or
 *      repertoire Admonishing Ray vanish); drop the restricted slot's `allowed` early return → the pickerSpellOptions
 *      case goes red ([bless] ≠ [admonishing-ray, bless]).
 *  36. src/sheet/SpellsTab.tsx optionsFor: ask `spellOptions` again → the Prepare picker case goes red.
 *  37. src/sheet/SpellsTab.tsx LearnSpellModal: drop the book filter on the spells → the Learn a spell case goes red;
 *      on the rituals → the Rituals group case goes red.
 *  38. src/builder/shared.tsx FormulaBookCard: call formulaOptions without the books → the Formula book card case
 *      goes red; without `written` → the same case goes red ('empty' ≠ 'picked').
 *  39. src/rules/formulaBook.ts formulaOptions: drop `&& !keep?.has(it.id)` → the Formula book card case goes red.
 *  40. src/rules/snareFormulas.ts: the book filter always passes, or drops the keep → the Snare formulas card case
 *      goes red.
 *  41. src/rules/build.ts collectChosenIds: drop the etched-rune loop → the etched rune case goes red.
 *
 * THE CLOSING ROUND'S THIRD FIX (same day): Master Summoner's two restricted slots, whose `allowed` list is a TRAIT
 * search of the whole database rather than the record's own list. Six scratch runs, one mutation each; every file
 * restored byte-identically (hash before = after), 2026-09-30.
 *  42. src/rules/restrictedSlots.ts: never record `allowedByTrait` → the Master Summoner slots case and the card
 *      case go red (2).
 *  43. src/rules/spellOptions.ts restrictedAllowedOnBooks: the book check always passes → the Master Summoner slots,
 *      named-ids and card cases go red (3).
 *  44. …: drop the held keep → the Master Summoner slots case goes red (a Pest Swarm in the slot vanishes).
 *  45. …: drop the named-id exemption (`!byTrait.has(id) ||`) → the named-ids case goes red ([bless] ≠ [ray, bless]).
 *  46. src/rules/spellOptions.ts pickerSpellOptions: return a restricted slot's list unfiltered again → the Master
 *      Summoner slots and named-ids cases go red (2).
 *  47. src/sheet/SpellsTab.tsx: the extra-cast card names `slot.allowed` again → the card case goes red.
 *
 * THE ROUND-3 REFUTER'S PASS (same day): the empty Mythic Calling hint named War of Immortals alone, though the
 * Scenario #6-09 row alone unlocks the Echoes callings; and that row sat at the Adventure Paths shelf's end.
 *  48. src/builder/shared.tsx SetupUnlockedChoices: never name `callingRows` (the fallback sentence always) → the
 *      Core-only rendered case goes red (the hint names no row: "…Turn its book on in Sources to choose one.").
 *  49. src/rules/sources.ts sourceCatalog: never record an own-row book's home bundle (`homeOf`) → the Scenario
 *      #6-09 row case goes red (the row after "Pathfinder Society" is "Quest for the Frozen Flame").
 */
const GG = 'Pathfinder Guns & Gears';
const IM = 'Pathfinder Impossible Magic';
const BOMBARD = 'bombard';
const ARCANE_RAM = 'arcane-ram'; // Battlecry!
const NO_BOOK_SIEGE = 'test-siege-engine';
const NEW_BOOK = 'Pathfinder Lost Omens Test Siege Manual';
const NEW_BOOK_SIEGE = 'test-manual-trebuchet';
const RUNE = 'atryl-rune-of-fire'; // Impossible Magic, level 1
const noop = () => undefined;
const db = () => content();
const books = (...extra: string[]) => storedSources([...CORE_BOOKS, ...extra]);

/** The real database with a small siege catalog: Bombard (Guns & Gears), Arcane Ram (Battlecry!), and a copy of
 *  the Bombard that carries no book at all. Vehicles: the Raft (GM Core, a Core book since 2026-09-30). */
function siegeDb(): ContentDatabase {
  const c = db();
  const bombard = c.siegeWeapons![BOMBARD];
  const noBook: SiegeWeaponStat = { ...bombard, id: NO_BOOK_SIEGE, name: 'Test Siege Engine', source: undefined };
  return {
    ...c,
    vehicles: { raft: c.vehicles!['raft'] },
    siegeWeapons: { [BOMBARD]: bombard, [ARCANE_RAM]: c.siegeWeapons![ARCANE_RAM], [NO_BOOK_SIEGE]: noBook },
  } as ContentDatabase;
}

/** The names of the rows the rendered shop offers (vehicle and siege rows on: the Inventory tab's shop). */
function shopRows(c: ContentDatabase, enabledSources?: string[]): string[] {
  const s = renderDom(
    <AddItemsModal
      content={{ ...c, items: { longsword: c.items['longsword'] }, services: {} } as ContentDatabase}
      currency={{ gp: 50000 }}
      enabledSources={enabledSources}
      onBuy={noop}
      onGive={noop}
      onBuyCompanion={noop}
      onGiveCompanion={noop}
      onClose={noop}
    />,
  );
  const names = [...s.host.querySelectorAll('.ai-row .ai-name')].map((e) => (e.textContent ?? '').trim()).sort();
  s.stop();
  return names;
}

/** Open the Companions tab's Add companion picker the way a player does and read one tab's row names. */
function addCompanionRows(c: ContentDatabase, character: Character, tab: 'Siege' | 'Vehicle' | 'Eidolon' | 'All'): { names: string[]; text: string } {
  const s = renderDom(<CompanionsTab character={character} content={c} onPlay={noop} charKey="t" />);
  s.click(s.host.querySelector('.cmp-add'));
  const overlay = () => s.host.querySelector('.picker-overlay');
  expect(overlay(), 'the Add companion picker is open').toBeTruthy();
  if (tab !== 'All') {
    const t = [...overlay()!.querySelectorAll('button[role="tab"]')].find((b) => (b.textContent ?? '').trim() === tab) ?? null;
    expect(t, `the ${tab} tab is there`).toBeTruthy();
    s.click(t);
  }
  const names = [...overlay()!.querySelectorAll('.picker-name')].map((e) => (e.firstChild?.textContent ?? '').trim()).sort();
  const text = overlay()!.textContent ?? '';
  s.stop();
  return { names, text };
}

/** Render the Companions tab for one companion, open its Edit choices, and hand back the host (caller stops). */
function editCompanion(c: ContentDatabase, character: Character) {
  const s = renderDom(<CompanionsTab character={character} content={c} onPlay={noop} charKey="t" />);
  s.click(s.host.querySelector('button[title="Edit choices"]'));
  expect(s.host.querySelector('.cmp-edit'), 'Edit choices is open').toBeTruthy();
  return s;
}
const optionNames = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll(`select[aria-label="${label}"] option`)].map((o) => (o.textContent ?? '').trim());

const withCompanions = (companions: CompanionConfig[], enabledSources?: string[]) =>
  ({ ...build('fighter', 3), companions, ...(enabledSources ? { enabledSources } : {}) }) as Character;

afterEach(() => {
  for (const el of [...document.querySelectorAll('.confirm-overlay')]) el.parentElement?.remove();
});

describe('sources-apply-to-everything: fixtures', () => {
  it('are what this file says they are', () => {
    const c = db();
    expect(c.siegeWeapons?.[BOMBARD]?.source?.book).toBe(GG);
    expect((c.siegeWeapons?.[BOMBARD] as { aonId?: string }).aonId).toBe('siege-weapon-81');
    expect(c.siegeWeapons?.[ARCANE_RAM]?.source?.book).toBe('Pathfinder Battlecry!');
    expect(c.vehicles?.['raft']?.source?.book).toBe('Pathfinder GM Core'); // desk #170: vehicle-77's book since 2026-09-30
    expect(c.runesmithRune[RUNE]?.source?.book).toBe(IM);
    expect(c.runesmithRune[RUNE]?.level).toBe(1);
    expect(SOURCE_MAPS_ADDED_2026_09_30).toEqual(['siegeWeapons', 'vehicles', 'runesmithRune']);
    for (const m of SOURCE_MAPS_ADDED_2026_09_30) expect(CHOOSABLE_SOURCE_MAPS as readonly string[]).toContain(m);
  });
});

describe('sources-apply-to-everything: siege weapons follow the character\'s books', () => {
  // (a) Core only → absent everywhere a player could get one
  it('(a) Core only: the Bombard is not in the shop, not on the Add companion Siege tab, not in the Builder\'s content', () => {
    const c = siegeDb();
    const core = withCompanions([]);
    expect(core.enabledSources).toBeUndefined();
    expect(shopRows(c)).not.toContain('Bombard');
    const tab = addCompanionRows(c, core, 'Siege');
    expect(tab.names).not.toContain('Bombard');
    expect(tab.names).not.toContain('Arcane Ram');
    expect(tab.text).toContain('more from books this character'); // the picker says why the list is short
    // the content applySources hands every Builder picker (CHOOSABLE_SOURCE_MAPS)
    const picker = applySources(db(), enabledBookSet(undefined), collectChosenIds(emptyBuild(), db()));
    expect(picker.siegeWeapons?.[BOMBARD]).toBeUndefined();
    expect(db().siegeWeapons?.[BOMBARD]).toBeTruthy(); // the sheet's content is never filtered
  });

  // (b) the book on → present
  it('(b) Guns & Gears on: the Bombard is offered in the shop and on the Siege tab; Battlecry! stays off', () => {
    const c = siegeDb();
    const rows = shopRows(c, books(GG));
    expect(rows).toContain('Bombard');
    expect(rows).not.toContain('Arcane Ram');
    const tab = addCompanionRows(c, withCompanions([], books(GG)), 'Siege');
    expect(tab.names).toContain('Bombard');
    expect(tab.names).not.toContain('Arcane Ram');
    expect(applySources(db(), enabledBookSet(books(GG)), new Set()).siegeWeapons?.[BOMBARD]).toBeTruthy();
  });

  // (c) keep-what-you-hold
  it('(c) an owned Bombard stays on the Companions tab with Guns & Gears off, and its Type select keeps it', () => {
    const c = siegeDb();
    const owned: CompanionConfig = { id: 'c1', kind: 'siege', name: '', typeId: BOMBARD };
    const character = withCompanions([owned]);
    expect(enabledBookSet(character.enabledSources).has(GG)).toBe(false);
    // the stat block resolves the record: its Launch attack and crew are the Bombard's own
    const stats = renderDom(<CompanionsTab character={character} content={c} onPlay={noop} charKey="t" />);
    const statText = stats.host.textContent ?? '';
    stats.stop();
    expect(statText).toContain('4d10 bludgeoning');
    expect(statText).toContain('2–4 crew');
    const s = editCompanion(c, character);
    const types = optionNames(s.host, 'Type');
    const picked = (s.host.querySelector('select[aria-label="Type"]') as HTMLSelectElement | null)?.value;
    s.stop();
    expect(picked).toBe(BOMBARD);
    expect(types.some((t) => t.startsWith('Bombard'))).toBe(true); // held: kept in the list
    expect(types.some((t) => t.startsWith('Arcane Ram'))).toBe(false); // Battlecry! off: not offered
    expect(types.some((t) => t.startsWith('Test Siege Engine'))).toBe(true); // no book: always offered
  });

  it('(c) the Sources card turns Guns & Gears off without listing or removing the owned siege weapon', async () => {
    const c = db();
    const feat = 'firework-technician-dedication';
    expect(c.feats[feat]?.source?.book).toBe(GG);
    const owned: CompanionConfig = { id: 'c1', kind: 'siege', name: '', typeId: BOMBARD };
    const start: BuildState = { ...emptyBuild(), name: 'Holder', level: 2, enabledSources: books(GG), featPicks: { '2:class:0': feat }, companions: [owned] };
    expect(chosenFromBooks(start, c, new Set([GG])).map((x) => x.id)).toEqual([feat]);
    let latest = start;
    function Harness() {
      const [b, setB] = useState<BuildState>(start);
      const actions = useBuilderActions(setB, c);
      latest = b;
      return <SourcesCard build={b} actions={actions} catalog={sourceCatalog(c)} content={c} />;
    }
    const s = renderDom(<Harness />);
    s.click([...s.host.querySelectorAll('.src-cat-name')].find((e) => (e.textContent ?? '').includes('Rulebooks')) ?? null);
    const row = [...s.host.querySelectorAll('.src-book')].find((e) => e.querySelector('.src-book-name')?.firstChild?.textContent === 'Guns & Gears');
    expect(row?.classList.contains('on')).toBe(true);
    s.click(row!);
    await act(async () => undefined);
    const dialog = document.querySelector('.confirm-modal')?.textContent ?? '';
    expect(dialog).toContain('Firework Technician Dedication');
    expect(dialog).not.toContain('Bombard');
    const ok = [...document.querySelectorAll('.confirm-modal button')].find((e) => (e.textContent ?? '').trim() === 'Remove and turn off');
    await act(async () => {
      ok!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    s.stop();
    expect(enabledBookSet(latest.enabledSources).has(GG)).toBe(false);
    expect(Object.values(latest.featPicks)).not.toContain(feat);
    expect(latest.companions).toEqual([owned]);
  });

  it('(c) a Bombard bought from the shop lives in play.companions, and stays and renders once Guns & Gears is off', () => {
    const c = siegeDb();
    // what the Inventory tab's onBuyCompanion does with the shop's siege pick (src/sheet/InventoryTab.tsx)
    const play = buyCompanion({ ...emptyPlay(), currency: { gp: 1000 } }, { kind: 'siege', name: '', typeId: BOMBARD } as Omit<CompanionConfig, 'id'>, { gp: 100 });
    expect(play.companions?.map((x) => x.typeId)).toEqual([BOMBARD]);
    // the stored character holds no companion of its own, and Guns & Gears is off (no stored choice = Core)
    const stored = withCompanions([]);
    expect(stored.companions).toEqual([]);
    expect(enabledBookSet(stored.enabledSources).has(GG)).toBe(false);
    const live = applyPlayState(stored, play, c);
    expect(live.companions).toEqual(play.companions);
    const s = renderDom(<CompanionsTab character={live} content={c} onPlay={noop} charKey="t" />);
    const text = s.host.textContent ?? '';
    s.stop();
    expect(text).toContain('4d10 bludgeoning');
    expect(text).toContain('2–4 crew');
    // …while the Siege tab offers no second one
    expect(addCompanionRows(c, live, 'Siege').names).not.toContain('Bombard');
    // the Sources card works on the BuildState; the play record is not one of its inputs, and nothing above changed it
    expect(play.companions?.map((x) => x.typeId)).toEqual([BOMBARD]);
  });

  // (d) no book → never filtered
  it('(d) a record with no book is offered to a Core-only character: a siege weapon without a book (and the Raft, GM Core)', () => {
    const c = siegeDb();
    const rows = shopRows(c);
    expect(rows).toContain('Raft');
    expect(rows).toContain('Test Siege Engine');
    expect(addCompanionRows(c, withCompanions([]), 'Siege').names).toContain('Test Siege Engine');
    expect(addCompanionRows(c, withCompanions([]), 'Vehicle').names).toContain('Raft');
  });
});

/*
 * desk #170, the regenerating lane of 2026-09-30: VEHICLES GET THEIR BOOK. scripts/import-core-v2.mjs carried the
 * vehicles bucket wholesale from the Foundry-era reference, so all 107 shipped without `source.book` and the filter
 * (entrySourceOn: no book = always) could not reach them — a Core-only character was offered Battlecry!'s Ice
 * Breaker (vehicle-110) in the shop and on the Add companion picker's Vehicle tab. Each vehicle now takes the book
 * of the Archives document its record is joined to; the few with none (the Magic Carpet: no document) stay
 * unfiltered. The fixtures case pins the importer's half (before the lane 0 of 107 vehicles carried a book, so it
 * and the Core-only case fail on that data). MUTATION LINES, each proven on the regenerated data and restored
 * byte-identically, 2026-09-30:
 *   1. src/sheet/CompanionsTab.tsx addRows: drop `.filter(allowed)` on the vehicle rows → the Core-only case goes
 *      red (the Vehicle tab offers the Ice Breaker).
 *   2. src/sheet/AddItemsModal.tsx: drop `.filter(bookOn)` on the vehicles → the Core-only case goes red (the shop).
 */
const ICE_BREAKER = 'aon-ice-breaker';
const BATTLECRY = 'Pathfinder Battlecry!';
const HIGH_SEAS = 'Pathfinder High Seas';
function vehicleDb(): ContentDatabase {
  const c = db();
  return {
    ...c,
    siegeWeapons: {},
    vehicles: { raft: c.vehicles!['raft'], [ICE_BREAKER]: c.vehicles![ICE_BREAKER], 'flying-carpet': c.vehicles!['flying-carpet'] },
  } as ContentDatabase;
}

describe('sources-apply-to-everything: vehicles follow the character\'s books (desk #170)', () => {
  it('(g) fixtures: the Ice Breaker is Battlecry!\'s (vehicle-110), the Raft GM Core\'s, the Magic Carpet has no book', () => {
    const c = db();
    expect(c.vehicles?.[ICE_BREAKER]?.name).toBe('Ice Breaker');
    expect((c.vehicles?.[ICE_BREAKER] as { aonId?: string }).aonId).toBe('vehicle-110');
    expect(c.vehicles?.[ICE_BREAKER]?.source?.book).toBe(BATTLECRY);
    expect(c.vehicles?.['raft']?.source?.book).toBe('Pathfinder GM Core');
    expect(c.vehicles?.['flying-carpet']?.name).toBe('Magic Carpet');
    expect(c.vehicles?.['flying-carpet']?.source?.book).toBeUndefined();
  });

  it('(g) Core only: no Ice Breaker in the shop, on the Vehicle tab or in the Builder\'s content; the Raft and the bookless Magic Carpet stay', () => {
    const c = vehicleDb();
    const core = withCompanions([]);
    expect(core.enabledSources).toBeUndefined();
    const rows = shopRows(c);
    expect(rows).not.toContain('Ice Breaker');
    expect(rows).toContain('Raft');
    expect(rows).toContain('Magic Carpet');
    const tab = addCompanionRows(c, core, 'Vehicle');
    expect(tab.names).not.toContain('Ice Breaker');
    expect(tab.names).toContain('Raft');
    expect(tab.names).toContain('Magic Carpet');
    expect(applySources(db(), enabledBookSet(undefined), collectChosenIds(emptyBuild(), db())).vehicles?.[ICE_BREAKER]).toBeUndefined();
    expect(db().vehicles?.[ICE_BREAKER]).toBeTruthy(); // the sheet's content is never filtered
  });

  it('(g) Battlecry! on: the Ice Breaker is offered in the shop and on the Vehicle tab', () => {
    const c = vehicleDb();
    expect(shopRows(c, books(BATTLECRY))).toContain('Ice Breaker');
    expect(addCompanionRows(c, withCompanions([], books(BATTLECRY)), 'Vehicle').names).toContain('Ice Breaker');
    expect(applySources(db(), enabledBookSet(books(BATTLECRY)), new Set()).vehicles?.[ICE_BREAKER]).toBeTruthy();
  });

  it('(g) an owned Ice Breaker stays on the Companions tab with Battlecry! off, and its Type select keeps it', () => {
    const c = vehicleDb();
    const owned: CompanionConfig = { id: 'v1', kind: 'vehicle', name: '', typeId: ICE_BREAKER };
    const character = withCompanions([owned]);
    expect(enabledBookSet(character.enabledSources).has(BATTLECRY)).toBe(false);
    const s = renderDom(<CompanionsTab character={character} content={c} onPlay={noop} charKey="t" />);
    const text = s.host.textContent ?? '';
    s.stop();
    expect(text).toContain('Ice Breaker');
    expect(text).toContain('1 pilot, 25 crew'); // the stat block resolves the held record
    const e = editCompanion(c, character);
    const picked = (e.host.querySelector('select[aria-label="Type"]') as HTMLSelectElement | null)?.value;
    const types = optionNames(e.host, 'Type');
    e.stop();
    expect(picked).toBe(ICE_BREAKER);
    expect(types.some((t) => t.startsWith('Ice Breaker'))).toBe(true);
  });

  /*
   * desk #170, the Bone Ship. Its record is joined to creature-4838 (High Seas), a stat block the importer's load
   * loop skips (REF_SKIP), so the first cut of the lane left it bookless and a Core-only character was still offered
   * it. The importer now reads such a document from the whole-export index (reprints.docs). MUTATION LINE: in
   * scripts/import-core-v2.mjs drop `?? exportDoc(String(id))` and regenerate → this case goes red (the Bone Ship
   * has no book). Proven 2026-09-30 on the previous regeneration's core.json, which was built without that
   * fallback and differs from the shipped one in this record's source alone; public/core.json restored
   * byte-identically.
   */
  it('(g) the Bone Ship takes High Seas from its stat block (creature-4838): off for Core only, offered with High Seas on', () => {
    const c = db();
    const bone = c.vehicles?.['bone-ship'] as { aonId?: string; name?: string; source?: { book?: string } } | undefined;
    expect(bone?.name).toBe('Bone Ship');
    expect(bone?.aonId).toBe('creature-4838');
    expect(bone?.source?.book).toBe(HIGH_SEAS);
    const v = { ...c, siegeWeapons: {}, vehicles: { raft: c.vehicles!['raft'], 'bone-ship': c.vehicles!['bone-ship'] } } as ContentDatabase;
    expect(shopRows(v)).not.toContain('Bone Ship');
    expect(addCompanionRows(v, withCompanions([]), 'Vehicle').names).not.toContain('Bone Ship');
    expect(shopRows(v)).toContain('Raft');
    expect(shopRows(v, books(HIGH_SEAS))).toContain('Bone Ship');
    expect(addCompanionRows(v, withCompanions([], books(HIGH_SEAS)), 'Vehicle').names).toContain('Bone Ship');
  });
});

describe('sources-apply-to-everything: the Builder\'s runic repertoire filters like feats', () => {
  // (e)
  it('(e) Impossible Magic off: Atryl, Rune of Fire is not offered; on: it is; a rune already in the repertoire is kept', () => {
    const c = db();
    const off = applySources(c, enabledBookSet(undefined), collectChosenIds(emptyBuild(), c));
    expect(off.runesmithRune[RUNE]).toBeUndefined();
    expect(runesmithRuneOptions(1, off).map((r) => r.id)).not.toContain(RUNE);
    const on = applySources(c, enabledBookSet(books(IM)), collectChosenIds(emptyBuild(), c));
    expect(runesmithRuneOptions(1, on).map((r) => r.id)).toContain(RUNE);
    // chosen: kept in the picker's content whatever the books (collectChosenIds) — here a repertoire whose
    // runesmith class and dedication are both gone, so only the chosen rune is
    const holder: BuildState = { ...emptyBuild(), name: 'Rune', runesmithRunes: [RUNE] };
    expect(collectChosenIds(holder, c).has(RUNE)).toBe(true);
    const kept = applySources(c, enabledBookSet(undefined), collectChosenIds(holder, c));
    expect(runesmithRuneOptions(1, kept).map((r) => r.id)).toEqual([RUNE]);
  });

  // refuter's pass (desk #170): the runic repertoire is the runesmith's own pick list (CLASS_OWN_PICK_MAPS), so a
  // HELD runesmith — class or dedication — keeps every rune of its own book (Impossible Magic) when that book is
  // off, as a held class keeps its own-book sub-picks, and can still add runes at level-up.
  it('(e) a held runesmith, or a Runesmith Dedication, with Impossible Magic off is still offered its own book\'s runes', () => {
    const c = db();
    const all = Object.keys(c.runesmithRune).length; // 44, every one Impossible Magic
    expect(Object.values(c.runesmithRune).every((r) => r.source?.book === IM)).toBe(true);
    expect(c.classes['runesmith']?.source?.book).toBe(IM);
    expect(c.feats['runesmith-dedication']?.source?.book).toBe(IM);
    for (const held of [{ classId: 'runesmith' }, { featPicks: { '2:class:0': 'runesmith-dedication' } }] as Partial<BuildState>[]) {
      const b: BuildState = { ...emptyBuild(), name: 'Held', level: 20, ...held, runesmithRunes: [RUNE] };
      expect(b.enabledSources).toBeUndefined(); // no stored choice: Core only, Impossible Magic off
      const picker = applySources(c, enabledBookSet(undefined), collectChosenIds(b, c));
      expect(runesmithRuneOptions(20, picker)).toHaveLength(all);
      expect(runesmithRuneOptions(1, picker).map((r) => r.id)).toContain('baruiel-rune-of-holds-bravery');
    }
    // nobody holds the class or the dedication: the book decides, as for everyone else
    expect(runesmithRuneOptions(20, applySources(c, enabledBookSet(undefined), new Set()))).toHaveLength(0);
  });

  it('(e) turning Impossible Magic off lists the rune like a feat, and removal clears only it', () => {
    const c = db();
    const other = 'baruiel-rune-of-holds-bravery';
    const b: BuildState = { ...emptyBuild(), name: 'Rune', runesmithRunes: [RUNE, other] };
    const listed = chosenFromBooks(b, c, new Set([IM]));
    // by name: Atryl before Baruiel
    expect(listed.map((x) => [x.id, x.kind])).toEqual([
      [RUNE, 'runesmithRune'],
      [other, 'runesmithRune'],
    ]);
    expect(removeChosenIds(b, new Set([RUNE])).runesmithRunes).toEqual([other]);
  });
});

/*
 * (e) the class sub-picks. Fixture books, from each option's classFeatures record (public/core.json at 2a23c10):
 * School of Nexian Spaces — Impossible Magic; Runelord — Lost Omens Rival Academies; School of Battle Magic —
 * Player Core; Shepherd of Errant Winds — #216: The Acropolis Pyre; Crafter in the Vault — War of Immortals;
 * Angel Eidolon — Secrets of Magic; Aberrant Eidolon — Impossible Magic.
 */
const WOI = 'Pathfinder War of Immortals';
const P216 = 'Pathfinder #216: The Acropolis Pyre';
const SOM = 'Pathfinder Secrets of Magic';
const RA = 'Pathfinder Lost Omens Rival Academies';
const opts = (c: ContentDatabase, cls: string) => ((c.classes[cls] as ClassDef | undefined)?.subclass?.options ?? []).map((o) => o.id);
const extra = (c: ContentDatabase, cls: string, g: string) =>
  ((c.classes[cls] as ClassDef | undefined)?.extraChoices ?? []).find((x) => x.id === g)?.options.map((o) => o.id) ?? [];

describe('sources-apply-to-everything: the class sub-picks follow the character\'s books', () => {
  it('fixtures: each option\'s book is its classFeatures record\'s', () => {
    const r = classOptionRecords(db());
    expect(r.get('school-of-nexian-spaces')?.source?.book).toBe(IM);
    expect(r.get('runelord')?.source?.book).toBe(RA);
    expect(r.get('school-of-battle-magic')?.source?.book).toBe('Pathfinder Player Core');
    expect(r.get('shepherd-of-errant-winds')?.source?.book).toBe(P216);
    expect(r.get('crafter-in-the-vault')?.source?.book).toBe(WOI);
    expect(r.get('angel-eidolon')?.source?.book).toBe(SOM);
    expect(r.get('aberrant-eidolon')?.source?.book).toBe(IM);
    // measured 2026-09-30: every one of the 250 options has such a record
    const all = Object.values(db().classes).flatMap((c) => [...(c.subclass?.options ?? []), ...(c.extraChoices ?? []).flatMap((g) => g.options)]);
    expect(new Set(all.map((o) => o.id)).size).toBe(250);
    expect(r.size).toBe(250);
  });

  it('(e) applySources: a Core-only wizard is not offered the Impossible Magic or Rival Academies schools; the book on offers them', () => {
    const c = db();
    const core = applySources(c, enabledBookSet(undefined), collectChosenIds(emptyBuild(), c));
    expect(opts(core, 'wizard')).toContain('school-of-battle-magic');
    expect(opts(core, 'wizard')).not.toContain('school-of-nexian-spaces');
    expect(opts(core, 'wizard')).not.toContain('runelord');
    expect(extra(core, 'wizard', 'thesis')).toHaveLength(5); // all Player Core: untouched
    const im = applySources(c, enabledBookSet(books(IM)), new Set());
    expect(opts(im, 'wizard')).toContain('school-of-nexian-spaces');
    expect(opts(im, 'wizard')).not.toContain('runelord');
    // the sheet's content is never filtered
    expect(opts(c, 'wizard')).toContain('school-of-nexian-spaces');
  });

  it('(e) applySources: extra choices too — an animist with War of Immortals on is offered its apparitions, not #216\'s', () => {
    const c = db();
    const woi = applySources(c, enabledBookSet(books(WOI)), new Set());
    expect(extra(woi, 'animist', 'apparition')).toContain('crafter-in-the-vault');
    expect(extra(woi, 'animist', 'apparition')).not.toContain('shepherd-of-errant-winds');
    expect(extra(applySources(c, enabledBookSet(books(WOI, P216)), new Set()), 'animist', 'apparition')).toContain('shepherd-of-errant-winds');
  });

  it('(e) keep-what-you-hold: a chosen school, apparition and archetype eidolon stay offered with their books off', () => {
    const c = db();
    const holder: BuildState = {
      ...emptyBuild(),
      name: 'Holder',
      classId: 'wizard',
      subclassId: 'runelord',
      extraChoices: { apparition: ['shepherd-of-errant-winds'] },
      archetypeEidolonType: 'swarm-eidolon', // Battlecry!
    };
    const keep = collectChosenIds(holder, c);
    for (const id of ['runelord', 'shepherd-of-errant-winds', 'swarm-eidolon']) expect(keep.has(id)).toBe(true);
    const picker = applySources(c, enabledBookSet(books(WOI)), keep);
    expect(opts(picker, 'wizard')).toContain('runelord');
    expect(extra(picker, 'animist', 'apparition')).toContain('shepherd-of-errant-winds');
    // the summoner class itself (Impossible Magic) is off here; with it on, the held Swarm Eidolon stays beside
    // Aberrant, and Elemental (Rage of Elements, not held) does not
    const withIm = applySources(c, enabledBookSet(books(WOI, IM)), keep);
    expect(opts(withIm, 'summoner')).toEqual(expect.arrayContaining(['aberrant-eidolon', 'swarm-eidolon']));
    expect(opts(withIm, 'summoner')).not.toContain('elemental-eidolon');
    // …and the Sources card never lists or removes a class option: it is part of the class, not a choosable record
    expect(chosenFromBooks(holder, c, new Set([RA, P216, 'Pathfinder Battlecry!'])).map((x) => x.id)).toEqual([]);
    expect(removeChosenIds(holder, new Set(['swarm-eidolon'])).archetypeEidolonType).toBeNull(); // mirrors collectChosenIds
  });

  it('(e) an option printed in its class\'s own book goes with a held class: a held animist keeps its War of Immortals apparitions, not #216\'s', () => {
    const c = db();
    const holder: BuildState = { ...emptyBuild(), name: 'Held', classId: 'animist' };
    // Core only, the animist (War of Immortals) held: the class stays, and so do the options printed with it
    const picker = applySources(c, enabledBookSet(undefined), collectChosenIds(holder, c));
    expect(picker.classes['animist']).toBeTruthy();
    expect(extra(picker, 'animist', 'apparition')).toContain('crafter-in-the-vault');
    expect(opts(picker, 'animist')).toContain('medium');
    // …while an option from another book still follows its own
    expect(extra(picker, 'animist', 'apparition')).not.toContain('shepherd-of-errant-winds');
    // a class nobody holds is gone whole, options and all
    expect(applySources(c, enabledBookSet(undefined), collectChosenIds(emptyBuild(), c)).classes['animist']).toBeUndefined();
  });

  /** Mount the Builder on page 0 and read the Arcane School popup's option names. */
  function arcaneSchoolOptions(over: Partial<BuildState>): string[] {
    const c = db();
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'wizard',
      ancestryId: 'human',
      backgroundId: Object.keys(c.backgrounds).find((id) => CORE_BOOKS.includes(c.backgrounds[id].source?.book ?? '')) ?? null,
      keyAbility: 'int',
      ...over,
    };
    const r = renderDom(<Builder content={c} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
    const ctl = r.host.querySelector<HTMLElement>('[data-ctl-title="Arcane School"]');
    expect(ctl, 'the Arcane School picker is on page 0').toBeTruthy();
    const opener = ctl!.matches('button') ? ctl : ctl!.querySelector<HTMLElement>('.ss-replace');
    r.click(opener);
    const names = [...r.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.firstChild?.textContent ?? '').trim());
    r.stop();
    return names;
  }

  it('(e) the rendered Builder: Core only offers School of Battle Magic and not School of Nexian Spaces; Impossible Magic on offers it', () => {
    const core = arcaneSchoolOptions({});
    expect(core).toContain('School of Battle Magic');
    expect(core).not.toContain('School of Nexian Spaces');
    expect(core).not.toContain('Runelord');
    const im = arcaneSchoolOptions({ enabledSources: books(IM) });
    expect(im).toContain('School of Nexian Spaces');
    expect(im).not.toContain('Runelord');
  });

  it('(e) the rendered Builder: a chosen Runelord stays in the popup with Rival Academies off', () => {
    const names = arcaneSchoolOptions({ subclassId: 'runelord' });
    expect(names).toContain('Runelord');
    expect(names).not.toContain('School of Nexian Spaces');
  });

  it('the Add companion picker\'s Eidolon tab: Impossible Magic on offers every eidolon it prints, Angel included; Secrets of Magic alone offers Angel, not Aberrant', () => {
    const im = addCompanionRows(db(), withCompanions([], books(IM)), 'Eidolon').names;
    expect(im).toEqual([...IM_EIDOLONS].sort());
    expect(im).not.toContain('Swarm Eidolon'); // Battlecry!
    expect(im).not.toContain('Elemental Eidolon'); // Rage of Elements
    const som = addCompanionRows(db(), withCompanions([], books(SOM)), 'Eidolon').names;
    expect(som).toContain('Angel Eidolon'); // its first printing still counts
    expect(som).not.toContain('Aberrant Eidolon');
    // Core only: no eidolon at all is offered (every eidolon type is printed outside the Core books)
    expect(addCompanionRows(db(), withCompanions([]), 'All').names.filter((n) => / Eidolon$/.test(n))).toEqual([]);
  });

  it('the companion editor\'s eidolon type select keeps a held Swarm Eidolon with Battlecry! off, and offers Impossible Magic\'s Angel, not Elemental', () => {
    const c = db();
    const s = editCompanion(c, withCompanions([{ id: 'c1', kind: 'eidolon', name: '', typeId: 'swarm-eidolon' }], books(IM)));
    const types = optionNames(s.host, 'Eidolon type');
    s.stop();
    expect(types).toContain('Swarm Eidolon');
    expect(types).toContain('Aberrant Eidolon');
    expect(types).toContain('Angel Eidolon');
    expect(types).not.toContain('Elemental Eidolon');
  });
});

/*
 * THE LATER PRINTINGS (refuter's pass, desk #170). Impossible Magic, the remastered summoner's own book, prints
 * eleven eidolons again (AoN eidolon-15 … eidolon-26) that our classFeatures records still file under Secrets of
 * Magic or Book of the Dead, and Dark Archive (Remastered) prints The Unseen Broker (patron-29) again after
 * Divine Mysteries. CLASS_OPTION_REPRINTS carries those books (test/class-option-reprints.test.ts derives it from
 * the mirror); an option is on through any of its printings.
 */
const IM_EIDOLONS = [
  'Aberrant Eidolon', 'Ooze Eidolon', // their records are Impossible Magic
  'Angel Eidolon', 'Anger Phantom Eidolon', 'Beast Eidolon', 'Construct Eidolon', 'Demon Eidolon', 'Devotion Phantom Eidolon',
  'Dragon Eidolon', 'Fey Eidolon', 'Plant Eidolon', 'Psychopomp Eidolon', 'Undead Eidolon', // reprinted there
];

describe('sources-apply-to-everything: an option is on through any of its printings', () => {
  it('fixtures: the eleven eidolon records name the older book, and the table names Impossible Magic', () => {
    const r = classOptionRecords(db());
    expect(r.get('angel-eidolon')?.source?.book).toBe(SOM);
    expect(r.get('undead-eidolon')?.source?.book).toBe('Pathfinder Book of the Dead');
    expect(CLASS_OPTION_REPRINTS['angel-eidolon']).toEqual([{ book: IM, aonId: 'eidolon-15' }]);
    expect(r.get('angel-eidolon')?.reprintBooks).toEqual([IM]);
    expect(Object.keys(CLASS_OPTION_REPRINTS)).toHaveLength(12);
  });

  it('a new summoner with Impossible Magic on (the refuter\'s case) is offered the 13 eidolons Impossible Magic prints, not 2', () => {
    const c = db();
    const b: BuildState = { ...emptyBuild(), name: 'S', classId: 'summoner', enabledSources: books(IM) };
    const names = (applySources(c, enabledBookSet(b.enabledSources), collectChosenIds(b, c)).classes['summoner'] as ClassDef).subclass!.options.map((o) => o.name);
    expect([...names].sort()).toEqual([...IM_EIDOLONS].sort());
    // a HELD summoner with no stored Sources (Core only, Impossible Magic off): the class's own book is Impossible
    // Magic, and a later printing there counts as its own book (classOptionInBook), so the same 13 stay
    const held: BuildState = { ...emptyBuild(), name: 'S', classId: 'summoner' };
    const heldNames = (applySources(c, enabledBookSet(undefined), collectChosenIds(held, c)).classes['summoner'] as ClassDef).subclass!.options.map((o) => o.name);
    expect([...heldNames].sort()).toEqual([...IM_EIDOLONS].sort());
  });

  it('The Unseen Broker (Player Core witch) is on through Divine Mysteries or Dark Archive (Remastered), off with neither', () => {
    const c = db();
    const on = (...extra: string[]) => opts(applySources(c, enabledBookSet(books(...extra)), new Set()), 'witch').includes('the-unseen-broker');
    expect(on()).toBe(false);
    expect(on('Pathfinder Lost Omens Divine Mysteries')).toBe(true);
    expect(on('Pathfinder Dark Archive (Remastered)')).toBe(true);
  });

  it('classOptionOn / classOptionInBook read the record\'s book and every later printing\'s', () => {
    const r = classOptionRecords(db()).get('beast-eidolon')!;
    expect(classOptionOn(new Set([IM]), r)).toBe(true);
    expect(classOptionOn(new Set([SOM]), r)).toBe(true);
    expect(classOptionOn(new Set(CORE_BOOKS), r)).toBe(false);
    expect(classOptionInBook(r, IM)).toBe(true);
    expect(classOptionInBook(r, 'Pathfinder Battlecry!')).toBe(false);
    expect(classOptionOn(new Set(CORE_BOOKS), {})).toBe(true); // no book: always
  });
});

describe('sources-apply-to-everything: the companion editor offers the character\'s books only', () => {
  it('the animal Type select: Core only offers Ape, not Elk (Howl of the Wild); a held Antelope stays', () => {
    const c = db();
    const s = editCompanion(c, withCompanions([{ id: 'c1', kind: 'animal', name: '', typeId: 'aon-antelope', maturity: 'young' }]));
    const types = optionNames(s.host, 'Companion type');
    s.stop();
    expect(types).toContain('Antelope');
    expect(types).toContain('Ape');
    expect(types).not.toContain('Elk');
  });

  it('the familiar ability picker: Core only hides Darkeater (Secrets of Magic), keeps a held Gills and a bookless Animated', () => {
    const c = db();
    const s = editCompanion(c, withCompanions([{ id: 'c1', kind: 'familiar', name: '', abilities: ['gills'] }]));
    const chip = [...s.host.querySelectorAll('.cmp-crow')].find((r) => r.querySelector('.cmp-lbl')?.textContent === 'Abilities')?.querySelector('button');
    s.click(chip ?? null);
    const names = [...s.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.firstChild?.textContent ?? '').trim());
    s.stop();
    expect(names).toContain('Accompanist');
    expect(names).toContain('Animated');
    expect(names).toContain('Gills');
    expect(names).not.toContain('Darkeater');
    expect(names).not.toContain('Ambassador');
  });

  it('the specialization picker: Core only offers Ambusher, not Shade or Deep Diver; a held Wind Chaser stays', () => {
    const c = db();
    const s = editCompanion(c, withCompanions([{ id: 'c1', kind: 'animal', name: '', typeId: 'ape', maturity: 'specialized', specialization: 'wind-chaser' }]));
    const chip = [...s.host.querySelectorAll('.cmp-crow')].find((r) => r.querySelector('.cmp-lbl')?.textContent === 'Specialization')?.querySelector('button');
    s.click(chip ?? null);
    const names = [...s.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.firstChild?.textContent ?? '').trim());
    s.stop();
    expect(names).toContain('Ambusher');
    expect(names).toContain('Wind Chaser');
    expect(names).not.toContain('Shade');
    expect(names).not.toContain('Deep Diver');
  });
});

/*
 * THE MYTHIC CALLING PICKER (second refuter's pass, desk #170). The Builder's Level 0 "Mythic Calling" picker
 * (SetupUnlockedChoices) offers the `calling`-trait classFeatures, which no pass reached: a Core-only character
 * with Mythic on was offered all 18 callings (War of Immortals 11, Revenge of the Runelords Player's Guide 4,
 * Society Scenario #6-09 3) while the same character was offered no mythic feat. mythicCallingRecords
 * (src/rules/sources.ts) names them; applySources drops the ones whose book is off; the chosen one stays.
 */
const WOI_CALLING = 'acrobats-calling'; // War of Immortals, mythic-calling-1
const ROR_CALLING = 'runelords-calling'; // Revenge of the Runelords Player's Guide
const ECHO_CALLING = 'echoes-of-the-swords'; // Pathfinder Society Scenario #6-09
const ROR_GUIDE = "Pathfinder Revenge of the Runelords Player's Guide";
const PFS_609 = 'Pathfinder Society Scenario #6-09: The Power of Legends';
const callingIds = (c: ContentDatabase) =>
  Object.values(c.classFeatures).filter((f) => (f.traits ?? []).includes('calling')).map((f) => f.id).sort();

describe('sources-apply-to-everything: the Mythic Calling picker follows the character\'s books', () => {
  it('fixtures: 18 callings, each with a book; mythicCallingRecords names exactly them', () => {
    const c = db();
    expect(callingIds(c)).toHaveLength(18);
    expect(mythicCallingRecords(c).map((f) => f.id).sort()).toEqual(callingIds(c));
    expect(c.classFeatures[WOI_CALLING]?.source?.book).toBe(WOI);
    expect(c.classFeatures[ROR_CALLING]?.source?.book).toBe(ROR_GUIDE);
    expect(c.classFeatures[ECHO_CALLING]?.source?.book).toBe(PFS_609);
    expect(mythicCallingRecords(c).every((f) => !!f.source?.book)).toBe(true);
  });

  it('(e) applySources: Core only offers no calling; each book on offers its own; every other classFeature stays', () => {
    const c = db();
    const core = applySources(c, enabledBookSet(undefined), collectChosenIds(emptyBuild(), c));
    expect(callingIds(core)).toEqual([]);
    // only calling records leave: every other classFeature is granted by a class, not picked
    expect(Object.keys(core.classFeatures).length).toBe(Object.keys(c.classFeatures).length - 18);
    const woi = callingIds(applySources(c, enabledBookSet(books(WOI)), new Set()));
    expect(woi).toHaveLength(11);
    expect(woi).toContain(WOI_CALLING);
    expect(woi).not.toContain(ROR_CALLING);
    expect(woi).not.toContain(ECHO_CALLING);
    expect(callingIds(applySources(c, enabledBookSet(books(ROR_GUIDE)), new Set()))).toContain(ROR_CALLING);
    expect(callingIds(applySources(c, enabledBookSet(books(PFS_609)), new Set()))).toEqual(['echoes-of-the-scrolls', 'echoes-of-the-spells', ECHO_CALLING]);
    // a calling with no book is never filtered
    const noBook = { ...c, classFeatures: { ...c.classFeatures, [ECHO_CALLING]: { ...c.classFeatures[ECHO_CALLING], source: undefined } } } as ContentDatabase;
    expect(callingIds(applySources(noBook, enabledBookSet(undefined), new Set()))).toEqual([ECHO_CALLING]);
    // the sheet's content is never filtered
    expect(callingIds(c)).toHaveLength(18);
  });

  it('(e) keep-what-you-hold: a chosen calling stays offered with its book off, and the Sources card never lists or removes it', () => {
    const c = db();
    const holder: BuildState = { ...emptyBuild(), name: 'Mythic', mythicEnabled: true, mythicCalling: ECHO_CALLING };
    const keep = collectChosenIds(holder, c);
    expect(keep.has(ECHO_CALLING)).toBe(true);
    expect(callingIds(applySources(c, enabledBookSet(books(WOI)), keep))).toContain(ECHO_CALLING);
    expect(chosenFromBooks(holder, c, new Set([PFS_609, WOI])).map((x) => x.id)).toEqual([]);
    expect(removeChosenIds(holder, new Set([ECHO_CALLING])).mythicCalling).toBeNull(); // mirrors collectChosenIds
  });

  /** Mount the Builder on page 0 with Mythic on and read the Mythic Calling control: its option count, the
   *  popup's names (when it has any), and whether the empty-list hint shows. */
  function mythicCallingPicker(over: Partial<BuildState>): { count: number; names: string[]; hint: boolean; hintText: string } {
    const c = db();
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'fighter',
      ancestryId: 'human',
      backgroundId: Object.keys(c.backgrounds).find((id) => CORE_BOOKS.includes(c.backgrounds[id].source?.book ?? '')) ?? null,
      keyAbility: 'str',
      mythicEnabled: true,
      ...over,
    };
    const r = renderDom(<Builder content={c} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
    const ctl = r.host.querySelector<HTMLElement>('[data-ctl-title="Mythic Calling"]');
    expect(ctl, 'the Mythic Calling picker is on page 0').toBeTruthy();
    const count = Number(ctl!.getAttribute('data-ctl-options'));
    const hintText = [...r.host.querySelectorAll('.setup-hint')].map((e) => e.textContent ?? '').find((t) => t.includes('Every Mythic Calling')) ?? '';
    const hint = (r.host.textContent ?? '').includes('Every Mythic Calling is printed in a book this character has switched off');
    let names: string[] = [];
    if (count > 0) {
      r.click(ctl!.matches('button') ? ctl : ctl!.querySelector<HTMLElement>('.ss-replace'));
      names = [...r.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.firstChild?.textContent ?? '').trim());
    }
    r.stop();
    return { count, names, hint, hintText };
  }

  it('(e) the rendered Builder: Core only offers no calling and says why; War of Immortals on offers Acrobat\'s Calling, not the Echoes', () => {
    const core = mythicCallingPicker({});
    expect(core.count).toBe(0);
    expect(core.hint).toBe(true);
    // round-3 refuter: the hint names EVERY Sources row that prints a calling, not War of Immortals alone
    // (switching on only the Scenario #6-09 row unlocks the three Echoes callings)
    expect(core.hintText).toContain('War of Immortals');
    expect(core.hintText).toContain('Revenge of the Runelords');
    expect(core.hintText).toContain('Society Scenario #6-09: The Power of Legends');
    expect(core.hintText).toMatch(/ or [^,]+ on in Sources to choose one\.$/);
    const echoes = mythicCallingPicker({ enabledSources: books(PFS_609) });
    expect(echoes.hint).toBe(false);
    expect(echoes.names.sort()).toEqual(['Echoes of the Scrolls', 'Echoes of the Spells', 'Echoes of the Swords']);
    const woi = mythicCallingPicker({ enabledSources: books(WOI) });
    expect(woi.count).toBe(11);
    expect(woi.hint).toBe(false);
    expect(woi.names).toContain("Acrobat's Calling");
    expect(woi.names).not.toContain('Echoes of the Swords');
  });

  it('(e) the rendered Builder: a chosen Echoes of the Swords stays in the picker with its book off', () => {
    const held = mythicCallingPicker({ mythicCalling: ECHO_CALLING });
    expect(held.count).toBe(1);
    expect(held.hint).toBe(false);
    expect(held.names).toContain('Echoes of the Swords');
    expect(held.names).not.toContain("Acrobat's Calling");
  });

  it('(f) the Society Scenario #6-09 key the callings bring is a row of its own, OFF, never derived on; the Society row is untouched; a pair naming it fails', () => {
    const c = db();
    const only = booksOnlyInAddedMaps(c);
    expect([...only]).toEqual([PFS_609]);
    const entries = sourceCatalog(c).groups.flatMap((g) => g.entries);
    const row = entries.find((e) => e.books.includes(PFS_609));
    // third refuter's pass: its own row (the design), not a seat in the Pathfinder Society bundle
    expect(row?.books).toEqual([PFS_609]);
    expect(row?.label).toBe('Society Scenario #6-09: The Power of Legends');
    expect(row?.count).toBe(3);
    expect(addedKeyRowViolations(sourceCatalog(c).groups, only)).toEqual([]);
    const societyRow = entries.find((e) => e.label === 'Pathfinder Society');
    expect(societyRow?.books).not.toContain(PFS_609);
    // round-3 refuter: the row is SHOWN right after the Society bundle it would have joined, not at the shelf's
    // end under "Standalone Adventures"; every other row keeps its place
    const shelf = sourceCatalog(c).groups.find((g) => g.entries.some((e) => e.books.includes(PFS_609)))!.entries.map((e) => e.label);
    expect(shelf[shelf.indexOf('Pathfinder Society') + 1]).toBe('Society Scenario #6-09: The Power of Legends');
    expect(shelf.filter((l) => l !== row!.label).at(-1)).toBe('Standalone Adventures');
    expect(sourceRowLabelsFor(sourceCatalog(c).groups, mythicCallingRecords(c).map((f) => f.source?.book)).sort()).toEqual(
      ['Revenge of the Runelords', 'Society Scenario #6-09: The Power of Legends', 'War of Immortals'],
    );
    // a stored selection with the whole Society row on still reads that row ALL on, and does not get #6-09
    const society = societyRow!.books;
    for (const sel of [undefined, [...CORE_BOOKS, ...society], books(...society)]) expect(enabledBookSet(sel).has(PFS_609)).toBe(false);
    expect(society.every((b) => enabledBookSet(books(...society)).has(b))).toBe(true);
    expect(callingIds(applySources(c, enabledBookSet(books(...society)), new Set()))).not.toContain(ECHO_CALLING);
    expect(callingIds(applySources(c, enabledBookSet(books(...society, PFS_609)), new Set()))).toContain(ECHO_CALLING);
    const pairs = [...BOOK_SPLITS, ...BOOK_FOLDS];
    expect(addedMapKeyViolations([PFS_609], only, pairs)).toEqual([]);
    // mutation: a split that would derive it on from another Society book
    expect(addedMapKeyViolations([PFS_609], only, [...pairs, [society[0], PFS_609]])).toHaveLength(1);
    // mutation: the key seated inside the Society bundle, as the second pass had it
    const bundled = [{ category: 'Other', entries: [{ label: 'Pathfinder Society', books: [...society, PFS_609] }] }];
    expect(addedKeyRowViolations(bundled, only)).toHaveLength(1);
  });
});

/*
 * (f) the every-row guard's exception (test/sources.test.ts, test/_sources-added-maps.ts). The real database has
 * one such key, Society Scenario #6-09 (the Mythic Callings, above); the case below proves the exception on a
 * synthetic database too: one siege weapon under a book no other record carries.
 */
describe('sources-apply-to-everything: a book only a 2026-09-30 map carries', () => {
  function newBookDb(): ContentDatabase {
    const c = db();
    const t: SiegeWeaponStat = { ...c.siegeWeapons![BOMBARD], id: NEW_BOOK_SIEGE, name: 'Test Manual Trebuchet', source: { book: NEW_BOOK, license: 'ORC' } };
    return { ...c, siegeWeapons: { ...c.siegeWeapons, [NEW_BOOK_SIEGE]: t } } as ContentDatabase;
  }

  it('(f) has a Sources row of its own, OFF for every existing selection, and a player can switch it on', () => {
    const c = newBookDb();
    expect(booksOnlyInAddedMaps(c)).toEqual(new Set([NEW_BOOK, PFS_609]));
    const row = sourceCatalog(c).groups.flatMap((g) => g.entries).find((e) => e.books.includes(NEW_BOOK));
    expect(row?.books).toEqual([NEW_BOOK]);
    expect(row?.count).toBe(1);
    // never derived on: no stored choice (Core only), an old unmarked selection, a marked one
    for (const sel of [undefined, [...CORE_BOOKS, GG], books(GG)]) expect(enabledBookSet(sel).has(NEW_BOOK)).toBe(false);
    expect(shopRows(c, books(GG))).not.toContain('Test Manual Trebuchet');
    expect(shopRows(c, books(GG, NEW_BOOK))).toContain('Test Manual Trebuchet');
  });

  it('(f) the exception holds for it, and fails for a pair that names it or a key another map carries', () => {
    const c = newBookDb();
    const only = booksOnlyInAddedMaps(c);
    const pairs = [...BOOK_SPLITS, ...BOOK_FOLDS];
    expect(addedMapKeyViolations([NEW_BOOK], only, pairs)).toEqual([]);
    // mutation: a split that would derive it on from Guns & Gears
    expect(addedMapKeyViolations([NEW_BOOK], only, [...pairs, [GG, NEW_BOOK]])).toHaveLength(1);
    // mutation: a key that feats carry is not the exception's to excuse
    expect(addedMapKeyViolations([GG], only, pairs)).toHaveLength(1);
    // and the real database carries one, the Mythic Callings' Society Scenario #6-09 (measured 2026-09-30)
    expect([...booksOnlyInAddedMaps(db())]).toEqual([PFS_609]);
  });

  it('(f) a book only a class sub-pick carries gets its own row too, OFF until switched on', () => {
    const c = db();
    const NEW = 'Pathfinder Lost Omens Test Schools';
    const cc = {
      ...c,
      classFeatures: { ...c.classFeatures, runelord: { ...c.classFeatures['runelord'], source: { book: NEW, license: 'ORC' } } },
    } as ContentDatabase;
    expect(booksOnlyInAddedMaps(cc)).toEqual(new Set([NEW, PFS_609]));
    const row = sourceCatalog(cc).groups.flatMap((g) => g.entries).find((e) => e.books.includes(NEW));
    expect(row?.books).toEqual([NEW]);
    expect(row?.count).toBe(1);
    for (const sel of [undefined, [...CORE_BOOKS, RA], books(RA)]) expect(enabledBookSet(sel).has(NEW)).toBe(false);
    expect(opts(applySources(cc, enabledBookSet(books(RA)), new Set()), 'wizard')).not.toContain('runelord');
    expect(opts(applySources(cc, enabledBookSet(books(NEW)), new Set()), 'wizard')).toContain('runelord');
  });
});

/*
 * THE THIRD REFUTER'S PASS (same day). The class sub-picks a FEAT asks for: a multiclass dedication's school,
 * bloodline, order, patron, mystery, instinct, muse …, and the witch's Basic / Greater / Major Lesson, all read
 * `feats.<id>.choice.options`, which the class pass never reached — a Core-only character's Arcane School picker
 * hid School of Gates while Wizard Dedication still offered it. applySources now narrows a feat's or class
 * feature's choice whose answers ARE class features (`ownsFeature`, or every option a class sub-pick).
 */
const SK = 'Pathfinder Lost Omens Shining Kingdoms';
const KM169 = 'Pathfinder #169: Kindled Magic';
const ROE = 'Pathfinder Rage of Elements';
const choiceOpts = (c: ContentDatabase, map: 'feats' | 'classFeatures', id: string) =>
  (((c[map] as Record<string, { choice?: FeatChoiceDef }>)[id]?.choice?.options ?? []) as { value: string }[]).map((o) => o.value.replace(/^aon-/, ''));

describe('sources-apply-to-everything: a class sub-pick a feat asks for follows the character\'s books', () => {
  it('fixtures: Wizard Dedication and Basic Lesson are Player Core; School of Gates and Lesson of Calamity are not', () => {
    const c = db();
    expect(c.feats['wizard-dedication'].source?.book).toBe('Pathfinder Player Core');
    expect(c.feats['basic-lesson'].source?.book).toBe('Pathfinder Player Core');
    expect(c.feats['basic-lesson'].choice?.ownsFeature).toBe(true);
    expect(c.classFeatures['school-of-gates'].source?.book).toBe(SK);
    expect(c.classFeatures['lesson-of-calamity'].source?.book).toBe(KM169);
    expect(choiceOpts(c, 'feats', 'wizard-dedication')).toContain('school-of-gates');
    expect(choiceOpts(c, 'feats', 'basic-lesson')).toContain('lesson-of-calamity');
  });

  it('(e) applySources: Core only hides School of Gates from Wizard Dedication and Lesson of Calamity from Basic Lesson; each book on offers it', () => {
    const c = db();
    const core = applySources(c, enabledBookSet(undefined), new Set());
    expect(choiceOpts(core, 'feats', 'wizard-dedication')).toContain('school-of-battle-magic');
    expect(choiceOpts(core, 'feats', 'wizard-dedication')).not.toContain('school-of-gates');
    // the class's own picker and the dedication agree
    expect(opts(core, 'wizard')).not.toContain('school-of-gates');
    expect(choiceOpts(core, 'feats', 'basic-lesson')).toContain('lesson-of-dreams');
    expect(choiceOpts(core, 'feats', 'basic-lesson')).not.toContain('lesson-of-calamity');
    expect(choiceOpts(core, 'feats', 'sorcerer-dedication')).not.toContain('bloodline-genie');
    expect(choiceOpts(applySources(c, enabledBookSet(books(SK)), new Set()), 'feats', 'wizard-dedication')).toContain('school-of-gates');
    expect(choiceOpts(applySources(c, enabledBookSet(books(KM169)), new Set()), 'feats', 'basic-lesson')).toContain('lesson-of-calamity');
    // the sheet's content is never filtered
    expect(choiceOpts(c, 'feats', 'wizard-dedication')).toContain('school-of-gates');
  });

  it('(e) a choice whose answers are not class features is untouched: Advanced Domain keeps "time" (a domain), Advanced Weapon Training "shield" (a weapon group)', () => {
    const c = db();
    const core = applySources(c, enabledBookSet(undefined), new Set());
    expect(core.feats['advanced-domain']).toBe(c.feats['advanced-domain']);
    expect(choiceOpts(core, 'feats', 'advanced-domain')).toContain('time');
    expect(core.feats['advanced-weapon-training']).toBe(c.feats['advanced-weapon-training']);
    expect(choiceOpts(core, 'feats', 'advanced-weapon-training')).toContain('shield');
  });

  it('(e) the asking record\'s own book: a held Psychic Dedication with Dark Archive off keeps its six conscious minds', () => {
    const c = db();
    const core = applySources(c, enabledBookSet(undefined), new Set(['psychic-dedication']));
    expect(core.feats['psychic-dedication']).toBeTruthy();
    expect(choiceOpts(core, 'feats', 'psychic-dedication')).toEqual(choiceOpts(c, 'feats', 'psychic-dedication'));
    expect(choiceOpts(core, 'feats', 'psychic-dedication')).toHaveLength(6);
  });

  it('(e) keep-what-you-hold: an answered school, an answered lesson (stored `aon-`) and a granted answer stay offered; the card never lists them', () => {
    const c = db();
    const holder: BuildState = {
      ...emptyBuild(),
      name: 'Held',
      featChoices: { '2:class:0': 'school-of-gates', '2:class:1': 'aon-lesson-of-calamity' },
      grantedFeatChoices: { 'order-explorer': 'flame-order' },
    };
    const keep = collectChosenIds(holder, c);
    expect(keep.has('school-of-gates') && keep.has('aon-lesson-of-calamity') && keep.has('flame-order')).toBe(true);
    const core = applySources(c, enabledBookSet(undefined), keep);
    expect(choiceOpts(core, 'feats', 'wizard-dedication')).toContain('school-of-gates');
    expect(choiceOpts(core, 'feats', 'basic-lesson')).toContain('lesson-of-calamity');
    expect(choiceOpts(core, 'feats', 'order-explorer')).toContain('flame-order');
    expect(choiceOpts(core, 'feats', 'order-explorer')).not.toContain('wave-order');
    expect(chosenFromBooks(holder, c, new Set([SK, KM169, SOM]))).toEqual([]);
    // removeChosenIds mirrors collectChosenIds, field for field
    expect(removeChosenIds(holder, new Set(['flame-order'])).grantedFeatChoices).toEqual({});
  });

  /** Mount the Builder on page 2 of a fighter who took Wizard Dedication and read its school picker. */
  function dedicationSchoolPicker(over: Partial<BuildState>): { count: number; names: string[] } {
    const c = db();
    const g = levelGrants(2, 'fighter', c, null, undefined, null, null, false, []);
    const slot = `2:class:${g.featSlots.findIndex((s) => s === 'class')}`;
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 2,
      classId: 'fighter',
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'acolyte',
      keyAbility: 'str',
      featPicks: { [slot]: 'wizard-dedication' },
      ...over,
    };
    const r = renderDom(<Builder content={c} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === '2') ?? null);
    const ctl = [...r.host.querySelectorAll<HTMLElement>('[data-ctl-title]')].find((e) => /^arcane school$/i.test(e.getAttribute('data-ctl-title') ?? '') && e.getAttribute('data-ctl-title') !== 'Arcane School');
    expect(ctl, "Wizard Dedication's school picker is on page 2").toBeTruthy();
    const count = Number(ctl!.getAttribute('data-ctl-options'));
    r.click(ctl!.matches('button') ? ctl! : ctl!.querySelector<HTMLElement>('.ss-replace, button'));
    const names = [...r.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.firstChild?.textContent ?? '').trim());
    r.stop();
    return { count, names };
  }

  it('(e) the rendered Builder: Wizard Dedication, Core only, offers School of Battle Magic and not School of Gates; Shining Kingdoms on offers it', () => {
    const core = dedicationSchoolPicker({});
    const sk = dedicationSchoolPicker({ enabledSources: books(SK) });
    expect(core.names).toContain('School of Battle Magic');
    expect(core.names).not.toContain('School of Gates');
    expect(sk.names).toContain('School of Gates');
    expect(sk.count).toBeGreaterThan(core.count);
  });

  /*
   * THE FINAL REFUTER'S PASS: with Shining Kingdoms on, the dedication's picker read "... School of the Boundary,
   * School of Unified Magical Theory, School of Gates, School of Kalistrade" — the stored list's order, Player Core
   * first and each later book appended — while the wizard's own Arcane School picker places a switched-on book's
   * schools among the rest. A class sub-pick a record asks for is now offered in the class picker's order.
   */
  it('(e) the rendered Builder: a switched-on book\'s school sits in alphabetical order in Wizard Dedication\'s picker, as in the wizard\'s own', () => {
    const alpha = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));
    const sk = dedicationSchoolPicker({ enabledSources: books(SK) });
    const named = sk.names.filter((n) => /school|runelord/i.test(n));
    expect(named).toContain('School of Gates');
    expect(named).toEqual(alpha(named));
    // mutation-proof: the stored list is NOT in that order, so the picker's order is the Builder's doing
    const stored = (db().feats['wizard-dedication'].choice?.options ?? []).map((o) => o.label);
    expect(stored).not.toEqual(alpha(stored));
    expect(stored.indexOf('School of Gates')).toBeGreaterThan(stored.indexOf('School of Unified Magical Theory'));
    expect(named.indexOf('School of Gates')).toBeLessThan(named.indexOf('School of Mentalism'));
    // …and the class's own picker, the order being matched, is alphabetical too
    const wizardOwn = (db().classes['wizard'].subclass?.options ?? []).map((o) => o.name);
    expect(wizardOwn).toEqual(alpha(wizardOwn));
  });

  it('(e) classSubPickOrder reorders a class sub-pick only: a choice whose answers are not class features keeps its printed order', () => {
    const c = db();
    const labelled = (id: string) => (c.feats[id].choice?.options ?? []).map((o) => ({ value: o.value, label: o.label }));
    const school = labelled('wizard-dedication');
    const ordered = classSubPickOrder(school, c.feats['wizard-dedication'].choice, c);
    expect(ordered.map((o) => o.label)).toEqual([...school.map((o) => o.label)].sort((a, b) => a.localeCompare(b)));
    expect(new Set(ordered.map((o) => o.value))).toEqual(new Set(school.map((o) => o.value)));
    // Advanced Domain names domains, Advanced Weapon Training weapon groups: returned as given, same array
    for (const id of ['advanced-domain', 'advanced-weapon-training']) {
      const opts = labelled(id);
      expect(classSubPickOrder(opts, c.feats[id].choice, c)).toBe(opts);
    }
  });
});

/*
 * THE THIRD REFUTER'S PASS, the sheet: the formula book's two pickers, the daily temporary-item slots and the
 * daily open choices read `items` / `spells` / `feats` whole, whatever the character's books. They now narrow an
 * OPEN pool to the character's books; a pool of what the character holds, and a stored answer, are never narrowed.
 */
const typeInto = (input: HTMLInputElement | null, value: string) => {
  expect(input, 'the search box is there').toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('sources-apply-to-everything: the sheet\'s formula book, temporary items and daily open choices follow the books', () => {
  const OCTOPUS = 'octopus-potion'; // Rage of Elements, level 6
  const alchemist = () => build('alchemist', 18, { featPicks: { '18:class': 'improbable-elixirs' } }) as Character;

  it('formulaOptions: Improbable Elixirs, Core only, offers no Octopus Potion (Rage of Elements); the book on offers it; no `enabled` = every book', () => {
    const c = db();
    expect(c.items[OCTOPUS]?.source?.book).toBe(ROE);
    const ch = alchemist();
    const slot = formulaSlots(ch, c).find((s) => s.sourceId === 'improbable-elixirs')!;
    const ids = (e?: Set<string>) => formulaOptions(slot, ch, c, e).map((i) => i.id);
    expect(ids(enabledBookSet(undefined))).toContain('healing-potion-lesser');
    expect(ids(enabledBookSet(undefined))).not.toContain(OCTOPUS);
    expect(ids(enabledBookSet(books(ROE)))).toContain(OCTOPUS);
    expect(ids()).toContain(OCTOPUS);
  });

  /** Render the alchemist's Formula Book panel, open Add formula, search "octopus" and read the names. */
  function addFormulaNames(enabledSources: string[] | undefined, held: string[] = []): string[] {
    const c = db();
    const ch = alchemist();
    const inv = { ...ch.inventory.find((i) => i.itemId === FORMULA_BOOK_ITEM_ID)!, formulas: held };
    const s = renderDom(<FormulaBookPanel character={{ ...ch, enabledSources }} inv={inv} content={c} onPlay={noop} />);
    s.click([...s.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Add formula') ?? null);
    typeInto(s.host.querySelector<HTMLInputElement>('.picker-overlay .fsel-results-search input'), 'octopus');
    const names = [...s.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.textContent ?? '').trim());
    s.stop();
    return names;
  }

  it('the rendered Formula Book: Add formula, Core only, offers no Octopus Potion; Rage of Elements on offers it; a formula the book holds stays', () => {
    const name = db().items[OCTOPUS].name;
    expect(addFormulaNames(undefined).some((n) => n.startsWith(name))).toBe(false);
    expect(addFormulaNames(books(ROE)).some((n) => n.startsWith(name))).toBe(true);
    expect(addFormulaNames(undefined, [OCTOPUS]).some((n) => n.startsWith(name))).toBe(true);
  });

  const THICKET = 'thicket-of-knives'; // Impossible Magic, rank 1
  const scrollRogue = () => {
    const c0 = build('rogue', 8, {});
    return { ...c0, feats: [...c0.feats, { featId: 'basic-scroll-cache', level: 1, slot: 'x:0' }, { featId: 'arodens-innovation', level: 1, slot: 'x:1' }] } as Character;
  };

  it('dailyItemOptions: Basic Scroll Cache, Core only, offers Fleet Step and not Thicket of Knives (Impossible Magic); on offers it; the stored answer stays', () => {
    const c = db();
    expect(c.spells[THICKET]?.source?.book).toBe(IM);
    const ch = scrollRogue();
    const slot = dailyItemSlots(ch, c).find((s) => s.sourceId === 'basic-scroll-cache')!;
    expect(slot.spellRank).toBe(1);
    expect(slot.fromSpellbook).toBeFalsy();
    const ids = (o?: { enabled?: Set<string>; keep?: string }) => dailyItemOptions(slot, ch, c, o).map((x) => x.id);
    expect(ids({ enabled: enabledBookSet(undefined) })).toContain('fleet-step');
    expect(ids({ enabled: enabledBookSet(undefined) })).not.toContain(THICKET);
    expect(ids({ enabled: enabledBookSet(books(IM)) })).toContain(THICKET);
    expect(ids({ enabled: enabledBookSet(undefined), keep: THICKET })).toContain(THICKET);
    expect(ids()).toContain(THICKET);
  });

  /** Aroden's Innovation's options (every general feat of 3rd level or lower), and one printed outside the Core books. */
  const arodenCase = () => {
    const c = db();
    const ch = scrollRogue();
    const all = dailyChoicesFor(ch, c).find((x) => x.recordId === 'arodens-innovation')!;
    const offBook = all.options.map((o) => o.value).find((id) => {
      const b = c.feats[id]?.source?.book;
      return !!b && !CORE_BOOKS.includes(b);
    })!;
    return { c, ch, all, offBook, offBookBook: c.feats[offBook].source!.book! };
  };

  it("dailyChoicesFor: Aroden's Innovation, Core only, offers no general feat from an off book; its book on offers it; the stored answer stays", () => {
    const { c, ch, all, offBook, offBookBook } = arodenCase();
    expect(all.kind).toBe('open');
    expect(offBook, 'a general feat of 3rd level or lower outside the Core books').toBeTruthy();
    const opt = (x: Character, e?: Set<string>) =>
      dailyChoicesFor(x, c, { enabled: e }).find((d) => d.recordId === 'arodens-innovation')!.options.map((o) => o.value);
    const core = opt(ch, enabledBookSet(undefined));
    expect(core.length).toBeGreaterThan(10);
    expect(core).not.toContain(offBook);
    expect(core.every((id) => !c.feats[id]?.source?.book || CORE_BOOKS.includes(c.feats[id].source!.book!))).toBe(true);
    expect(opt(ch, enabledBookSet(books(offBookBook)))).toContain(offBook);
    expect(opt({ ...ch, dailyChoices: { [all.key]: offBook } }, enabledBookSet(undefined))).toContain(offBook);
    expect(opt(ch)).toContain(offBook);
  });

  /** Open the rendered sheet's Daily preparations dialog: the Aroden's Innovation list and the scroll slot's count. */
  function dailyDialog(enabledSources: string[] | undefined): { feats: string[]; scrolls: number } {
    const c = db();
    const ch = { ...scrollRogue(), enabledSources };
    const s = renderDom(<CharacterSheet character={ch} content={c} charKey="t" onPlay={noop} onRest={noop} />);
    s.click([...s.host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations') ?? null);
    const dialog = s.host.querySelector('.confirm-modal');
    expect(dialog, 'the Daily preparations dialog is open').toBeTruthy();
    const feats = [...dialog!.querySelectorAll('select.daily-text option')].map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    const slot = dailyItemSlots(ch, c).find((x) => x.sourceId === 'basic-scroll-cache')!;
    const ctl = [...dialog!.querySelectorAll<HTMLElement>('[data-ctl-title]')].find((e) => e.getAttribute('data-ctl-title') === slot.label);
    expect(ctl, 'the scroll slot picker is in the dialog').toBeTruthy();
    const scrolls = Number(ctl!.getAttribute('data-ctl-options'));
    s.stop();
    return { feats, scrolls };
  }

  it('the rendered Daily preparations dialog: Core only leaves the off-book feat and the Impossible Magic scrolls out; the books on bring them back', () => {
    const { c, offBook, offBookBook } = arodenCase();
    const core = dailyDialog(undefined);
    const on = dailyDialog(books(offBookBook, IM));
    expect(core.feats.length).toBeGreaterThan(10);
    expect(core.feats).not.toContain(offBook);
    expect(on.feats).toContain(offBook);
    const imRank1 = Object.values(c.spells).filter((sp) => sp.rank === 1 && !sp.ritual && sp.source?.book === IM).length;
    expect(imRank1).toBeGreaterThan(0);
    expect(on.scrolls - core.scrolls).toBeGreaterThanOrEqual(imRank1);
  });
});

/*
 * THE CLOSING PASS (desk #170, same day): the five pickers still reading a whole map — the property runes (the
 * sheet's item editor rune slot and the Builder's Living rune card; a rune's book is its item twin's, the `runes`
 * record has none), the alchemist's Advanced / Quick Alchemy picker, a generic scroll's or wand's stored-spell
 * picker, the Magical Understudy eidolon cantrips, and the item editor's "Start from an existing item…" and
 * bound-spell lists. Each offers the character's books; what the character holds or has answered stays.
 */
describe('sources-apply-to-everything: runes, alchemy, stored spells, eidolon cantrips and the item editor follow the books', () => {
  const TV = 'Pathfinder Treasure Vault (Remastered)';
  const Z181 = 'Pathfinder #181: Zombie Feast';
  const THICKET_OF_KNIVES = 'thicket-of-knives'; // Impossible Magic, rank 1
  const pickerNames = (host: HTMLElement) => [...host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.textContent ?? '').trim());
  const has = (list: string[], name: string) => list.some((n) => n.startsWith(name));

  /** The sheet's item editor on an owned +1 longsword: open property rune slot 1 and read what it offers. */
  function runeSlot(enabledSources: string[] | undefined, etched: string[] = []): string[] {
    const c = db();
    const ch = { ...build('fighter', 5), enabledSources } as Character;
    const inv = { instanceId: 'w1', itemId: 'longsword', quantity: 1, runes: { potency: 1, property: etched } } as InventoryItem;
    const s = renderDom(<ItemEditorModal mode="edit" item={c.items['longsword']} inv={inv} inventory={[inv]} content={c} character={ch} onPlay={noop} onSave={noop} onClose={noop} />);
    s.click(s.host.querySelector('.sd-rune-pick'));
    const out = pickerNames(s.host);
    s.stop();
    return out;
  }

  it('the item editor rune slot: Core only offers Flaming, not Authorized (Treasure Vault); the book on offers it; an etched Authorized stays', () => {
    const c = db();
    expect(c.items['authorized']?.source?.book).toBe(TV); // the twin carries the book …
    expect((c.runes['authorized'] as { source?: { book?: string } }).source?.book).toBeUndefined(); // … the rune record none
    expect(c.items['flaming']?.source?.book).toBe('Pathfinder GM Core');
    const core = runeSlot(undefined);
    expect(has(core, 'Flaming')).toBe(true);
    expect(has(core, 'Authorized')).toBe(false);
    expect(has(runeSlot(books(TV)), 'Authorized')).toBe(true);
    expect(has(runeSlot(undefined, ['authorized']), 'Authorized')).toBe(true);
  });

  /** A Runescarred fighter with Living Rune (the batch 036 shape), Builder-side. */
  const livingRune = (over: Partial<BuildState> = {}): BuildState =>
    ({
      ...emptyBuild(),
      name: 't',
      level: 8,
      classId: 'fighter',
      ancestryId: Object.keys(db().ancestries)[0],
      backgroundId: Object.keys(db().backgrounds)[0],
      keyAbility: 'str',
      featPicks: { '2:class:0': 'runescarred-dedication', '6:class:0': 'living-rune' },
      ...over,
    }) as unknown as BuildState;

  /** Render the Builder's origins page on the content the Builder hands it (applySources, Builder.tsx) and open
   *  the Living rune card's picker. */
  function livingRuneCard(b: BuildState) {
    const c = db();
    const picker = applySources(c, enabledBookSet(b.enabledSources), collectChosenIds(b, c));
    const s = renderDom(<OriginPickers build={b} actions={{ patch: noop } as unknown as BuilderActions} content={picker} />);
    const ctl = s.host.querySelector('[data-ctl-title="Property rune on your body"]');
    expect(ctl, 'the Living rune card is there').toBeTruthy();
    const shown = (ctl!.querySelector('.popsel-val')?.textContent ?? '').trim();
    const state = ctl!.getAttribute('data-ctl-state');
    s.click(ctl!.querySelector('.ss-replace') ?? ctl); // a filled slot opens on Replace; an empty one on itself
    const list = pickerNames(s.host);
    s.stop();
    return { list, shown, state, picker };
  }

  it("the Builder's Living rune card: Core only offers Energy-Resistant, not Assisting (Treasure Vault); the book on offers it; a rune with no twin always stays", () => {
    const c = db();
    expect(c.items['assisting']?.source?.book).toBe(TV);
    const core = livingRuneCard(livingRune());
    expect(has(core.list, 'Energy-Resistant')).toBe(true);
    expect(has(core.list, 'Assisting')).toBe(false);
    expect(core.picker.runes['assisting']).toBeUndefined();
    expect(has(livingRuneCard(livingRune({ enabledSources: books(TV) })).list, 'Assisting')).toBe(true);
    // every fundamental rune's twin is GM Core, so a Core-only character keeps them all
    const fundamental = Object.values(c.runes).filter((r) => r.kind !== 'property');
    expect(fundamental).toHaveLength(18);
    for (const r of fundamental) expect(core.picker.runes[r.id], r.id).toBeTruthy();
    // a rune with no item twin has no book anywhere, so it is never filtered
    const bare = { id: 'test-bare-rune', name: 'Test Bare Rune', slot: 'armor', kind: 'property' } as unknown as ContentDatabase['runes'][string];
    const withBare = { ...c, runes: { ...c.runes, [bare.id]: bare } } as ContentDatabase;
    expect(withBare.items[bare.id]).toBeUndefined();
    expect(applySources(withBare, enabledBookSet(undefined), new Set()).runes[bare.id]).toBeTruthy();
  });

  it('the Living rune card keeps a chosen Assisting with its book off (name and all), and the Sources card never lists it', () => {
    const c = db();
    const held = livingRune({ bodyRune: 'assisting' });
    const kept = livingRuneCard(held);
    expect(kept.state).toBe('picked');
    expect(kept.shown).toBe('Assisting');
    expect(has(kept.list, 'Assisting')).toBe(true);
    expect(chosenFromBooks({ ...held, enabledSources: books(TV) }, c, new Set([TV])).map((x) => x.id)).not.toContain('assisting');
  });

  /** The alchemist's Advanced Alchemy picker (the Main tab's and the Daily preparations dialog's), searched. */
  function alchemyNames(enabledSources: string[] | undefined, search: string, known: string[] = []): string[] {
    const c = db();
    const c0 = build('alchemist', 5) as Character;
    expect(c0.inventory.some((i) => i.itemId === FORMULA_BOOK_ITEM_ID), 'the alchemist carries a formula book').toBe(true);
    const ch = { ...c0, enabledSources, inventory: c0.inventory.map((i) => (i.itemId === FORMULA_BOOK_ITEM_ID ? { ...i, formulas: known } : i)) } as Character;
    const s = renderDom(<AlchemyPicker character={ch} content={c} mode="advanced" prep={{}} budget={9} spent={false} onPick={noop} onClose={noop} />);
    typeInto(s.host.querySelector<HTMLInputElement>('.alchemy-picker input.hb-input'), search);
    const out = pickerNames(s.host);
    s.stop();
    return out;
  }

  it("Advanced Alchemy: Core only offers Alchemist's Fire, not Sticky Algae Bomb (Rage of Elements); the book on offers it; a known formula stays", () => {
    expect(db().items['sticky-algae-bomb']?.source?.book).toBe(ROE);
    expect(has(alchemyNames(undefined, 'fire'), "Alchemist's Fire")).toBe(true);
    expect(has(alchemyNames(undefined, 'algae'), 'Sticky Algae Bomb')).toBe(false);
    expect(has(alchemyNames(books(ROE), 'algae'), 'Sticky Algae Bomb')).toBe(true);
    expect(has(alchemyNames(undefined, 'algae', ['sticky-algae-bomb']), 'Sticky Algae Bomb')).toBe(true);
  });

  /** A generic 1st-rank scroll's "Stored spell" picker on the sheet's item popup, searched. */
  function storedSpellNames(enabledSources: string[] | undefined, search: string, heldSpell?: string): string[] {
    const c = db();
    const ch = { ...build('wizard', 5), enabledSources } as Character;
    const inv = { instanceId: 's1', itemId: 'scroll-of-1st-rank-spell', quantity: 1, ...(heldSpell ? { heldSpell } : {}) } as InventoryItem;
    const s = renderDom(<ItemDetail inv={inv} item={c.items['scroll-of-1st-rank-spell']} content={c} inventory={[inv]} feats={ch.feats} character={ch} charLevel={5} onPlay={noop} onClose={noop} />);
    const row = [...s.host.querySelectorAll('.sd-uses')].find((e) => (e.querySelector('.sd-uses-title')?.textContent ?? '') === 'Stored spell');
    s.click(row?.querySelector('button') ?? null);
    typeInto(s.host.querySelector<HTMLInputElement>('.picker-overlay .fsel-results-search input'), search);
    const out = pickerNames(s.host);
    s.stop();
    return out;
  }

  it('a scroll\'s stored-spell picker: Core only offers Fleet Step, not Thicket of Knives (Impossible Magic); the book on offers it; the stored spell stays', () => {
    const c = db();
    expect(c.items['scroll-of-1st-rank-spell']?.spellSlot?.rank).toBe(1);
    expect(c.spells[THICKET_OF_KNIVES]?.source?.book).toBe(IM);
    expect(has(storedSpellNames(undefined, 'fleet'), 'Fleet Step')).toBe(true);
    expect(has(storedSpellNames(undefined, 'thicket'), 'Thicket of Knives')).toBe(false);
    expect(has(storedSpellNames(books(IM), 'thicket'), 'Thicket of Knives')).toBe(true);
    expect(has(storedSpellNames(undefined, 'thicket', THICKET_OF_KNIVES), 'Thicket of Knives')).toBe(true);
  });

  /** A summoner with Magical Understudy (Impossible Magic) and an Angel eidolon (divine): the cantrip select. */
  function eidolonCantrips(enabledSources: string[] | undefined, cantrips?: (string | null)[]): string[] {
    const c = db();
    const c0 = build('summoner', 6) as Character;
    const eid: CompanionConfig = { id: 'e1', kind: 'eidolon', name: '', typeId: 'angel-eidolon', ...(cantrips ? { eidolon: { cantrips } } : {}) } as CompanionConfig;
    const ch = { ...c0, enabledSources, feats: [...c0.feats, { featId: 'magical-understudy', level: 2, slot: 'x:0' }], companions: [eid] } as Character;
    const s = editCompanion(c, ch);
    const out = optionNames(s.host, 'Eidolon cantrip 1');
    s.stop();
    return out;
  }

  it('the Magical Understudy eidolon cantrips: Core only offer Divine Lance, not Inside Ropes (#181); the book on offers it; a chosen one stays; the feat\'s own book stays', () => {
    const c = db();
    expect(c.feats['magical-understudy']?.source?.book).toBe(IM);
    expect(c.spells['inside-ropes']?.source?.book).toBe(Z181);
    expect(c.spells['read-the-air']?.source?.book).toBe(IM);
    const core = eidolonCantrips(undefined);
    expect(core).toContain('Divine Lance');
    expect(core).not.toContain('Inside Ropes');
    expect(core).toContain('Read the Air'); // printed in the granting feat's own book, which the character holds
    expect(eidolonCantrips(books(Z181))).toContain('Inside Ropes');
    expect(eidolonCantrips(undefined, ['inside-ropes', null])).toContain('Inside Ropes');
  });

  /** The item editor's "Start from an existing item…" list: its size, and what a search for `search` offers. */
  function baseItems(character: Character | undefined, search: string): { count: number; list: string[] } {
    const c = db();
    const s = renderDom(<ItemEditorModal mode="create" content={c} character={character} onSave={noop} onClose={noop} />);
    const ctl = s.host.querySelector('[data-ctl-title="Base item"]');
    const count = Number(ctl?.getAttribute('data-ctl-options'));
    s.click(ctl);
    typeInto(s.host.querySelector<HTMLInputElement>('.picker-overlay input.name-input'), search);
    const list = pickerNames(s.host);
    s.stop();
    return { count, list };
  }

  it('the item editor\'s "Start from an existing item…": Core only offers Spellguard Shield, not Octopus Potion; the book on, or carrying one, offers it; the Homebrew page (no character) offers every book', () => {
    const fighter = (enabledSources?: string[]) => ({ ...build('fighter', 5), enabledSources }) as Character;
    const core = baseItems(fighter(), 'octopus');
    expect(core.list.some((n) => n.startsWith('Octopus Potion'))).toBe(false);
    expect(baseItems(fighter(), 'spellguard').list.some((n) => n.startsWith('Spellguard Shield'))).toBe(true);
    const on = baseItems(fighter(books(ROE)), 'octopus');
    expect(on.list.some((n) => n.startsWith('Octopus Potion'))).toBe(true);
    const carrier = { ...fighter(), inventory: [...fighter().inventory, { instanceId: 'p1', itemId: 'octopus-potion', quantity: 1 }] } as Character;
    expect(baseItems(carrier, 'octopus').list.some((n) => n.startsWith('Octopus Potion'))).toBe(true);
    const page = baseItems(undefined, 'octopus');
    expect(page.list.some((n) => n.startsWith('Octopus Potion'))).toBe(true);
    expect(core.count).toBeLessThan(on.count);
    expect(on.count).toBeLessThan(page.count);
  });

  /** The bound-spell list of a homebrew scroll opened from a character's sheet. */
  function boundSpell(enabledSources: string[] | undefined, spellId: string) {
    const c = db();
    const scroll = { id: 'hb-test-scroll', name: 'Test Scroll', itemType: 'consumable', consumableType: 'scroll', level: 1, traits: [], spell: { spellId, rank: 1 } } as unknown as Item;
    const ch = { ...build('wizard', 5), enabledSources } as Character;
    const s = renderDom(<ItemEditorModal mode="edit" item={scroll} content={c} character={ch} onSave={noop} onClose={noop} />);
    const ctl = s.host.querySelector('[data-ctl-title="Spell"]');
    const out = { count: Number(ctl?.getAttribute('data-ctl-options')), state: ctl?.getAttribute('data-ctl-state') };
    s.stop();
    return out;
  }

  it("the item editor's bound spell: Core only leaves Thicket of Knives out unless it is the bound one; Impossible Magic on offers it", () => {
    const fleet = boundSpell(undefined, 'fleet-step');
    const heldThicket = boundSpell(undefined, THICKET_OF_KNIVES);
    const imOn = boundSpell(books(IM), 'fleet-step');
    expect(fleet.state).toBe('picked');
    expect(heldThicket.state).toBe('picked'); // the bound spell is kept in its own list
    expect(heldThicket.count).toBe(fleet.count + 1);
    expect(imOn.count).toBeGreaterThan(heldThicket.count);
  });
});

/*
 * THE CLOSING ROUND'S SECOND FIX (same day): the Spells tab's pickers, the Builder's Formula book and Snare formulas
 * cards, and a rune etched on held gear. The render (applyPlayState) keeps asking the book-blind spellOptions, so a
 * held spell is drawn whatever its book; only what may be ADDED follows the books.
 */
describe('sources-apply-to-everything: the Spells tab, the Builder formula cards and etched runes follow the books', () => {
  const PF158 = 'Pathfinder #158: Sixty Feet Under';
  const PF154 = 'Pathfinder #154: Siege of the Dinosaurs';
  const PF175 = 'Pathfinder #175: Broken Tusk Moon';
  const GMG = 'Pathfinder Gamemastery Guide';
  const RAY = 'admonishing-ray'; // #158, divine and arcane, rank 1
  const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
  const pickNames = (host: HTMLElement) => [...host.querySelectorAll('.pick-row .picker-name')].map((e) => (e.textContent ?? '').trim());
  const clericEntry = (ch: Character) => ch.spellcasting!.find((e) => e.id === 'cleric-casting')!;
  const lowestRank = (ch: Character) => Math.min(...Object.keys(clericEntry(ch).prepared ?? {}).map(Number).filter((r) => r > 0));

  /** Manage spells → a prepared slot of `rank` → the picker, searched. */
  function preparePicker(ch: Character, rank: number, search: string): string[] {
    const s = renderDom(<SpellsTab character={ch} content={db()} onPlay={noop} />);
    s.click([...s.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')].find((b) => b.title === 'Manage spells for this session') ?? null);
    const box = [...s.host.querySelectorAll('.ms-rank')].find((r) => (r.querySelector('.ms-rank-hdr')?.textContent ?? '').trim() === `${ordinal(rank)} rank`);
    expect(box, `the ${ordinal(rank)}-rank slots are there`).toBeTruthy();
    s.click(box!.querySelector('button.ms-slot'));
    typeInto(s.host.querySelector<HTMLInputElement>('.fsel-results-search input'), search);
    const out = pickNames(s.host);
    s.stop();
    return out;
  }

  /** Learn a spell → its picker, searched (the spells and the Rituals group both answer the search). */
  function learnPicker(ch: Character, search: string): string[] {
    const s = renderDom(<SpellsTab character={ch} content={db()} onPlay={noop} />);
    const byText = (sel: string, text: string) => [...s.host.querySelectorAll(sel)].find((n) => (n.textContent ?? '').trim() === text) ?? null;
    s.click(byText('button.ms-btn', 'Learn a spell'));
    s.click(byText('button.ms-add', 'Learn a spell'));
    typeInto(s.host.querySelector<HTMLInputElement>('.fsel-results-search input'), search);
    const out = pickNames(s.host);
    s.stop();
    return out;
  }

  it('fixtures', () => {
    const c = db();
    expect(c.spells[RAY]?.source?.book).toBe(PF158);
    expect(c.spells['bless']?.source?.book).toBe('Pathfinder Player Core');
    expect(c.spells['statuette']?.ritual && c.spells['statuette']?.source?.book).toBe(PF154);
    expect(c.spells['animate-object']?.ritual && c.spells['animate-object']?.source?.book).toBe('Pathfinder Player Core');
    expect(c.items['alcohol']?.source?.book).toBe(GMG);
    expect(c.items['battering-snare']?.source?.book).toBe(PF175);
    expect(c.items['sinister-knight']?.source?.book).toBe('Pathfinder Lost Omens Character Guide');
    expect(clericEntry(build('cleric', 5)).tradition).toBe('divine');
  });

  it('the Prepare picker: Core only offers Bless, not Admonishing Ray (#158); the book on offers it; a prepared Admonishing Ray stays offered and drawn', () => {
    const c = db();
    const ch = build('cleric', 5) as Character;
    const rank = lowestRank(ch);
    expect(preparePicker(ch, rank, 'bless')).toContain('Bless');
    expect(preparePicker(ch, rank, 'admonishing')).not.toContain('Admonishing Ray');
    expect(preparePicker({ ...ch, enabledSources: books(PF158) } as Character, rank, 'admonishing')).toContain('Admonishing Ray');
    // held: prepared in the slot today, with #158 off — the render still draws it and the picker keeps it
    const shown = applyPlayState(ch, setPreparedSpell(initialPlay(ch, c), 'cleric-casting', rank, 0, RAY), c);
    expect(clericEntry(shown).prepared?.[rank]?.[0]?.spellId, 'the render never prunes it').toBe(RAY);
    expect(preparePicker(shown, rank, 'admonishing')).toContain('Admonishing Ray');
  });

  it('pickerSpellOptions: the book test, what the entry holds or a record names, a restricted slot\'s own list — and the render stays book-blind', () => {
    const c = db();
    const core = enabledBookSet(undefined);
    const ch = build('cleric', 5) as Character;
    const entry = clericEntry(ch);
    const ctx = { character: ch, entry, content: c };
    const ids = (xs: { id: string }[]) => xs.map((s) => s.id);
    expect(ids(spellOptions(ctx, 1))).toContain(RAY); // the render's list reads no book
    expect(offersSpell(ctx, 1, RAY)).toBe(true);
    const picker = pickerSpellOptions(ctx, 1, undefined, core);
    expect(ids(picker)).not.toContain(RAY);
    expect(ids(picker)).toContain('bless');
    expect(picker.every((s) => entrySourceOn(core, s))).toBe(true);
    expect(ids(pickerSpellOptions(ctx, 1, undefined, enabledBookSet(books(PF158))))).toContain(RAY);
    // a spell a feat adds to the list by name (Fey Caller's shape) stays
    const named = { ...ch, spellListAdditions: { '*': [RAY] } } as Character;
    expect(ids(pickerSpellOptions({ ...ctx, character: named }, 1, undefined, core))).toContain(RAY);
    // a repertoire spell stays (spontaneous shape: held in `repertoire`)
    const held = { ...entry, repertoire: { 1: [RAY] } };
    expect(ids(pickerSpellOptions({ ...ctx, entry: held }, 1, undefined, core))).toContain(RAY);
    // a restricted slot's allowed list is the granting record's own, never narrowed
    const rs = { id: 'test-rs', label: 'Test', rank: 1, allowed: [RAY, 'bless'], spellId: null, expended: false };
    const restricted = { ...entry, restrictedSlots: [rs] };
    expect(ids(pickerSpellOptions({ ...ctx, entry: restricted }, 1, 'test-rs', core)).sort()).toEqual([RAY, 'bless']);
  });

  /*
   * THE CLOSING ROUND'S THIRD FIX: Master Summoner (Impossible Magic). Its two slots may hold "only summoning or
   * incarnate spells", which resolveRestrictedSlots answers with a TRAIT search of the whole database — not the
   * record's own list — so those ids (`allowedByTrait`) follow the books while a named list stays whole. Fixture:
   * Pest Swarm, a rank-4 arcane incarnate spell printed in Battlecry! only; Summon Animal is Player Core.
   */
  const IM = 'Pathfinder Impossible Magic';
  const BATTLECRY = 'Pathfinder Battlecry!';
  const PEST = 'pest-swarm';
  const summoner = (...extra: string[]) => {
    const c = db();
    const ch0 = build('summoner', 10, { subclassId: 'beast', featPicks: { '6:class:0': 'master-summoner' } });
    const ch = { ...ch0, enabledSources: books(IM, ...extra) } as Character;
    const live = applyPlayState(ch, initialPlay(ch, c), c);
    const entry = live.spellcasting!.find((e) => e.type === 'spontaneous')!;
    const slots = (entry.restrictedSlots ?? []).filter((s) => s.label === 'Summoning slots');
    return { ch, live, entry, slots, ctx: { character: live, entry, content: c } };
  };

  it("Master Summoner's slots: a trait search's spells follow the books — Core + Impossible Magic drops Pest Swarm (Battlecry!), the book on offers it, a held Pest Swarm stays; the render stays book-blind", () => {
    const c = db();
    expect(c.feats['master-summoner']?.source?.book).toBe(IM);
    expect(c.spells[PEST]?.source?.book).toBe(BATTLECRY);
    expect(c.spells[PEST]?.traits).toContain('incarnate');
    const { entry, slots, ctx } = summoner();
    expect(entry.tradition).toBe('arcane');
    expect(c.spells[PEST]?.traditions).toContain('arcane');
    expect(slots).toHaveLength(2);
    const slot = slots[0];
    expect(slot.allowed).toContain(PEST);
    expect(slot.allowedByTrait, 'every id came from the trait search').toEqual(slot.allowed);
    const ids = (xs: { id: string }[]) => xs.map((s) => s.id);
    const on = enabledBookSet(books(IM));
    expect(ids(spellOptions(ctx, slot.rank, slot.id))).toContain(PEST); // the render's list reads no book
    const picker = pickerSpellOptions(ctx, slot.rank, slot.id, on);
    expect(ids(picker)).toContain('summon-animal');
    expect(ids(picker)).not.toContain(PEST);
    expect(picker.every((s) => entrySourceOn(on, s))).toBe(true);
    expect(restrictedAllowedOnBooks(ctx, slot, on)).not.toContain(PEST);
    expect(ids(pickerSpellOptions(ctx, slot.rank, slot.id, enabledBookSet(books(IM, BATTLECRY))))).toContain(PEST);
    // held: a Pest Swarm already in the slot stays offered
    const heldEntry = { ...entry, restrictedSlots: (entry.restrictedSlots ?? []).map((s) => (s.id === slot.id ? { ...s, spellId: PEST } : s)) };
    expect(ids(pickerSpellOptions({ ...ctx, entry: heldEntry }, slot.rank, slot.id, on))).toContain(PEST);
  });

  it("a restricted slot's own named ids stay whole while its trait-found ids follow the books", () => {
    const c = db();
    const core = enabledBookSet(undefined);
    const ch = build('cleric', 5) as Character;
    const entry = clericEntry(ch);
    const ctx = { character: ch, entry, content: c };
    const ids = (xs: { id: string }[]) => xs.map((s) => s.id).sort();
    const rs = (allowedByTrait: string[]) => ({ id: 'test-rs', label: 'Test', rank: 1, allowed: [RAY, 'bless'], allowedByTrait, spellId: null, expended: false });
    expect(ids(pickerSpellOptions({ ...ctx, entry: { ...entry, restrictedSlots: [rs([RAY])] } }, 1, 'test-rs', core))).toEqual(['bless']);
    expect(ids(pickerSpellOptions({ ...ctx, entry: { ...entry, restrictedSlots: [rs(['bless'])] } }, 1, 'test-rs', core))).toEqual([RAY, 'bless']);
  });

  it("the Spells tab's Master Summoner card names only spells the picker would offer (Core + Impossible Magic); with their books on, it names the trait search's first three again", () => {
    const c = db();
    const cardNames = (ch: Character) => {
      const s = renderDom(<SpellsTab character={ch} content={c} onPlay={noop} />);
      const cards = [...s.host.querySelectorAll('.spell-card')].filter((el) => (el.querySelector('.spell-meta-text')?.textContent ?? '').includes('summoning slots'));
      const names = cards.map((el) => (el.querySelector('.spell-name')?.textContent ?? '').trim());
      s.stop();
      return names;
    };
    const { live } = summoner();
    const shown = cardNames(live);
    expect(shown.length, 'both summoning cards render').toBe(2);
    const on = enabledBookSet(books(IM));
    const byName = new Map(Object.values(c.spells).map((sp) => [sp.name, sp]));
    for (const card of shown)
      for (const n of card.split(' / ')) {
        expect(byName.get(n), `${n} is a spell`).toBeTruthy();
        expect(entrySourceOn(on, byName.get(n)!), `${n} is on the character's books`).toBe(true);
      }
    // the same slots with the books of the trait search's first three spells switched on name those three again
    const { live: wide } = summoner('Pathfinder Lost Omens Impossible Lands', 'Pathfinder Rage of Elements', 'Pathfinder Wake the Dead #3');
    expect(cardNames(wide)[0]).toBe('Summon Ancient Fleshforged / Summon Elemental Herald / Call Fluxwraith');
  });

  it('Learn a spell: Core only offers Force Barrage, not Admonishing Ray (#158); the book on offers it', () => {
    const wiz = build('wizard', 5) as Character;
    expect(learnPicker(wiz, 'force barrage')).toContain('Force Barrage');
    expect(learnPicker(wiz, 'admonishing')).not.toContain('Admonishing Ray');
    expect(learnPicker({ ...wiz, enabledSources: books(PF158) } as Character, 'admonishing')).toContain('Admonishing Ray');
  });

  it('Learn a spell\'s Rituals group: Core only offers Animate Object, not Statuette (#154); the book on offers it', () => {
    const wiz = build('wizard', 5) as Character;
    expect(learnPicker(wiz, 'animate object')).toContain('Animate Object');
    expect(learnPicker(wiz, 'statuette')).not.toContain('Statuette');
    expect(learnPicker({ ...wiz, enabledSources: books(PF154) } as Character, 'statuette')).toContain('Statuette');
  });

  /** The Builder's Formula book card for a level-5 alchemist: the first slot's control, and a search of its list. */
  function formulaCard(over: Partial<BuildState>, search: string) {
    const c = db();
    const ch = build('alchemist', 5) as Character;
    const b = { ...emptyBuild(), classId: 'alchemist', level: 5, ...over } as BuildState;
    const s = renderDom(<FormulaBookCard build={b} actions={{ patch: noop } as unknown as BuilderActions} content={c} character={ch} />);
    const ctl = s.host.querySelector('[data-ctl-title="Common 1st-level alchemical item"]');
    expect(ctl, 'the Alchemical Crafting slot is there').toBeTruthy();
    const count = Number(ctl!.getAttribute('data-ctl-options'));
    const state = ctl!.getAttribute('data-ctl-state');
    s.click(ctl!.querySelector('.ss-replace') ?? ctl);
    typeInto(s.host.querySelector<HTMLInputElement>('.picker-overlay input.name-input'), search);
    const list = [...s.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.textContent ?? '').trim());
    s.stop();
    return { count, state, list };
  }

  it("the Builder's Formula book card: Core only offers Alchemist's Fire, not Alcohol (Gamemastery Guide); the book on offers it; a written Alcohol stays", () => {
    const core = formulaCard({}, 'alchemist');
    expect(core.list.some((n) => n.startsWith("Alchemist's Fire"))).toBe(true);
    expect(formulaCard({}, 'alcohol').list.some((n) => n.startsWith('Alcohol'))).toBe(false);
    const on = formulaCard({ enabledSources: books(GMG) }, 'alcohol');
    expect(on.list.some((n) => n.startsWith('Alcohol'))).toBe(true);
    expect(on.count).toBeGreaterThan(core.count);
    const slotKey = formulaSlots(build('alchemist', 5) as Character, db())[0].key;
    const held = formulaCard({ formulaPicks: { [slotKey]: 'alcohol' } }, 'alcohol');
    expect(held.state).toBe('picked');
    expect(held.count).toBe(core.count + 1);
  });

  /** The Builder's Snare formulas card: the first (base: common, 1st level) slot. */
  function snareCard(over: Partial<BuildState>) {
    const c = db();
    const ch = build('fighter', 5) as Character;
    const b = { ...emptyBuild(), classId: 'fighter', level: 5, ...over } as BuildState;
    const s = renderDom(<SnareFormulasCard build={b} actions={{ patch: noop } as unknown as BuilderActions} content={c} character={ch} />);
    const ctl = s.host.querySelector('[data-ctl-title="Snare formula"]');
    expect(ctl, 'the first snare slot is there').toBeTruthy();
    const count = Number(ctl!.getAttribute('data-ctl-options'));
    const state = ctl!.getAttribute('data-ctl-state');
    s.click(ctl!.querySelector('.ss-replace') ?? ctl);
    const list = [...s.host.querySelectorAll('.picker-overlay .picker-name')].map((e) => (e.textContent ?? '').trim());
    s.stop();
    return { count, state, list };
  }

  it("the Builder's Snare formulas card: Core only offers Alarm Snare, not Battering Snare (#175); the book on offers it; a chosen Battering Snare stays", () => {
    const core = snareCard({});
    expect(core.list.some((n) => n.startsWith('Alarm Snare'))).toBe(true);
    expect(core.list.some((n) => n.startsWith('Battering Snare'))).toBe(false);
    const on = snareCard({ enabledSources: books(PF175) });
    expect(on.list.some((n) => n.startsWith('Battering Snare'))).toBe(true);
    const held = snareCard({ extraChoices: { 'snare-formulas': ['battering-snare'] } });
    expect(held.state).toBe('picked');
    expect(held.count).toBe(core.count + 1);
    expect(held.list.some((n) => n.startsWith('Battering Snare'))).toBe(true);
  });

  it('a property rune etched on held gear is kept in the Builder\'s content, so the Builder\'s numbers match the sheet\'s; the Sources card never lists it', () => {
    const c = db();
    const b = {
      ...emptyBuild(),
      name: 't',
      level: 5,
      classId: 'fighter',
      ancestryId: Object.keys(c.ancestries)[0],
      backgroundId: Object.keys(c.backgrounds)[0],
      keyAbility: 'str',
      inventory: [
        { instanceId: 'a1', itemId: 'leather-armor', quantity: 1, worn: true, equipped: true, runes: { potency: 1, property: ['sinister-knight'] } },
        { instanceId: 'w1', itemId: 'longsword', quantity: 1, runes: { potency: 1, property: ['assisting'] } },
      ],
    } as unknown as BuildState;
    const core = enabledBookSet(undefined);
    const picker = applySources(c, core, collectChosenIds(b, c));
    expect(picker.runes['sinister-knight']).toBeTruthy();
    expect(picker.runes['assisting']).toBeTruthy();
    // an unheld off-book rune still leaves (the runes pass itself is untouched)
    expect(picker.runes['authorized']).toBeUndefined();
    const ch = buildCharacter(b, c);
    const bare = buildCharacter({ ...b, inventory: b.inventory.map((i) => ({ ...i, runes: { potency: 1, property: [] } })) } as BuildState, c);
    const sheet = deriveSkill(ch, 'deception', c).modifier;
    expect(sheet, 'fixture: the etched rune moves Deception on the sheet').toBeGreaterThan(deriveSkill(bare, 'deception', c).modifier);
    expect(deriveSkill(ch, 'deception', picker).modifier, "the Builder's stats read the same number").toBe(sheet);
    const off = chosenFromBooks({ ...b, enabledSources: books('Pathfinder Lost Omens Character Guide') }, c, new Set(['Pathfinder Lost Omens Character Guide']));
    expect(off.map((x) => x.id)).not.toContain('sinister-knight');
  });
});
