import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  CLASS_WORD_IDIOMS, carrierRefusal, classWordInert, featureOwners, labelOf, linkContext, pageClasses, pageRecordRef,
  planLink, relinkVerdict,
} from '../scripts/lib/ast-link-ref.mjs';
import { buildReprintMap, newestPrinting } from '../scripts/lib/reprint.mjs';

/**
 * PACKAGE I, LANE L8 (2026-10-17): every description link opens the record that carries its page.
 *
 * The importer resolves a link's `ref` against its own id map before later chain steps mint and re-stamp the
 * records that ship, so 3,771 links opened nothing although a record carries their page (`conditions:lost`
 * while `conditions:aon-lost` ships), and 14 link pairs opened another printing (Miracle -> the Wish ritual,
 * the Dragon Disciple Dedication's "Draconic Scent" -> the Dragonblood feat). Separately our Archives
 * auto-linker sends common words to one class's feature from everywhere ("cause" x745 -> the Champion's Cause
 * from kingdom and army text). The rule is scripts/lib/ast-link-ref.mjs planLink(); scripts/relink-carried-
 * pages.mjs applies it (a step of `npm run data`), scripts/rebuild-ast-entries.mjs applies it to a page it
 * rebuilds, and scripts/ast-link-carrier-check.mjs RULE 3 (npm run verify) fails while it would change a link.
 *
 * Block 1 pins the rule on synthetic documents. Block 2 reads the shipped trees. Block 3 runs the pass and the
 * check on scratch copies of the shipped data: each defect planted back fails the check, the pass repairs it.
 * Block 4 runs rebuild-ast-entries on a scratch fixture, and a copy of it without the rule.
 */

type Doc = { id: string; category: string; name: string; level?: number; books?: string[]; release_date?: string; data?: Record<string, unknown> };
type Node = { t: string; to?: string; ref?: string | null; auto?: number; c?: Node[]; v?: string; label?: string; aon?: string };
const link = (to: string, ref: string | null, label: string, auto = false): Node => ({ t: 'link', ref, to, ...(auto ? { auto: 1 } : {}), c: [{ t: 'text', v: label }] });

describe('the relink rule, on synthetic documents', () => {
  const docs = new Map<string, Doc>();
  const add = (d: Doc) => docs.set(d.id, { books: [], release_date: '2020-01-01', data: {}, ...d });
  add({ id: 'condition-50', category: 'condition', name: 'Lost', books: ['Kingmaker Adventure Path'] });
  add({ id: 'weapon-356', category: 'weapon', name: 'Fist', level: 0, books: ['Core Rulebook'] });
  add({ id: 'spell-196', category: 'spell', name: 'Miracle', level: 10, books: ['Core Rulebook'], data: { remaster_id: ['spell-1592'] } });
  add({ id: 'spell-1592', category: 'spell', name: 'Manifestation', level: 10, books: ['Player Core'], release_date: '2023-11-01', data: { legacy_id: ['spell-196'] } });
  add({ id: 'ritual-125', category: 'ritual', name: 'Wish', level: 10, books: ['Player Core'] });
  add({ id: 'feat-1942', category: 'feat', name: 'Draconic Scent', level: 4, books: ["Advanced Player's Guide"], data: { archetype: ['Dragon Disciple'] } });
  add({ id: 'feat-5737', category: 'feat', name: 'Draconic Scent', level: 5, books: ['Player Core 2'] });
  add({ id: 'feat-6145', category: 'feat', name: 'Even the Odds', level: 4, books: ['Player Core 2'] });
  add({ id: 'feat-7675', category: 'feat', name: 'Even the Odds', level: 14, books: ['Shining Kingdoms'], data: { archetype: ['Eagle Knight'] } });
  add({ id: 'feat-884', category: 'feat', name: 'Necromantic Resistance', level: 4, books: ['World Guide'], data: { archetype: ['Lastwall Sentry'] } });
  add({ id: 'archetype-1', category: 'archetype', name: 'Undead Slayer' });
  add({ id: 'equipment-3126', category: 'equipment', name: "Martyr's Shield", level: 7, books: ['GM Core'] });
  add({ id: 'equipment-4193', category: 'equipment', name: "Martyr's Shield", level: 7, books: ['Pathfinder #222: Hellbreakers'] });
  add({ id: 'weapon-270', category: 'weapon', name: 'Chakri', level: 0, books: ['Impossible Lands'] });
  add({ id: 'creature-family-9', category: 'creature-family', name: 'Sloth' });
  add({ id: 'animal-companion-62', category: 'animal-companion', name: 'Fire Elemental' });
  add({ id: 'equipment-127', category: 'equipment', name: 'Shadow Essence', level: 10, books: ['Core Rulebook'] });
  add({ id: 'rules-2040', category: 'rules', name: 'Perception', books: ['Player Core'] });
  add({ id: 'equipment-244-244', category: 'equipment', name: 'Feather Token (Chest)', level: 3, books: ['Core Rulebook'], data: { remaster_id: ['equipment-3002-2862'] } });
  add({ id: 'equipment-3002-2862', category: 'equipment', name: 'Marvelous Miniature (Chest)', level: 3, books: ['GM Core'], release_date: '2023-08-01', data: { legacy_id: ['equipment-244-244'] } });
  add({ id: 'equipment-3568', category: 'equipment', name: 'Moritype', books: ['Rage of Elements'] });
  add({ id: 'ancestry-44', category: 'ancestry', name: 'Gnoll', data: { remaster_id: ['ancestry-79'] } });
  add({ id: 'ancestry-79', category: 'ancestry', name: 'Kholo', release_date: '2023-11-01', data: { legacy_id: ['ancestry-44'] } });
  add({ id: 'class-feature-872', category: 'class-feature', name: 'Cause', data: { class: 'Champion' } });
  add({ id: 'class-feature-888', category: 'class-feature', name: 'Divine Will', data: { class: 'Champion' } });
  add({ id: 'class-feature-770', category: 'class-feature', name: 'Patron', data: { class: 'Witch' } });
  add({ id: 'class-feature-700', category: 'class-feature', name: 'Divine Font', data: { class: 'Cleric' } });
  add({ id: 'class-feature-497', category: 'class-feature', name: 'Medium Armor Expertise', data: { class: 'Champion' } });
  add({ id: 'class-feature-498', category: 'class-feature', name: 'Resolve', data: { class: 'Inventor' } });
  add({ id: 'doctrine-5', category: 'doctrine', name: 'Warpriest' });

  const core = {
    conditions: { 'aon-lost': { name: 'Lost', aonId: 'condition-50' } },
    items: {
      'aon-fist': { name: 'Fist', aonId: 'weapon-356', level: 0 },
      'martyrs-shield': { name: "Martyr's Shield", aonId: 'equipment-4193', level: 7 },
      'martyrs-shield-hellbreakers': { name: "Martyr's Shield (Hellbreakers)", aonId: 'equipment-3126', level: 7 },
      chakri: { name: 'Chakri', aonId: 'weapon-333', level: 0 },
      'chakri-lost-omens': { name: 'Chakri (Lost Omens)', aonId: 'weapon-270', level: 0 },
      'aon-shadow-essence': { name: 'Shadow Essence', aonId: 'equipment-127', level: 10 },
      'marvelous-miniature': { name: 'Marvelous Miniature', aonId: 'equipment-3002' },
      'marvelous-miniature-chest': { name: 'Marvelous Miniature (Chest)', aonId: 'equipment-3002-2862', level: 3 },
      // the only carrier of the Core Rulebook page is the level-5 ammunition twin
      'feather-token-chest-ammunition': { name: 'Feather Token (Chest) (Ammunition)', aonId: 'equipment-244-244', level: 5, remasteredAs: { bucket: 'items', id: 'marvelous-miniature-chest' } },
      moritype: { name: 'Moritype', aonId: 'equipment-3568-1' },
      'moritype-greater': { name: 'Moritype (Greater)', aonId: 'equipment-3568' },
    },
    spells: {
      miracle: { name: 'Miracle', aonId: 'spell-196', level: 10, remasteredAs: { bucket: 'spells', id: 'manifestation' } },
      manifestation: { name: 'Manifestation', aonId: 'spell-1592', level: 10 },
      wish: { name: 'Wish', aonId: 'ritual-125', level: 10 },
    },
    feats: {
      'draconic-scent': { name: 'Draconic Scent', aonId: 'feat-5737', level: 5 },
      'draconic-scent-dragon-disciple': { name: 'Draconic Scent (Dragon Disciple)', aonId: 'feat-1942', level: 4 },
      'even-the-odds': { name: 'Even the Odds', aonId: 'feat-7675', level: 14 },
      'even-the-odds-eagle-knight': { name: 'Even the Odds (Eagle Knight)', aonId: 'feat-6145', level: 14 },
      'necromantic-resistance': { name: 'Necromantic Resistance', aonId: 'feat-9999', level: 4 },
      'necromantic-resistance-undead-slayer': { name: 'Necromantic Resistance (Undead Slayer)', aonId: 'feat-884', level: 4 },
    },
    classFeatures: {
      sloth: { name: 'Sloth', aonId: 'creature-family-9' },
      cause: { name: 'Cause', aonId: 'class-feature-872' },
      'divine-will': { name: 'Divine Will', aonId: 'class-feature-888' },
      patron: { name: 'Patron', aonId: 'class-feature-770' },
      'divine-font': { name: 'Divine Font', aonId: 'class-feature-700' },
      'medium-armor-expertise': { name: 'Medium Armor Expertise', aonId: 'class-feature-497' },
      // in no class table, and its own traits are stale: ownership comes from its page's class (Inventor)
      resolve: { name: 'Resolve', aonId: 'class-feature-498', traits: ['magus'] },
      'first-doctrine-warpriest': { name: 'First Doctrine (Warpriest)', aonId: 'doctrine-5' },
    },
    animalCompanions: { 'aon-fire-elemental': { name: 'Fire Elemental', aonId: 'animal-companion-62' } },
    ancestries: { kholo: { name: 'Kholo', aonId: 'ancestry-79' } },
    heritages: { 'aon-gnoll': { name: 'Gnoll', aonId: 'ancestry-44' } },
    rules: {
      perception: { name: 'Perception', aonId: 'rules-3303' },
      'perception-player-core': { name: 'Perception', aonId: 'rules-2040' },
    },
    classes: {
      champion: { name: 'Champion', features: [{ level: 1, featureId: 'cause' }, { level: 11, featureId: 'divine-will' }, { level: 7, featureId: 'medium-armor-expertise' }] },
      cleric: { name: 'Cleric', features: [{ level: 1, featureId: 'divine-font' }, { level: 11, featureId: 'medium-armor-expertise' }] },
      witch: { name: 'Witch', features: [{ level: 1, featureId: 'patron' }] },
      inventor: { name: 'Inventor', features: [] },
      magus: { name: 'Magus', features: [] },
    },
  } as Record<string, Record<string, Record<string, unknown>>>;
  const reprints = buildReprintMap(docs);
  const ctx = linkContext({ core, reprints, createdRefs: new Set(['rules:perception-player-core']) });
  const page = (bucket: string, key: string, tree: Node = { t: 'doc', c: [] }) => ({ bucket, key, tree });
  const NOWHERE = page('rules', 'some-page');

  it('the fixture pairs the reprints the way the Archives do', () => {
    expect(newestPrinting(reprints, 'spell-196')).toBe('spell-1592');
    expect(newestPrinting(reprints, 'equipment-244-244')).toBe('equipment-3002-2862');
    expect(newestPrinting(reprints, 'ancestry-44')).toBe('ancestry-79');
  });

  it('a DEAD AoN-authored link opens the page\'s record — `ref: null` and a ref naming a record that does not ship alike', () => {
    expect(relinkVerdict(link('condition-50', null, 'routed'), ctx)).toEqual({ ref: 'conditions:aon-lost', why: 'revive' });
    expect(relinkVerdict(link('weapon-356', 'items:fist', 'fist'), ctx)).toEqual({ ref: 'items:aon-fist', why: 'revive' });
  });

  it('a dead auto-link on one word stays dead ("lost" is a Kingmaker ARMY condition, not ordinary English)', () => {
    expect(planLink(link('condition-50', 'conditions:lost', 'lost', true), NOWHERE, ctx)).toEqual({ ref: 'conditions:lost', why: 'dead-auto' });
    // and a LIVE plain auto-link onto an `aon-` record is made inert, so no writer lights them up
    expect(planLink(link('condition-50', 'conditions:aon-lost', 'lost', true), NOWHERE, ctx)).toEqual({ ref: null, why: 'inert-auto-reach' });
  });

  it('tier 2: an auto-link whose words are the page\'s whole name (2+ words) revives — never onto an animal companion', () => {
    expect(planLink(link('equipment-127', null, 'shadow  essence', true), NOWHERE, ctx)).toEqual({ ref: 'items:aon-shadow-essence', why: 'revive-full-name' });
    // the whole-name auto-link may keep an `aon-` record
    expect(planLink(link('equipment-127', 'items:aon-shadow-essence', 'Shadow Essence', true), NOWHERE, ctx).ref).toBe('items:aon-shadow-essence');
    expect(planLink(link('animal-companion-62', null, 'fire elemental', true), NOWHERE, ctx)).toEqual({ ref: null, why: 'dead-auto' });
    // AoN's own link to the companion page does revive
    expect(planLink(link('animal-companion-62', null, 'Fire Elemental'), NOWHERE, ctx).ref).toBe('animalCompanions:aon-fire-elemental');
  });

  it('the reprint is followed: Miracle opens Manifestation, not the Wish ritual (dead or live)', () => {
    expect(relinkVerdict(link('spell-196', null, 'miracle'), ctx)).toEqual({ ref: 'spells:manifestation', why: 'revive' });
    expect(relinkVerdict(link('spell-196', 'spells:wish', 'miracle', true), ctx)).toEqual({ ref: 'spells:manifestation', why: 'repoint' });
    expect(relinkVerdict(link('spell-196', 'spells:manifestation', 'miracle', true), ctx).why).toBe('keep-page-record');
  });

  it("a dedication's feat link opens the archetype's own feat (Draconic Scent), not a same-named feat of another source", () => {
    expect(pageRecordRef('feat-1942', ctx)?.T0).toBe('feats:draconic-scent-dragon-disciple');
    expect(relinkVerdict(link('feat-1942', 'feats:draconic-scent', 'Draconic Scent'), ctx)).toEqual({ ref: 'feats:draconic-scent-dragon-disciple', why: 'repoint' });
  });

  it('CARRIER SANITY: a mis-stamped twin is never the page\'s record — by level, by an archetype suffix, by a book suffix', () => {
    const lvl = carrierRefusal('feats:even-the-odds-eagle-knight', docs.get('feat-6145'), ctx);
    expect(lvl).toMatch(/^level 14 against the page's 4/);
    expect(pageRecordRef('feat-6145', ctx)).toBeNull();
    expect(relinkVerdict(link('feat-6145', 'feats:even-the-odds', 'Even the Odds'), ctx)).toEqual({ ref: 'feats:even-the-odds', why: 'keep-no-page-record' });
    expect(carrierRefusal('feats:necromantic-resistance-undead-slayer', docs.get('feat-884'), ctx)).toMatch(/archetype the page is not in/);
    expect(pageRecordRef('feat-884', ctx)).toBeNull();
    expect(carrierRefusal('items:martyrs-shield-hellbreakers', docs.get('equipment-3126'), ctx)).toMatch(/book the page is not printed in/);
    // a series word ("Lost Omens") names no book: the Impossible Lands Chakri keeps its own record
    expect(carrierRefusal('items:chakri-lost-omens', docs.get('weapon-270'), ctx)).toBeNull();
    expect(relinkVerdict(link('weapon-270', 'items:chakri', 'chakri', true), ctx)).toEqual({ ref: 'items:chakri-lost-omens', why: 'repoint' });
  });

  it('a page whose every carrier is refused answers through its newest printing (Feather Token (Chest))', () => {
    expect(pageRecordRef('equipment-244-244', ctx)?.T).toBe('items:marvelous-miniature-chest');
    expect(relinkVerdict(link('equipment-244-244', 'items:marvelous-miniature', 'Feather Token (Chest)', true), ctx)).toEqual({ ref: 'items:marvelous-miniature-chest', why: 'repoint' });
  });

  it('an entity page never revives into a core record (the Sloth creature family is not classFeatures/sloth)', () => {
    expect(pageRecordRef('creature-family-9', ctx)).toBeNull();
    expect(relinkVerdict(link('creature-family-9', null, 'Sloth'), ctx).ref).toBeNull();
  });

  it('a created record never takes a link from the same-named record that was not created', () => {
    expect(pageRecordRef('rules-2040', ctx)?.T).toBe('rules:perception');
    expect(relinkVerdict(link('rules-2040', null, 'Perception'), ctx).ref).toBe('rules:perception');
  });

  it('live links kept on purpose: the newest printing (E1b), a family\'s base grade (E3), a shared class feature (E4)', () => {
    expect(relinkVerdict(link('ancestry-44', 'ancestries:kholo', 'Gnoll'), ctx).ref).toBe('ancestries:kholo');
    expect(relinkVerdict(link('equipment-3568', 'items:moritype', 'Moritype'), ctx)).toEqual({ ref: 'items:moritype', why: 'keep-E3' });
    expect(featureOwners(core).get('medium-armor-expertise')?.size).toBe(2);
  });

  it('I10c: "cause" in a kingdom action is inert; on the Champion\'s own pages it opens the Champion\'s Cause', () => {
    const cause = () => link('class-feature-872', 'classFeatures:cause', 'cause', true);
    expect(planLink(cause(), page('actions', 'aon-capital-investment'), ctx)).toEqual({ ref: null, why: 'inert-class-word' });
    expect(planLink(cause(), page('classes', 'champion'), ctx).ref).toBe('classFeatures:cause');
    expect(planLink(cause(), page('cause', 'paladin'), ctx).ref).toBe('classFeatures:cause'); // the class's sub-option bucket
    expect(planLink(cause(), page('feats', 'champion-dedication'), ctx).ref).toBe('classFeatures:cause');
    // AoN's own link is never touched (AoN never links a class feature; only the auto-linker does)
    expect(planLink(link('class-feature-872', 'classFeatures:cause', 'cause'), NOWHERE, ctx).ref).toBe('classFeatures:cause');
  });

  it('I10c: a page whose trait chips name the class keeps the word; multi-word terms keep their link; idioms do not', () => {
    const witchy: Node = { t: 'doc', c: [{ t: 'traits', c: [{ t: 'trait', label: 'Witch' }] }] };
    const patron = () => link('class-feature-770', 'classFeatures:patron', 'patron', true);
    expect(planLink(patron(), page('feats', 'some-witch-feat', witchy), ctx).ref).toBe('classFeatures:patron');
    expect(planLink(patron(), page('deities', 'barzahk'), ctx).ref).toBeNull();
    expect(planLink(link('class-feature-700', 'classFeatures:divine-font', 'divine font', true), page('deities', 'abadar'), ctx).ref).toBe('classFeatures:divine-font');
    expect(planLink(link('class-feature-888', 'classFeatures:divine-will', 'divine will', true), page('backgrounds', 'abadars-avenger'), ctx)).toEqual({ ref: null, why: 'inert-class-word' });
    // a shared feature (two class tables) is no one class's word
    expect(classWordInert(link('class-feature-497', 'classFeatures:medium-armor-expertise', 'expertise', true), page('rules', 'x'), ctx)).toBe(false);
  });

  it('tier 2 never revives a link into another class\'s feature, whatever its words (the runesmith\'s "formula book")', () => {
    const font = () => link('class-feature-700', null, 'Divine Font', true);
    expect(planLink(font(), page('classes', 'cleric'), ctx)).toEqual({ ref: 'classFeatures:divine-font', why: 'revive-full-name' });
    expect(planLink(font(), page('classes', 'runesmith'), ctx)).toEqual({ ref: null, why: 'dead-other-class' });
    // a LIVE multi-word link keeps working off its class's pages ("divine font" on a deity page)
    expect(planLink(link('class-feature-700', 'classFeatures:divine-font', 'Divine Font', true), page('classes', 'runesmith'), ctx).ref).toBe('classFeatures:divine-font');
  });

  it('I10c: a feature in no table takes its PAGE\'s class, never its record\'s stale traits', () => {
    const resolve = () => link('class-feature-498', 'classFeatures:resolve', 'resolve', true);
    expect(planLink(resolve(), page('classes', 'inventor'), ctx).ref).toBe('classFeatures:resolve');
    expect(planLink(resolve(), page('classes', 'magus'), ctx).ref).toBeNull();
  });

  it('pageClasses reads the class bucket, the sub-option bucket, the dedication, trait chips and the page document', () => {
    expect([...pageClasses('classes', 'champion', { t: 'doc' }, core)]).toEqual(['champion']);
    expect([...pageClasses('cause', 'paladin', { t: 'doc' }, core)]).toEqual(['champion']);
    expect([...pageClasses('feats', 'witch-dedication', { t: 'doc' }, core)]).toEqual(['witch']);
    expect([...pageClasses('classFeatures', 'first-doctrine-warpriest', { t: 'doc', aon: 'doctrine-5' }, core, ctx.docs)]).toEqual(['cleric']);
    expect([...pageClasses('draconicExemplar', 'adamantine', { t: 'doc' }, core)].sort()).toEqual(['barbarian', 'sorcerer']);
  });

  /* package I, the L8 checker: 13 class words went plain text on the class's OWN multiclass-archetype feats
   * (Basic Sorcerer Spellcasting's "bloodline", Instinct Ability's "instinct", Tactical Excellence's "tactics" …),
   * because only `<class>-dedication` counted as the class's page. The page document's archetype counts now. */
  it('a feat of a class\'s own multiclass archetype is that class\'s page (its document names the archetype)', () => {
    const docs = new Map([['feat-planted', { name: 'Expert Witch Spellcasting', category: 'feat', data: { archetype: ['Witch'] } }]]);
    expect([...pageClasses('feats', 'expert-witch-spellcasting', { t: 'doc', aon: 'feat-planted' }, core, docs)]).toContain('witch');
    expect([...pageClasses('feats', 'expert-witch-spellcasting', { t: 'doc', aon: 'feat-other' }, core, docs)]).not.toContain('witch');
  });

  it('CLASS_WORD_IDIOMS is exactly the six measured phrases', () => {
    expect([...CLASS_WORD_IDIOMS]).toEqual(['divine will', 'second skin', 'reaction time', 'perfected form', 'indomitable will', 'iron will']);
    expect(labelOf(link('x', null, '  Divine\n Will '))).toBe('Divine Will');
  });
});

const ROOT = join(__dirname, '..');
const gz = (bucket: string, dir = join(ROOT, 'public/ast')) => JSON.parse(gunzipSync(readFileSync(join(dir, `${bucket}.json.gz`))).toString('utf8')) as Record<string, Node>;
const linksOf = (tree: Node) => {
  const out: Node[] = [];
  (function walk(n: Node | Node[] | undefined) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.t === 'link' && n.to != null) out.push(n);
    if (n.c) walk(n.c);
  })(tree);
  return out;
};

describe('the shipped trees', () => {
  const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, unknown>>;

  it('no plain auto-link opens an `aon-` record (the 1,714 Kingmaker army-condition words stay plain text)', () => {
    const bad: string[] = [];
    for (const bucket of ['items', 'actions', 'feats', 'rules', 'spells', 'conditions']) {
      for (const [key, tree] of Object.entries(gz(bucket))) {
        for (const l of linksOf(tree)) {
          const ref = String(l.ref ?? '');
          if (!l.auto || !ref.includes(':aon-') || !(core as any)[ref.split(':')[0]]?.[ref.split(':')[1]]) continue;
          const name = String((core as any)[ref.split(':')[0]][ref.split(':')[1]].name ?? '');
          if (labelOf(l).toLowerCase() === name.toLowerCase() && /\s/.test(name)) continue; // tier 2
          bad.push(`${bucket}/${key} "${labelOf(l)}" -> ${ref}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('the fixed pairs: Draconic Scent, Miracle, Feather Token (Chest), Lissala, an army condition, "cause" off and on the Champion', () => {
    const at = (bucket: string, key: string, to: string, auto?: boolean) =>
      linksOf(gz(bucket)[key]).filter((l) => l.to === to && (auto === undefined || !!l.auto === auto)).map((l) => l.ref);
    expect(at('feats', 'dragon-disciple-dedication', 'feat-1942')).toEqual(['feats:draconic-scent-dragon-disciple']);
    expect(at('backgrounds', 'newcomer-in-need', 'spell-196')).toEqual(['spells:manifestation']);
    expect(at('items', 'feather-token-anchor', 'equipment-244-244')).toEqual(['items:marvelous-miniature-chest']);
    // AoN's own "engaged" opens the army condition; the auto-linker's "engaged" on the same page stays plain text
    expect(at('actions', 'advance', 'condition-48', false)).toEqual(['conditions:aon-engaged']);
    expect(at('actions', 'advance', 'condition-48', true)).toEqual(['conditions:engaged']);
    expect(core.conditions['engaged']).toBeUndefined();
    expect(at('actions', 'aon-capital-investment', 'class-feature-872')).toEqual([null]);
    expect(new Set(at('classes', 'champion', 'class-feature-872'))).toEqual(new Set(['classFeatures:cause']));
    // the runesmith's "formula book" stays plain text: class-feature-4 is the Alchemist's Formula Book
    expect(at('classes', 'runesmith', 'class-feature-4')).toEqual([null]);
  });

  it('package.json runs the pass in the data chain, after apply-ast-patches and before stamp-ast-urls', () => {
    const data = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.data as string;
    expect(data).toContain('node scripts/apply-ast-patches.mjs && node scripts/relink-carried-pages.mjs --write && node scripts/stamp-ast-urls.mjs');
    expect(data.trim().endsWith('node scripts/stamp-ast-urls.mjs')).toBe(true);
  });

  it('the baseline holds the 16 pairs that honestly stay, each with its reason', () => {
    const base = JSON.parse(readFileSync(join(ROOT, 'scripts/data/ast-link-carrier-baseline.json'), 'utf8'));
    expect(base.max).toBe(16);
    expect(Object.keys(base.pairs)).toHaveLength(16);
    for (const [pair, p] of Object.entries(base.pairs as Record<string, { why?: string }>)) expect(p.why, pair).toBeTruthy();
    expect(base.pairs['spell-196|spells:wish']).toBeUndefined();
  });
});

/*
 * On scratch copies of the shipped data: the pass plans nothing on the real trees (idempotent), and each
 * defect planted back into a COPY of one bucket fails the check, which the pass then repairs. Needs the
 * Archives export; skipped where it is not on disk.
 */
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
describe.skipIf(!existsSync(join(EXPORT, 'feat.json')))('the pass and the check on scratch copies of the shipped data', () => {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pi-links-')); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const run = (script: string, env: Record<string, string>, args: string[] = []) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }) };
    } catch (e: any) {
      return { code: e.status as number, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };
  /** A scratch AST dir holding one bucket, with `mutate` applied to its trees. */
  const planted = (bucket: string, mutate: (trees: Record<string, Node>) => void) => {
    const d = mkdtempSync(join(dir, `${bucket}-`));
    const trees = gz(bucket);
    mutate(trees);
    writeFileSync(join(d, `${bucket}.json.gz`), gzipSync(JSON.stringify(trees)));
    return d;
  };
  const setRef = (trees: Record<string, Node>, key: string, to: string, ref: string | null, auto?: boolean) => {
    const hits = linksOf(trees[key]).filter((l) => l.to === to && (auto === undefined || !!l.auto === auto));
    expect(hits.length, `${key} links ${to}`).toBeGreaterThan(0);
    for (const l of hits) l.ref = ref;
  };

  it('the pass is idempotent on the shipped trees: a dry run plans nothing', () => {
    const r = run('scripts/relink-carried-pages.mjs', {});
    expect(r.code).toBe(0);
    expect(r.out).toContain('planned 0 link change(s)');
  }, 120_000);

  it('control: an untouched copy of a bucket passes the check', () => {
    const r = run('scripts/ast-link-carrier-check.mjs', { AST_DIR: planted('feats', () => {}) });
    expect(r.code, r.out).toBe(0);
  }, 120_000);

  // [what, bucket, page, to, planted ref, the check's complaint, auto links only?]
  const PLANTS: [string, string, string, string, string | null, RegExp, boolean | undefined][] = [
    ['a revived army-condition link set back to its dead ref', 'actions', 'advance', 'condition-48', 'conditions:engaged', /revive \d+:/, false],
    ['the Dragon Disciple Dedication\'s Draconic Scent set back to the Dragonblood feat', 'feats', 'dragon-disciple-dedication', 'feat-1942', 'feats:draconic-scent', /NEW  feat-1942 opens feats:draconic-scent/, undefined],
    ['a Miracle link set back to the Wish ritual', 'backgrounds', 'newcomer-in-need', 'spell-196', 'spells:wish', /NEW  spell-196 opens spells:wish/, undefined],
    ['"cause" in a kingdom action set back to the Champion\'s Cause', 'actions', 'aon-capital-investment', 'class-feature-872', 'classFeatures:cause', /inert-class-word \d+:/, true],
  ];
  for (const [what, bucket, key, to, ref, expected, auto] of PLANTS) {
    it(`planted: ${what} -> the check fails; the pass repairs it`, () => {
      const d = planted(bucket, (t) => setRef(t, key, to, ref, auto));
      const red = run('scripts/ast-link-carrier-check.mjs', { AST_DIR: d });
      expect(red.code).toBe(1);
      expect(red.out).toMatch(expected);
      const fix = run('scripts/relink-carried-pages.mjs', { AST_DIR: d }, ['--write']);
      expect(fix.code, fix.out).toBe(0);
      const green = run('scripts/ast-link-carrier-check.mjs', { AST_DIR: d });
      expect(green.code, green.out).toBe(0);
      expect(JSON.stringify(gz(bucket, d)[key])).toBe(JSON.stringify(gz(bucket)[key]));
    }, 180_000);
  }

  it('planted: an auto "destroyed" on an item page lit up onto the army condition -> the check fails; the pass makes it plain text', () => {
    const d = planted('items', (t) => setRef(t, 'alisendras-fan', 'condition-46', 'conditions:aon-destroyed', true));
    const red = run('scripts/ast-link-carrier-check.mjs', { AST_DIR: d });
    expect(red.code).toBe(1);
    expect(red.out).toMatch(/inert-auto-reach \d+:/);
    expect(run('scripts/relink-carried-pages.mjs', { AST_DIR: d }, ['--write']).code).toBe(0);
    expect(run('scripts/ast-link-carrier-check.mjs', { AST_DIR: d }).code).toBe(0);
    // shipped, the word names a record that does not ship (conditions:destroyed); repaired, it names none — plain text either way
    expect(linksOf(gz('items', d)['alisendras-fan']).filter((l) => l.to === 'condition-46' && l.auto).map((l) => l.ref)).toEqual([null]);
  }, 180_000);
});

/*
 * scripts/rebuild-ast-entries.mjs on a scratch fixture (REBUILD_ROOT, AON_EXPORT): the rebuilt page goes through
 * the same rule. Without it, its carrier-only resolve lights up "lost" (an army condition) and "cause" (the
 * Champion's) on a page of neither — planted by removing the one line that applies the rule from a scratch copy.
 */
describe('rebuild-ast-entries applies the relink rule to the page it rebuilds', () => {
  let dir = '';
  let root = '';
  let exp = '';
  const SCRIPT = join(ROOT, 'scripts/rebuild-ast-entries.mjs');
  const RULE_LINE = '  relink(bucket, slug, tree);\n';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-rebuild-'));
    exp = join(dir, 'export');
    mkdirSync(exp);
    writeFileSync(join(exp, 'class-feature.json'), JSON.stringify({ docs: {
      'class-feature-9': { id: 'class-feature-9', category: 'class-feature', name: 'A', url: '/Classes.aspx?ID=5', ast: { t: 'doc', c: [
        link('condition-50', null, 'lost', true), link('condition-48', null, 'engaged'), link('class-feature-872', null, 'cause', true),
      ] } },
      'class-feature-872': { id: 'class-feature-872', category: 'class-feature', name: 'Cause', data: { class: 'Champion' } },
    } }));
    writeFileSync(join(exp, 'condition.json'), JSON.stringify({ docs: {
      'condition-50': { id: 'condition-50', category: 'condition', name: 'Lost' },
      'condition-48': { id: 'condition-48', category: 'condition', name: 'Engaged' },
    } }));
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const fixture = () => {
    root = mkdtempSync(join(dir, 'root-'));
    mkdirSync(join(root, 'public/ast'), { recursive: true });
    writeFileSync(join(root, 'public/core.json'), JSON.stringify({
      classFeatures: { a: { name: 'A', aonId: 'class-feature-9' }, cause: { name: 'Cause', aonId: 'class-feature-872' } },
      conditions: { 'aon-lost': { name: 'Lost', aonId: 'condition-50' }, 'aon-engaged': { name: 'Engaged', aonId: 'condition-48' } },
      classes: { champion: { name: 'Champion', features: [{ level: 1, featureId: 'cause' }] } },
    }));
    writeFileSync(join(root, 'public/ast/classFeatures.json.gz'), gzipSync(JSON.stringify({ a: { t: 'doc', c: [] } })));
    return root;
  };
  const refs = (r: string) => Object.fromEntries(linksOf(gz('classFeatures', join(r, 'public/ast')).a).map((l) => [l.to, l.ref]));
  const rebuild = (script: string, r: string) => execFileSync(process.execPath, [script, 'classFeatures/a'], { cwd: ROOT, env: { ...process.env, REBUILD_ROOT: r, AON_EXPORT: exp }, encoding: 'utf8' });

  it('the authored link opens the page\'s record; the army-condition word and the other class\'s word stay plain text', () => {
    const r = fixture();
    rebuild(SCRIPT, r);
    expect(refs(r)).toEqual({ 'condition-50': null, 'condition-48': 'conditions:aon-engaged', 'class-feature-872': null });
  }, 60_000);

  it('planted: without the rule, the rebuild lights both words up', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src.split(RULE_LINE).length - 1, 'the rule is applied on exactly one line').toBe(1);
    const mutant = join(mkdtempSync(join(dir, 'mut-')), 'rebuild-ast-entries.mjs');
    writeFileSync(mutant, src.replace(RULE_LINE, ''));
    const r = fixture();
    rebuild(mutant, r);
    expect(refs(r)).toEqual({ 'condition-50': 'conditions:aon-lost', 'condition-48': 'conditions:aon-engaged', 'class-feature-872': 'classFeatures:cause' });
  }, 60_000);
});
