import { describe, expect, it } from 'vitest';
import { buildReprintMap } from '../scripts/lib/reprint.mjs';
import { buildIndex, classify, linkGraph, remasterBooks, reprintEdges } from '../scripts/lib/player-coverage.mjs';
import { ancestryOf, subclassLink } from '../scripts/lib/player-create.mjs';

/**
 * The rule set behind scripts/player-coverage-check.mjs (the guard in `npm run verify`) and behind the
 * importer's step 4, which CREATES a record for exactly the pages this rule calls missing
 * (scripts/import-core-v2.mjs). The real-data half is the guard itself over the 26,262 player-option
 * pages of the export; this pins each branch on synthetic pages, where it is cheap and exact.
 */
type Doc = {
  id: string; category: string; name: string; book?: string; books?: string[]; level?: number;
  superseded_by?: string; exclude_from_search?: boolean;
  data?: { legacy_id?: string[]; remaster_id?: string[]; class?: string; text?: string; archetype?: string[]; ability_type?: string };
};
const page = (id: string, category: string, name: string, extra: Partial<Doc> = {}): Doc =>
  ({ id, category, name, book: extra.book ?? 'Player Core', data: {}, ...extra });

const CORE = {
  feats: {
    alpha: { id: 'alpha', name: 'Alpha', aonId: 'feat-1', source: { book: 'Pathfinder Player Core' } },
    'beta-remastered': { id: 'beta-remastered', name: 'Beta', aonId: 'feat-3', source: { book: 'Pathfinder Player Core' } },
    gamma: { id: 'gamma', name: 'Gamma', source: { book: 'Pathfinder Player Core 2' } },
    'zombie-horde': { id: 'zombie-horde', name: 'Zombie Horde', aonId: 'feat-6', source: { book: 'Pathfinder #180: The Smoking Gun' } },
    'zombie-horde-impossible-magic': { id: 'zombie-horde-impossible-magic', name: 'Zombie Horde', aonId: 'feat-7', source: { book: 'Pathfinder Impossible Magic' } },
  },
  items: { vitalizing: { id: 'vitalizing', name: 'Vitalizing', aonId: 'equipment-20-21', source: { book: 'Pathfinder GM Core' } } },
  classFeatures: {
    'weapon-expertise': { id: 'weapon-expertise', name: 'Weapon Expertise', aonId: 'class-feature-500' },
    'crafter-in-the-vault': { id: 'crafter-in-the-vault', name: 'Crafter in the Vault', aonId: 'apparition-3', traits: ['animist'], level: 1, actionCost: { type: 'passive' }, otherTags: ['animist-apparition'] },
    'echo-of-lost-moments': { id: 'echo-of-lost-moments', name: 'Echo of Lost Moments', aonId: 'apparition-5', traits: ['animist'], level: 1, actionCost: { type: 'passive' }, otherTags: ['animist-apparition'] },
  },
  classes: {
    fighter: { id: 'fighter', features: [{ level: 5, featureId: 'weapon-expertise' }] },
    animist: { id: 'animist', features: [], extraChoices: [{ id: 'apparition', options: [
      { id: 'crafter-in-the-vault', name: 'Crafter in the Vault' }, { id: 'echo-of-lost-moments', name: 'Echo of Lost Moments' },
      { id: 'lamentation-of-sinister-deals', name: 'Lamentation of Sinister Deals' },
    ] }] },
  },
  ancestries: { automaton: { id: 'automaton', name: 'Automaton' }, elf: { id: 'elf', name: 'Elf' } },
};

const PAGES: Doc[] = [
  page('feat-1', 'feat', 'Alpha'),
  // a legacy page the Archives say was replaced by feat-3, which ships under another key
  page('feat-2', 'feat', 'Beta', { book: 'Core Rulebook', superseded_by: 'feat-3' }),
  page('feat-3', 'feat', 'Beta'),
  // no aonId anywhere, same name, same book (the "Pathfinder " prefix does not decide)
  page('feat-4', 'feat', 'Gamma', { book: 'Player Core 2' }),
  // a second, DIFFERENT feat of a shipped name: another book, different text
  page('feat-6', 'feat', 'Zombie Horde', { book: 'Pathfinder #180: The Smoking Gun', data: { text: 'You call up a shambling horde from the ground around you.' } }),
  page('feat-8', 'feat', 'Zombie Horde', { book: 'Secrets of Magic', data: { text: 'A sorcerous rite reshapes your minions into something new entirely.' } }),
  page('feat-9', 'feat', 'Delta'),
  // a grade family: the summary page is covered by its grade, and the legacy rune by its reprint's grade
  page('equipment-20', 'equipment', 'Vitalizing', { book: 'GM Core' }),
  page('equipment-20-21', 'equipment', 'Vitalizing', { book: 'GM Core' }),
  page('equipment-10', 'equipment', 'Disrupting', { book: 'Core Rulebook', superseded_by: 'equipment-20' }),
  // class-table rows
  page('class-feature-600', 'class-feature', 'Fighter Feats', { data: { class: 'Fighter' } }),
  page('class-feature-601', 'class-feature', 'Weapon Expertise', { book: 'Battlecry!', data: { class: 'Fighter' } }),
  page('class-feature-43', 'class-feature', 'Lightning Reflexes', { book: 'Core Rulebook', superseded_by: 'class-99', data: { class: 'Fighter' } }),
  page('class-99', 'class', 'Fighter'),
  page('apparition-16', 'apparition', 'Lamentation of Sinister Deals', { book: "Pathfinder #223: Hell's Destiny" }),
];

function ctxFor(core: object, pages: Doc[]) {
  const docs = new Map(pages.map((p) => [p.id, { ...p, books: p.books ?? [p.book].filter(Boolean) }]));
  const edges = reprintEdges(docs, buildReprintMap(docs));
  return { index: buildIndex(core), adj: linkGraph(docs, edges), pairs: remasterBooks(docs, edges), docs, textOf: (id: string) => docs.get(id)?.data?.text };
}
const ctx = ctxFor(CORE, PAGES);
const of = (id: string, opts?: { skipKeys?: Set<string> }) => classify(ctx.docs.get(id), ctx, opts);

describe('player coverage — when an Archives page counts as having a record', () => {
  it('by aonId: a record carries the page id', () => {
    expect(of('feat-1')).toEqual({ status: 'aonId', via: 'feats/alpha' });
  });

  it('by twin: the page the Archives say replaced it has a record under another key', () => {
    expect(of('feat-2')).toMatchObject({ status: 'twin', via: 'feats/beta-remastered (feat-3)' });
  });

  it('by twin through the grade family: a summary page, and a legacy rune whose reprint ships as a grade', () => {
    expect(of('equipment-20')).toMatchObject({ status: 'twin', via: 'items/vitalizing (equipment-20-21)' });
    expect(of('equipment-10').status).toBe('twin');
  });

  it('by name: same kind, same book, no aonId on the record', () => {
    expect(of('feat-4')).toEqual({ status: 'name', via: 'feats/gamma' });
  });

  it('missing: a same-name page from another book whose text shares nothing is a DIFFERENT feat', () => {
    // gold-set R12: two different Zombie Horde feats exist — a bare name match across books is never enough
    expect(of('feat-8').status).toBe('missing');
    expect(of('feat-9').status).toBe('missing');
  });

  it('structural: a chassis row, a row of a legacy class printing, a per-class copy of a shared record', () => {
    expect(of('class-feature-600')).toEqual({ status: 'structural', via: 'chassis' });
    expect(of('class-feature-43')).toEqual({ status: 'structural', via: 'legacy-class' });
    expect(of('class-feature-601')).toEqual({ status: 'structural', via: 'shared:classFeatures/weapon-expertise' });
  });

  it("the importer's view: a record step 4 created last run is not the page's presence", () => {
    // feat-7 has no page here; feat-6's own record is the shipped #180 feat and stays present
    expect(of('feat-6').status).toBe('aonId');
    const created = new Set(['feats/zombie-horde']);
    expect(of('feat-6', { skipKeys: created }).status).toBe('missing');
  });
});

/*
 * The four ways the first cut of the rule went wrong on real data (refuted 2026-09-24), each pinned on
 * the smallest synthetic shape that reproduces it.
 */
describe('player coverage — the name rule reads the right book, the right text and the right record', () => {
  const REFUGEE_FOP = 'The fighting around the Lake Encarthan region drove you from your home; you forage and hunt your way across the wilds.';
  const REFUGEE_PC2 = 'You come from a land far from where you now live, having fled war, famine or persecution to start over among strangers.';
  const core = {
    backgrounds: {
      // the Fall of Plaguestone record, carrying the Player Core 2 page (the build-map join that ignores books)
      'refugee-fall-of-plaguestone': { id: 'refugee-fall-of-plaguestone', name: 'Refugee (Fall of Plaguestone)', aonId: 'background-455', description: REFUGEE_FOP, source: { book: 'Pathfinder Adventure: The Fall of Plaguestone' } },
      'refugee-pc2': { id: 'refugee-pc2', name: 'Refugee (PC2)', aonId: 'background-455', description: REFUGEE_PC2, source: { book: 'Pathfinder Player Core 2' } },
    },
    feats: {
      'stone-blood': { id: 'stone-blood', name: 'Stone Blood', aonId: 'feat-890', archetype: 'living-monolith', description: 'Your blood turns to stone and you resist poison.', source: { book: 'Pathfinder Lost Omens World Guide' } },
      'stone-blood-stonebound': { id: 'stone-blood-stonebound', name: 'Stone Blood (Stonebound)', aonId: 'feat-890', archetype: 'stonebound', description: 'Your blood turns to stone and you resist poison.', source: { book: 'Pathfinder #195: Heavy is the Crown' } },
    },
    items: {
      'aeon-stone-eastern-star': { id: 'aeon-stone-eastern-star', name: 'Aeon Stone (Eastern Star)', description: 'This glittering stone orbits your head and grants a gift of light.', source: { book: 'Pathfinder The Dead God\'s Hand' } },
      'aeon-stone-western-star': { id: 'aeon-stone-western-star', name: 'Aeon Stone (Western Star)', description: 'This dark stone orbits your head and whispers the paths of the western stars.', source: { book: 'Pathfinder Lost Omens Pathfinder Society Guide' } },
    },
    classFeatures: {
      'bloodline-elemental': { id: 'bloodline-elemental', name: 'Bloodline: Elemental', description: 'An elemental influence runs through your family.', source: { book: 'Pathfinder Player Core 2' } },
    },
  };
  const pages: Doc[] = [
    page('background-40', 'background', 'Refugee (FoP)', { book: 'The Fall of Plaguestone', data: { text: REFUGEE_FOP } }),
    page('background-455', 'background', 'Refugee', { book: 'Player Core 2', data: { text: REFUGEE_PC2 } }),
    page('feat-890', 'feat', 'Stone Blood', { book: 'World Guide', data: { text: 'Your blood turns to stone and you resist poison.', archetype: ['Living Monolith'] } }),
    page('feat-4380', 'feat', 'Stone Blood', { book: 'Pathfinder #195: Heavy is the Crown', data: { text: 'Your blood turns to stone and you resist poison.', archetype: ['Stonebound'] } }),
    page('feat-9999', 'feat', 'Stone Blood', { book: 'Pathfinder #999: Somewhere Else', data: { text: 'Your blood turns to stone and you resist poison.', archetype: ['Other Archetype'] } }),
    page('equipment-4735', 'equipment', 'Aeon Stone (Western Star)', { book: "The Dead God's Hand", data: { text: 'This dark stone orbits your head and whispers the paths of the western stars.' } }),
    page('instinct-7', 'instinct', 'Elemental', { book: 'Rage of Elements', data: { text: 'An elemental influence runs through your family.' } }),
  ];
  const c = ctxFor(core, pages);
  const v = (id: string) => classify(c.docs.get(id), c);

  it('"Pathfinder Adventure: X" is the Archives\' "X" — the singular shelf prefix was not stripped', () => {
    expect(v('background-40')).toEqual({ status: 'name', via: 'backgrounds/refugee-fall-of-plaguestone' });
  });

  it("a record matches its own page by its OWN text, whatever page its aonId names", () => {
    // Book evidence removed: only the text can say it, and it must be the record's own text.
    const other = structuredClone(core);
    other.backgrounds['refugee-fall-of-plaguestone'].source.book = 'Pathfinder Somewhere Else';
    const c2 = ctxFor(other, pages);
    expect(classify(c2.docs.get('background-40'), c2)).toMatchObject({ status: 'name', via: expect.stringMatching(/^backgrounds\/refugee-fall-of-plaguestone \(text/) });
  });

  it('two archetype feats of one name are two feats: the page goes to its own archetype\'s record', () => {
    expect(v('feat-4380')).toEqual({ status: 'name', via: 'feats/stone-blood-stonebound' });
    // …and a third archetype's page of the same name and the same text matches neither.
    expect(v('feat-9999').status).toBe('missing');
  });

  it('the record whose name IS the page wins over a same-book one that matches only without its qualifier', () => {
    expect(v('equipment-4735')).toMatchObject({ status: 'name', via: expect.stringMatching(/^items\/aeon-stone-western-star/) });
  });

  it("a class option's category word is stripped only for its OWN category", () => {
    // The instinct page "Elemental" must never answer to the sorcerer's "Bloodline: Elemental".
    expect(v('instinct-7').status).toBe('missing');
    const withInstinct = structuredClone(core) as typeof core & { classFeatures: Record<string, object> };
    withInstinct.classFeatures['elemental-instinct'] = { id: 'elemental-instinct', name: 'Elemental Instinct', description: 'An elemental influence runs through your family.', source: { book: 'Pathfinder Rage of Elements' } };
    const c3 = ctxFor(withInstinct, pages);
    expect(classify(c3.docs.get('instinct-7'), c3)).toEqual({ status: 'name', via: 'classFeatures/elemental-instinct' });
  });
});

/*
 * The hand-back must name the page's OWN record (refuted 2026-09-24): 75 rows named a record of another
 * kind, and the House Drake's Breath Weapon was "present" through the Faerie Dragon's.
 */
describe('player coverage — a page is answered for by a record of its own kind and its own familiar', () => {
  const FAERIE = 'The faerie dragon breathes euphoric gas in a 10-foot cone. Each creature in the area must attempt a Fortitude save against your class DC or spell DC.';
  const DRAKE = 'The house drake breathes a 10-foot cone of silver mist. Each creature in the area must attempt a Will save against your class DC or spell DC.';
  const core = {
    // an ITEM record carrying a feat page's id by mistake, beside the feat's own same-book record
    items: { 'aon-borrow-time': { id: 'aon-borrow-time', name: 'Borrow Time', aonId: 'feat-3852', source: { book: 'Pathfinder Player Core' } } },
    feats: { 'borrow-time': { id: 'borrow-time', name: 'Borrow Time', source: { book: 'Pathfinder Player Core' } } },
    familiarAbilities: { 'breath-weapon': { id: 'breath-weapon', name: 'Breath Weapon', aonId: 'familiar-ability-19', source: { book: "Pathfinder Advanced Player's Guide" } } },
    specificFamiliars: { 'house-drake': { id: 'house-drake', name: 'House Drake', specials: [{ name: 'Breath Weapon', desc: DRAKE }, { name: 'Silver Infusion', desc: '' }] } },
  };
  const pages: Doc[] = [
    page('feat-3852', 'feat', 'Borrow Time'),
    page('familiar-ability-19', 'familiar-ability', 'Breath Weapon', { book: "Advanced Player's Guide", data: { text: FAERIE, ability_type: 'Specific Familiar - Faerie Dragon' } }),
    page('familiar-ability-85', 'familiar-ability', 'Breath Weapon', { book: 'Shadows at Sundown', data: { text: DRAKE, ability_type: 'Specific Familiar - House Drake' } }),
  ];

  it('a record of another kind carrying the id is not the page\'s record — its own kind\'s record is', () => {
    const c = ctxFor(core, pages);
    expect(classify(c.docs.get('feat-3852'), c)).toEqual({ status: 'name', via: 'feats/borrow-time' });
  });

  it("two specific familiars' abilities of one name are two abilities; the familiar's own inline one answers", () => {
    const c = ctxFor(core, pages);
    expect(classify(c.docs.get('familiar-ability-19'), c)).toEqual({ status: 'aonId', via: 'familiarAbilities/breath-weapon' });
    expect(classify(c.docs.get('familiar-ability-85'), c)).toEqual({ status: 'name', via: 'specificFamiliars/house-drake (inline ability)' });
    // Without the House Drake's own record it is missing — never the Faerie Dragon's, whatever the text shares.
    const bare = structuredClone(core) as Partial<typeof core>;
    delete bare.specificFamiliars;
    const c2 = ctxFor(bare, pages);
    expect(classify(c2.docs.get('familiar-ability-85'), c2).status).toBe('missing');
  });
});

describe('player creation — the linkage a new record needs, read from the data', () => {
  it("a heritage's ancestry comes from its name, and only an unambiguous one", () => {
    expect(ancestryOf('Defensive Automaton', CORE.ancestries)).toBe('automaton');
    expect(ancestryOf('Newly Minted Automaton', CORE.ancestries)).toBe('automaton');
    expect(ancestryOf('Skilled Human', CORE.ancestries)).toBeNull();
  });

  it("a class option takes its siblings' shape and its class list's existing option id", () => {
    const link = subclassLink({ id: 'apparition-16', category: 'apparition', name: 'Lamentation of Sinister Deals' }, CORE);
    expect(link).toEqual({
      traits: ['animist'], level: 1, actionCost: { type: 'passive' }, otherTags: ['animist-apparition'],
      classId: 'animist', groupId: 'apparition', optionId: 'lamentation-of-sinister-deals',
    });
  });

  it('refuses to guess when the siblings disagree', () => {
    const core = structuredClone(CORE);
    core.classFeatures['echo-of-lost-moments'].otherTags = ['something-else'];
    expect(subclassLink({ id: 'apparition-16', category: 'apparition', name: 'Lamentation of Sinister Deals' }, core).error).toMatch(/disagree/);
  });
});
