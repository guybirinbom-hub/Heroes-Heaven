import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, buildChoiceOptions, emptyBuild, type BuildState } from '../src/rules/build';
import { deityDomainsOf, domainPoolFor, domainPoolForChoice } from '../src/rules/derive';

/**
 * SPLINTER FAITH'S FOURTH DOMAIN.
 *
 * *"Choose four domains. These domains must be chosen from among your deity's domains, your deity's
 * alternate domains, and up to one domain that isn't on either list and isn't anathematic to your
 * deity. Any domain spell you cast from a domain that isn't on either of your deity's lists is always
 * heightened to 1 rank lower than usual for a focus spell."* (feat-7596)
 *
 * The picker offered only the deity's two lists, so the third clause was unreachable — and Alocer
 * (deity-732: nature, pain, zeal, no alternates) made that concrete: a cleric of Alocer with the feat
 * could not answer four picks AT ALL, because the pool held three domains.
 *
 * "isn't anathematic to your deity" stays the player's — nothing in the data marks a domain
 * anathematic. "up to ONE" does not: the picker withholds the outside rows once one is held, and
 * `splinterDomainsOf` drops a second stored one.
 */
const db = content();
const SLOT = '1:class:0';

const cleric = (deityId: string, picks: string[]): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 8,
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  ancestryId: Object.keys(db.ancestries)[0],
  backgroundId: Object.keys(db.backgrounds)[0],
  deityId,
  featPicks: { [SLOT]: 'splinter-faith' },
  featChoices: Object.fromEntries(picks.map((d, i) => [`${SLOT}#${i}`, d])),
});

const optionsFor = (b: BuildState) =>
  buildChoiceOptions('splinter-faith', db.feats['splinter-faith'].choice!, b, db, buildCharacter(b, db), SLOT);

describe('Splinter Faith — the one domain from outside both lists', () => {
  it('the record asks for the pool that offers it', () => {
    const ch = db.feats['splinter-faith'].choice!;
    expect(ch.domainPool).toBe('deity+alternate+one-any');
    expect(ch.picks).toBe(4);
    // The note prints the clause. It used to say the outside pick needed the GM's agreement, which
    // feat-7596 does not say — the only player-side condition print states is "isn't anathematic".
    expect(ch.note).toMatch(/anathematic/i);
    expect(ch.note).toMatch(/1 rank lower/);
    expect(ch.note).not.toMatch(/GM/);
  });

  it('a cleric of Alocer reaches four picks — three listed plus one outside', () => {
    // Alocer prints three domains and no alternates, so the listed pool cannot fill four picks.
    expect(domainPoolFor('alocer', db, 'deity+alternate')).toEqual(['nature', 'pain', 'zeal']);
    const b = cleric('alocer', ['nature', 'pain', 'zeal', 'knowledge']);
    const ch = buildCharacter(b, db);
    expect(ch.deityDomains?.domains).toEqual(['nature', 'pain', 'zeal', 'knowledge']);
    expect(ch.deityDomains?.from).toBe('Splinter Faith');
    // "the four domains you chose ARE your deity's domains" — every other domain picker sees them.
    expect(domainPoolForChoice(b, db, 'domain-initiate', 'deity')).toEqual(['nature', 'pain', 'zeal', 'knowledge']);
    expect(deityDomainsOf(ch, db).domains).toContain('knowledge');
  });

  it('offers every domain, with the outside ones labelled as outside', () => {
    const opts = optionsFor(cleric('alocer', []));
    // The deity's own list comes FIRST and unlabelled — the picker still reads as their domains.
    expect(opts.slice(0, 3).map((o) => o.value)).toEqual(['nature', 'pain', 'zeal']);
    expect(opts.slice(0, 3).every((o) => !/outside/.test(o.label))).toBe(true);
    expect(opts.length).toBeGreaterThan(20);
    expect(opts.find((o) => o.value === 'knowledge')?.label).toMatch(/outside your deity's lists — heightened 1 rank lower/);
  });

  it('withholds the remaining outside domains once one is held, greyed with the reason (Q27)', () => {
    const opts = optionsFor(cleric('alocer', ['nature', 'pain', 'zeal', 'knowledge']));
    // The one actually taken stays live — it is the row its own picker is displaying.
    expect(opts.find((o) => o.value === 'knowledge')?.disabled).toBeUndefined();
    expect(opts.find((o) => o.value === 'death')?.disabled).toMatch(/only one of the four/i);
    // A listed domain is never greyed by this rule.
    expect(opts.find((o) => o.value === 'zeal')?.disabled).toBeUndefined();
  });

  it('drops a SECOND outside domain rather than granting a fifth off-list one, and says which', () => {
    // A stored second outside answer can still arrive from a deity change or an import.
    const b = cleric('alocer', ['nature', 'pain', 'knowledge', 'death']);
    const ch = buildCharacter(b, db);
    expect(ch.deityDomains?.domains).toEqual(['nature', 'pain', 'knowledge']);
    expect(ch.deityDomains?.domains).not.toContain('death');
    // …and the picker agrees with the build: the dropped one is greyed with the reason, so it is not
    // sitting in its picker looking accepted while granting nothing.
    const opts = optionsFor(b);
    expect(opts.find((o) => o.value === 'death')?.disabled).toMatch(/only one of the four/i);
    expect(opts.find((o) => o.value === 'knowledge')?.disabled).toBeUndefined();
  });

  it('with NO deity chosen yet, nothing is "outside" and all four picks still land', () => {
    // "…a domain that isn't on either of your deity's LISTS" — no deity, no lists. Every row used to
    // be labelled outside and all but one greyed, so the four picks could not be answered at all.
    const b = cleric('', ['nature', 'pain', 'zeal', 'knowledge']);
    expect(buildCharacter(b, db).deityDomains?.domains).toEqual(['nature', 'pain', 'zeal', 'knowledge']);
    expect(optionsFor(b).some((o) => /outside/.test(o.label) || o.disabled)).toBe(false);
  });

  it('an Abadar cleric still sees the full listed pool first, and needs no outside pick', () => {
    const listed = domainPoolFor('abadar', db, 'deity+alternate');
    expect(listed.length).toBeGreaterThanOrEqual(4);
    const opts = optionsFor(cleric('abadar', []));
    expect(opts.slice(0, listed.length).map((o) => o.value)).toEqual(listed);
    const b = cleric('abadar', listed.slice(0, 4));
    expect(buildCharacter(b, db).deityDomains?.domains).toEqual(listed.slice(0, 4));
    // …and with four listed picks nothing is greyed as an outside overflow.
    expect(optionsFor(b).some((o) => /only one of the four/i.test(o.disabled ?? ''))).toBe(false);
  });
});
