// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { DEDUPE_MAPS, REMASTER_REPRINT_IDS, listValues, shopItems } from '../src/data';
import { trustPartly, trustUnencoded } from '../src/data/trustGate';
import { hostSearchRecords } from '../src/integration/hostSearchRecords';
import { deriveStrike } from '../src/rules/derive';
import { itemCounters } from '../src/rules/itemUses';
import { CORE_BOOKS, storedSources } from '../src/rules/sources';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { reprintTwinGaps } from '../scripts/lib/reprint-twin-gaps.mjs';
import { loadTwinPipAllow, printedPips, twinPipGaps } from '../scripts/lib/twin-pips.mjs';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/*
 * desk #158 meets the duplicate rules (src/data/index.ts findHiddenTwins). The Impossible Magic grades the
 * duplicate rules hide behind their modelled Secrets of Magic half are exactly the reprints that half's
 * "Remastered as" names — so while the legacy half is offered the reprint stays hidden, and when "Hide
 * legacy data" (or its book) takes the legacy half away, the reprint is offered instead of nothing.
 */
describe('a hidden reprint twin stands in when its legacy record is filtered out', () => {
  const db = content();
  const ids = (list: { id: string }[]) => new Set(list.map((x) => x.id));

  it('every "Remastered as" that names a record the duplicate rules hide is a registered twin of that record', () => {
    const missing: string[] = [];
    const deduped = new Set<string>(DEDUPE_MAPS);
    for (const [bucket, recs] of Object.entries(db as unknown as Record<string, Record<string, { remasteredAs?: { bucket: string; id: string } }>>)) {
      if (!recs || typeof recs !== 'object' || recs instanceof Set || recs instanceof Map) continue;
      for (const [id, r] of Object.entries(recs)) {
        const ra = r?.remasteredAs;
        if (!ra || !deduped.has(ra.bucket) || !db.duplicateIds?.has(ra.id)) continue;
        const t = db.hiddenTwins?.get(ra.id);
        if (!t || t.bucket !== ra.bucket || t.standIn !== id) missing.push(`${bucket}/${id} -> ${ra.id}`);
      }
    }
    expect(missing).toEqual([]);
    expect(db.hiddenTwins?.size ?? 0).toBeGreaterThan(0);
  });

  it('Major Healer\'s Gel stays hidden while Healer\'s Gel (Greater) is offered, and is offered once it is not', () => {
    expect(db.items['healers-gel-greater']?.remasteredAs?.id).toBe('major-healers-gel');
    expect(ids(listValues(db, db.items)).has('major-healers-gel')).toBe(false);
    const { ['healers-gel-greater']: _gone, ...rest } = db.items;
    const view = { ...db, items: rest } as ContentDatabase;
    const shown = ids(listValues(view, view.items));
    expect(shown.has('major-healers-gel')).toBe(true);
    // a duplicate with no stand-in relation stays hidden whatever else is filtered
    const other = [...(db.duplicateIds ?? [])].find((id) => db.items[id] && !db.hiddenTwins?.has(id));
    if (other) expect(shown.has(other)).toBe(false);
  });

  /* Measured on the shop's own list. The view once lacked the umbrella and combination-form sets, so a
   * family summary nobody is offered (items/healers-gel) counted as buyable here. */
  it('under "Hide legacy data" every twin is offered, and a link the shop never offers is one the baseline lists', () => {
    expect(db.umbrellaIds?.size ?? 0).toBeGreaterThan(0);
    expect(db.combinationFormIds?.size ?? 0).toBeGreaterThan(0);
    const shown = ids(shopItems(db, true));
    expect([...(db.hiddenTwins?.keys() ?? [])].filter((id) => !shown.has(id))).toEqual([]);
    const never: string[] = [];
    for (const [id, it] of Object.entries(db.items)) {
      const ra = it.remasteredAs;
      const ed = (it as { edition?: string }).edition;
      if (ra?.bucket === 'items' && (ed === 'legacy' || ed === 'legacy-era') && !shown.has(ra.id)) never.push(`items/${id}`);
    }
    const baseline = JSON.parse(readFileSync('scripts/data/never-offered-links-baseline.json', 'utf8')) as Record<string, unknown>;
    expect(never.filter((k) => !(k in baseline))).toEqual([]);
  });

  it('the GM search lists the reprint the popup names — an item, and a bonus line sharing a hidden item\'s id', () => {
    const rows = hostSearchRecords(db);
    expect(rows.some((r) => r.bucket === 'items' && r.id === 'major-healers-gel')).toBe(true);
    // duplicateIds is a flat set of ITEM (etc.) ids; it must not drop the bonus line of the same id
    const lines = (db as unknown as Record<string, Record<string, { remasteredAs?: { id: string } }> | undefined>).itemBonus;
    expect(lines?.['endless-grimoire-greater']?.remasteredAs?.id).toBe('greater-endless-grimoire');
    expect(rows.some((r) => r.bucket === 'itemBonus' && r.id === 'greater-endless-grimoire')).toBe(true);
  });

  /*
   * 2026-09-25: the twins arrived as their page's text alone — Greater Singing Shortbow landed as an Equipment
   * card with no Strike — and each carried the "Not yet verified — shown, not applied" marker until the
   * Impossible Magic mechanics were encoded. Package I (I7b, 2026-10-17, work/package-i/september-a.json, every
   * row read against its twin's own Archives page) encoded them: each twin findHiddenTwins offers carries its
   * legacy half's rules, copied only where its own page prints the same mechanic and written from the reprint
   * where the print changed (staff lists, spellheart spells, the Full Pack's 25 cards, the Codex's once per
   * hour). The four tests below replace "every twin says it is not applied yet" and hold that line.
   */
  const offered = () => new Set([...(db.hiddenTwins?.keys() ?? [])].map((id) => `items/${id}`));
  const legacyGaps = (d: ContentDatabase) => {
    const keys = new Set([...(d.hiddenTwins?.keys() ?? [])].map((id) => `items/${id}`));
    return (reprintTwinGaps(d) as { key: string; lost: string[] }[]).filter((r) => keys.has(r.key)).map((r) => `${r.key} lacks ${r.lost.join(', ')}`);
  };

  // package I (I7b): every i7b-* finding — the twins leave `unencoded` (test/trust-ledger.test.ts flips with this).
  it('every twin findHiddenTwins offers carries every rule field its legacy half carries, unless scripts/data/twin-gap-allow.json names it with a print reason', () => {
    expect(legacyGaps(db)).toEqual([]);
    expect(offered().size).toBeGreaterThanOrEqual(57); // the 56 of 2026-09-25 + the level-5 Healer's Gel
    // Mutation proof: the same measure on a copy with one twin's spell taken off names exactly that gap.
    const { heldSpells: _dropped, ...hollow } = db.items['greater-healers-gel'] as unknown as Record<string, unknown>;
    const planted = { ...db, items: { ...db.items, 'greater-healers-gel': hollow } } as unknown as ContentDatabase;
    expect(legacyGaps(planted)).toEqual(['items/greater-healers-gel lacks heldSpells']);
    // The allow file excuses only what the twin's own page does not print, each field with its reason: today the
    // four Usage lines the legacy halves took from Foundry (equipment-5127-4604/5/6 and equipment-5126-4602), and
    // the Hands 2 line the Greater Noxious Incense's reprint dropped (equipment-5060-4577 against equipment-1008-1031).
    const allow = JSON.parse(readFileSync('scripts/data/twin-gap-allow.json', 'utf8')) as Record<string, Record<string, string>>;
    const excused = Object.entries(allow).filter(([k]) => k !== '_').flatMap(([k, v]) => Object.entries(v).map(([f, why]) => `${k}.${f}${/equipment-\d+-\d+/.test(why) ? '' : ' (no page cited)'}`));
    expect(excused.sort()).toEqual([
      'items/greater-codex-of-unimpeded-sight.usage', 'items/greater-endless-grimoire.usage',
      'items/greater-noxious-incense.hands', 'items/major-endless-grimoire.usage', 'items/true-endless-grimoire.usage',
    ]);
  });

  /*
   * The legacy half is not the only evidence: the twin's OWN Archives page is the authority (gold-set R12), and
   * a field it prints that neither half carries is still missing. Read from the mirror, field by field — a
   * Usage line, an Activate glyph, a Frequency line, a Base Weapon line / bomb / staff (a Strike), the
   * consumable trait (uses), a catalyst / talisman / potion / fulu trait, a spell it casts, a spellheart's
   * Armor / Weapon choice. PRINTED_NOT_MODELLED names what the page prints that the app models on neither
   * printing, with the reason; it is for the Future correctness pass, never a place to park a twin's gap.
   */
  const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
  const PRINTED_NOT_MODELLED: Record<string, Record<string, string>> = {
    'items/greater-blade-of-four-energies': {
      heldSpells: 'equipment-5013-4552 Release Energy casts acid grip / fireball / howling blizzard / lightning bolt by the active rune; the legacy half carries no spells either (Future correctness pass)',
    },
    'items/greater-potion-of-stable-form': {
      activationCost: 'equipment-5100-4590 prints Activate {Single Action} (manipulate), and the legacy equipment-1029-988 {Single Action} Interact, but neither record carries it — the importer misses the stat-block Activate row (package I item I7a; Future correctness pass)',
    },
  };
  const pageOf = (aonId: string): Record<string, unknown> | null => {
    const f = join(MIRROR, aonId.replace(/-\d.*$/, ''), `${aonId}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>) : null;
  };
  const printedFields = (doc: Record<string, unknown>): string[] => {
    const md = String(doc.markdown ?? '');
    const marks = [...md.matchAll(/<title\s+level="2"[^>]*>([\s\S]*?)<\/title>/g)];
    const head = marks.length ? md.slice(0, marks[0].index) : md;
    const norm = (s: string) => s.toLowerCase().replace(/<[^>]+>|\]\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const ownAt = marks.findIndex((m) => norm(m[1]) === norm(String(doc.name ?? '')));
    const own = ownAt < 0 ? '' : md.slice(marks[ownAt].index, marks[ownAt + 1]?.index ?? md.length);
    const scope = head + own;
    const traits = ((doc.trait as string[] | undefined) ?? []).map((t) => t.toLowerCase());
    const out: string[] = [];
    if (/\*\*Usage\*\*/.test(head)) out.push('usage');
    // Inline (`**Activate—Name** <actions …>`) and the stat-block row (`<row>**Activate**</row><actions …>`); an empty
    // glyph is "Cast a Spell", whose cost is the spell's.
    if (/\*\*Activate[^*]*\*\*(?:\s*<\/row>)?\s*<actions string="[^"]+"/.test(scope)) out.push('activationCost');
    if (/\*\*Frequency\*\*/.test(scope)) out.push('frequency|counters');
    if (/\*\*Base Weapon\*\*/.test(head) || traits.includes('bomb') || traits.includes('staff')) out.push('itemType=weapon', 'damage', 'group');
    if (traits.includes('consumable') && !traits.includes('bomb')) out.push('uses');
    if (['catalyst', 'talisman', 'potion', 'fulu', 'elixir', 'oil', 'scroll'].some((t) => traits.includes(t))) out.push('consumableType');
    if (((doc.spell as string[] | undefined) ?? []).length || /You cast|<li>\*\*(Cantrip|1st)\*\*/.test(scope)) out.push('heldSpells');
    if (/\*\*•?\s*Armor\*\*[\s\S]*\*\*•?\s*Weapon\*\*/.test(head)) out.push('effectChoices');
    return out;
  };
  const carries = (rec: Record<string, unknown>, f: string): boolean => {
    if (f === 'frequency|counters') return !!rec.frequency || !!(rec.counters as unknown[] | undefined)?.length;
    if (f === 'itemType=weapon') return rec.itemType === 'weapon';
    const v = rec[f];
    return v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length);
  };
  const pageGaps = (d: ContentDatabase): string[] => {
    const out: string[] = [];
    for (const id of d.hiddenTwins?.keys() ?? []) {
      const rec = d.items[id] as unknown as Record<string, unknown> | undefined;
      const doc = rec?.aonId ? pageOf(String(rec.aonId)) : null;
      if (!rec || !doc) { out.push(`items/${id}: no Archives page for ${String(rec?.aonId)}`); continue; }
      for (const f of printedFields(doc)) if (!carries(rec, f) && !PRINTED_NOT_MODELLED[`items/${id}`]?.[f]) out.push(`items/${id}: ${String(rec.aonId)} prints ${f}`);
    }
    return out.sort();
  };

  // package I (I7b): every i7b-* finding, read against its twinPage.
  it.runIf(existsSync(MIRROR))('every twin findHiddenTwins offers carries the rule fields its own Archives page prints (mirror present)', () => {
    expect(pageGaps(db)).toEqual([]);
    // Mutation proof: a twin stripped of its Usage and Strike reads as exactly those printed fields missing.
    const { usage: _u, damage: _d, ...bare } = db.items['greater-singing-shortbow'] as unknown as Record<string, unknown>;
    const planted = { ...db, items: { ...db.items, 'greater-singing-shortbow': bare } } as unknown as ContentDatabase;
    expect(pageGaps(planted)).toEqual([
      'items/greater-singing-shortbow: equipment-5028-4557 prints damage',
      'items/greater-singing-shortbow: equipment-5028-4557 prints usage',
    ]);
    // An exception names what the page prints and the app models on neither printing — never a twin's gap.
    for (const [k, fields] of Object.entries(PRINTED_NOT_MODELLED)) {
      const id = k.slice('items/'.length);
      for (const f of Object.keys(fields)) expect(carries(db.items[id] as unknown as Record<string, unknown>, f), `${k}.${f}`).toBe(false);
    }
  });

  /*
   * package I, lane L6b (2026-10-17): the VALUE, not the field. The tests above ask whether a twin CARRIES a field;
   * they passed while five Major spellhearts tracked one use a day where their page prints two separate
   * "Frequency once per day" Cast a Spell activations (equipment-5153-4636 and its four siblings), and while two
   * Gatewalkers spellhearts showed FOUR pips (an old overlay row said {max:3} and the frequency fill added the
   * page's one more) where equipment-4030-3712 / equipment-4031-3715 print two. The measure is the pips
   * itemCounters hands out for the record a player is given (the trust gate on), summed, against the Frequency
   * lines in the twin's own block of its own page (scripts/lib/twin-pips.mjs; scripts/reprint-check.mjs CHECK 11
   * runs the same measure inside `npm run verify`).
   */
  const gatedDb = () => content({ trustGate: true });
  const countersOf = (rec: unknown) => itemCounters(rec as never, { instanceId: 'pips', itemId: (rec as { id: string }).id, quantity: 1 } as InventoryItem);
  const pipGaps = (items: Record<string, unknown>, allow?: Map<string, string>) =>
    twinPipGaps({ twins: gatedDb().hiddenTwins!.keys(), items, countersOf, ...(allow ? { allow } : {}) });
  const pipRows = (r: ReturnType<typeof pipGaps>) => r.rows.map((x: { key: string; shown: number; printed: number }) => `${x.key} shows ${x.shown}, page prints ${x.printed}`);
  const TWO_PER_DAY = ['per day 1/1', 'per day 1/1'];
  // The five Major spellhearts the Impossible Magic page gives two activations, and the legacy half each one is a reprint of.
  const SPELLHEARTS: Record<string, string> = {
    'major-flaming-star': 'flaming-star-major', 'major-five-feather-wreath': 'five-feather-wreath-major', 'major-grim-sandglass': 'grim-sandglass-major',
    'major-perfect-droplet': 'perfect-droplet-major', 'major-trinity-geode': 'trinity-geode-major',
  };

  // package I (L6b): every offered twin's pips against its own page, the exceptions named, and the measure shown to bite.
  it.runIf(existsSync(MIRROR))('every twin findHiddenTwins offers shows the use pips its own Archives page prints, with the trust gate on', () => {
    const items = gatedDb().items as unknown as Record<string, Record<string, unknown>>;
    const now = pipGaps(items);
    expect({ rows: pipRows(now), missing: now.missing, unusedAllow: now.unusedAllow }).toEqual({ rows: [], missing: [], unusedAllow: [] });
    expect(gatedDb().hiddenTwins!.size).toBeGreaterThanOrEqual(57);

    // The five spellhearts read straight: two separate once-per-day activations are two pips, in the legacy half's own shape.
    for (const [twin, legacy] of Object.entries(SPELLHEARTS)) {
      expect(countersOf(items[twin]).map((c) => `${c.label} ${c.current}/${c.max}`), twin).toEqual(TWO_PER_DAY);
      expect(items[twin].counters, `${twin} against ${legacy}`).toEqual(items[legacy].counters);
      expect(items[twin].frequency, twin).toEqual({ max: 1, per: 'day' });
    }
    // The two Gatewalkers spellhearts: the stale {max:3} row is gone, so there are two pips and no fourth.
    for (const twin of ['major-pickled-demon-tongue', 'major-polished-demon-horn']) {
      expect(items[twin].frequency, twin).toEqual({ max: 1, per: 'day' });
      expect(countersOf(items[twin]).map((c) => `${c.label} ${c.current}/${c.max}`), twin).toEqual(TWO_PER_DAY);
    }
    // …and the legacy half of the tongue carries the same two (the horn's legacy half is a Future-correctness-pass item).
    expect(items['major-pickled-demon-tongue'].counters).toEqual(items['pickled-demon-tongue-major'].counters);

    // Mutation proof 1: a spellheart back at one counter reads as exactly that gap.
    const one = { ...items['major-flaming-star'], counters: (items['major-flaming-star'].counters as unknown[]).slice(0, 1) };
    expect(pipRows(pipGaps({ ...items, 'major-flaming-star': one }))).toEqual(['items/major-flaming-star shows 1, page prints 2']);
    // Mutation proof 2: the old {max:3} shape (three pips and the fill's one) reads as four against two.
    const four = { ...items['major-polished-demon-horn'], frequency: { max: 3, per: 'day' }, counters: [
      { id: 'freq', label: 'per day', max: 3, per: 'day', resetsOnRest: true }, { id: 'freq2', label: 'per day', max: 1, per: 'day', resetsOnRest: true }] };
    expect(pipRows(pipGaps({ ...items, 'major-polished-demon-horn': four }))).toEqual(['items/major-polished-demon-horn shows 4, page prints 2']);
    // Mutation proof 3: a twin with a printed Frequency and no counter at all is caught too (a field-exists test would say "frequency: yes").
    const none = { ...items['major-grim-sandglass'] };
    delete none.counters;
    delete none.frequency;
    expect(pipRows(pipGaps({ ...items, 'major-grim-sandglass': none }))).toEqual(['items/major-grim-sandglass shows 0, page prints 2']);
    // The allow file: a reasoned entry excuses exactly its twin; one that matches its page is reported for removal.
    const planted = { ...items, 'major-flaming-star': one };
    const allowed = pipGaps(planted, new Map([['items/major-flaming-star', 'equipment-5153-4636 restates the number on purpose'], ['items/greater-flaming-star', 'equipment-5153-4635 already matches']]));
    expect(allowed.rows).toEqual([]);
    expect(allowed.excused).toEqual(['items/major-flaming-star']);
    expect(allowed.unusedAllow).toEqual(['items/greater-flaming-star']);
    // The real allow file: every entry names its print evidence (an entry with no reason is dropped by the loader and would excuse nothing).
    const file = JSON.parse(readFileSync('scripts/data/twin-pip-allow.json', 'utf8')) as Record<string, string>;
    for (const [k, why] of Object.entries(file)) if (k !== '_') expect(why, k).toMatch(/equipment-\d+/);
    expect([...loadTwinPipAllow().keys()].sort()).toEqual(Object.keys(file).filter((k) => k !== '_').sort());
  });

  // package I (L6b): the page side of the measure, on text, so a reader bug cannot hide behind the data.
  it('the printed pips are the Frequency lines of the twin\'s own block, repeats kept, and an unreadable wording is flagged', () => {
    const page = (own: string, head = '') => ({
      name: 'Major Star',
      markdown: `<title level="1">Star</title>\n${head}\n<title level="2" right="Item 3">Star</title>\n<title level="2" right="Item 12">Major Star</title>\n${own}\n`,
    });
    const act = (f: string) => `**Activate** <actions string="" /> Cast a Spell **Frequency** ${f};   **Effect** You cast fireball.`;
    // The same "once per day" printed on two activations is two pips (a family page's dedup would call it one).
    expect(printedPips(page(`${act('once per day')}\n${act('once per day')}`)).pips).toBe(2);
    // Different periods are separate activations too, and a count is its max.
    expect(printedPips(page(`${act('once per hour')}\n${act('three times per day')}`)).pips).toBe(4);
    // The base item's block (the page head) is every grade's; a SIBLING grade's block is not.
    const sibling = { name: 'Major Star', markdown: `<title level="1">Star</title>\n<title level="2">Greater Star</title>\n${act('once per day')}\n<title level="2">Major Star</title>\n${act('twice per day')}\n` };
    expect(printedPips(sibling).pips).toBe(2);
    expect(printedPips(page(act('once per day'), act('once per round'))).pips).toBe(2);
    // A wording that starts like a count and does not parse is reported, never counted as zero.
    const odd = printedPips(page(act('once per fortnight')));
    expect(odd.pips).toBe(0);
    expect(odd.unread).toEqual(['once per fortnight']);
  });

  // package I (I7b): i7b-healers-gel-base-grade — the level-5 Healer's Gel (equipment-5055-4573) is offered.
  it('the level-5 Healer\'s Gel is offered under "Hide legacy data" at 25 gp with its spell, and hidden while Healer\'s Gel (Lesser) is offered', () => {
    expect(REMASTER_REPRINT_IDS.has('healers-gel')).toBe(true);
    expect(db.hiddenTwins?.get('healers-gel')).toEqual({ bucket: 'items', standIn: 'healers-gel-lesser' });
    expect(db.umbrellaIds?.has('healers-gel')).toBe(false);
    const gel = shopItems(db, true).find((i) => i.id === 'healers-gel') as unknown as Record<string, unknown> | undefined;
    expect(gel?.price).toEqual({ gp: 25 });
    expect(gel?.level).toBe(5);
    expect(gel?.heldSpells).toEqual({ 1: ['heal'] });
    expect(gel?.uses).toEqual({ current: 1, max: 1 });
    expect(ids(listValues(db, db.items)).has('healers-gel')).toBe(false);
    const baseline = JSON.parse(readFileSync('scripts/data/never-offered-links-baseline.json', 'utf8')) as Record<string, unknown>;
    expect('items/healers-gel-lesser' in baseline).toBe(false);
    expect(Object.keys(baseline).filter((k) => k !== '_')).toHaveLength(9);
  });

  // package I (I7b): i7b-greater-codex-of-unimpeded-sight — once per hour, ONE pip. The record's text is the
  // family page, whose base grade prints "Frequency once per day"; the frequency fill (run by the chain and by
  // apply-backfill-now) must not add that per-day pip beside the grade's per-hour one.
  it('the Greater Codex of Unimpeded Sight tracks one use per hour, not a second one per day', () => {
    const codex = db.items['greater-codex-of-unimpeded-sight'];
    expect((codex as unknown as { frequency?: unknown }).frequency).toEqual({ max: 1, per: 'hour' });
    const live = itemCounters(codex, { instanceId: 'c', itemId: 'greater-codex-of-unimpeded-sight', quantity: 1 } as InventoryItem);
    expect(live.map((c) => `${c.label} ${c.current}/${c.max}`)).toEqual(['per hour 1/1']);
  });

  // package I (I7b): the twins whose Impossible Magic / Gatewalkers print CHANGED the rule follow the reprint
  // whole (gold-set R12), never the legacy half they would be copied from blind.
  it('where the reprint prints a different rule, the twin carries the reprint\'s (R12), not its legacy half\'s', () => {
    const held = (id: string) => (db.items[id] as unknown as { heldSpells?: Record<string, string[]> }).heldSpells;
    // equipment-5154-4638 "You cast 2nd-rank harm" (the legacy grade also offered heal).
    expect(held('greater-grim-sandglass')).toEqual({ 0: ['void-warp'], 2: ['harm'] });
    // equipment-5154-4639 "4th-rank harm" and "whispers of the void" (no heal, no restoration).
    expect(held('major-grim-sandglass')).toEqual({ 0: ['void-warp'], 4: ['harm', 'whispers-of-the-void'] });
    // equipment-5152-4633 "You cast fly" where the legacy grade cast air walk.
    expect(held('major-five-feather-wreath')).toEqual({ 0: ['gale-blast'], 4: ['wall-of-wind', 'fly'] });
    // equipment-5160-4656 "mountain resilience" where the legacy grade cast spike stones.
    expect(held('major-trinity-geode')).toEqual({ 0: ['scatter-scree'], 4: ['one-with-stone', 'mountain-resilience'] });
    // equipment-4031-3715 lists outcast's curse and vision of death only (no fear).
    expect(held('major-polished-demon-horn')).toEqual({ 0: ['daze'], 4: ['outcasts-curse', 'vision-of-death'] });
    // equipment-5169-4672: 1st flourishing flora + protector tree (legacy: shillelagh), 3rd protector tree (legacy: tree shape).
    expect(held('greater-staff-of-natures-cunning')?.[1]).toEqual(['flourishing-flora', 'protector-tree']);
    expect(held('greater-staff-of-natures-cunning')?.[3]).toEqual(['protector-tree', 'wall-of-thorns']);
    // equipment-5170-4675: 2nd create food + environmental endurance, 4th fire shield (legacy: air walk).
    expect(held('greater-staff-of-the-desert-winds')?.[4]).toEqual(['fire-shield']);
    // A family page shares one text: the Greater Flaming Star's own block casts plain fireball (rank 3); the
    // "4th-rank fireball" in its text is the Major's block (scripts/held-spell-rank-check.mjs reads it without).
    expect(held('greater-flaming-star')).toEqual({ 0: ['ignition'], 3: ['fireball'] });
    expect(String(db.items['greater-flaming-star'].description)).toContain('4th-rank fireball');
    // equipment-5140-4613 "This pack contains 25 cards" (the legacy Full Pack held 24).
    expect((db.items['full-pack'] as unknown as { uses?: unknown }).uses).toEqual({ current: 25, max: 25 });
  });

  it('a hide-legacy player buys the twin from an unmarked shop row, and it Strikes as its page prints', () => {
    const NOTE = 'Not yet verified';
    // The twins say nothing is missing any more; only the trust gate's OFF resistances keep a marker elsewhere.
    expect([...offered()].filter((k) => trustUnencoded('items', k.slice(6)) || trustPartly('items', k.slice(6)))).toEqual([]);

    // The shop, "Hide legacy data" on: the legacy Greater Singing Shortbow is gone and its twin is offered.
    const shop = {
      ...db,
      items: { 'singing-shortbow-greater': db.items['singing-shortbow-greater'], 'greater-singing-shortbow': db.items['greater-singing-shortbow'], longsword: db.items['longsword'] },
      services: {}, vehicles: {}, siegeWeapons: {},
    } as ContentDatabase;
    const bought: string[] = [];
    // desk shop-respects-sources (2026-09-29): both halves' books on, so the legacy half is taken away by
    // "Hide legacy data" alone, as this test means (test/shop-respects-sources.test.tsx covers the book).
    const enabledSources = storedSources([...CORE_BOOKS, 'Pathfinder Secrets of Magic', 'Pathfinder Impossible Magic']);
    const s = renderDom(createElement(AddItemsModal, { content: shop, currency: { pp: 5000 }, hideLegacy: true, enabledSources, onBuy: (id: string) => bought.push(id), onGive: () => undefined, onClose: () => undefined }));
    const rows = [...s.host.querySelectorAll('.ai-row')];
    const row = (name: string) => rows.find((e) => e.querySelector('.ai-name')?.textContent === name);
    expect(rows.map((e) => e.querySelector('.ai-name')?.textContent).sort()).toEqual(['Greater Singing Shortbow', 'Longsword']);
    expect(row('Greater Singing Shortbow')?.textContent).not.toContain(NOTE);
    expect(row('Longsword')?.textContent).not.toContain(NOTE);
    s.click(row('Greater Singing Shortbow')!.querySelector('.ai-buy button'));
    s.stop();
    expect(bought).toEqual(['greater-singing-shortbow']);

    // …the one bought is a weapon with the Strike equipment-5028-4557 prints: a +3 greater striking
    // composite shortbow (1d6 piercing base, three dice, range increment 60 feet) — not an Equipment card.
    const character = { ...build('fighter', 18), inventory: [{ instanceId: 'gss-1', itemId: bought[0], quantity: 1, equipped: true } as InventoryItem] } as Character;
    const strike = deriveStrike(character, db, character.inventory[0]);
    expect(strike).toBeTruthy();
    expect(strike!.potencyBonus).toBe(3);
    // "3d6+6 P (plus 2d10 on a crit)": three dice, piercing, and the base bow's deadly d10 at greater striking.
    expect(strike!.damage).toMatch(/^3d6\b[^ ]* P\b/);
    expect(strike!.damage).toContain('plus 2d10 on a crit');
    expect(strike!.group).toBe('bow');
    expect(strike!.range).toBe(60);
    expect(strike!.traits).toEqual(expect.arrayContaining(['deadly-d10', 'propulsive']));

    // …and its card says nothing is missing.
    const inv = renderDom(createElement(InventoryTab, { character, content: db }));
    const card = [...inv.host.querySelectorAll('.inv-card')].find((e) => (e.querySelector('.inv-name')?.textContent ?? '').includes('Greater Singing Shortbow'));
    expect(card).toBeTruthy();
    inv.click(card!);
    expect(document.body.textContent).not.toContain(NOTE);
    inv.stop();
  });
});
