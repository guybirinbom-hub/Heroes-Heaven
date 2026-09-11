// @vitest-environment jsdom
/*
 * WHY THIS EXISTS
 *
 * The whole point of the trust gate is that a player can tell "this feat is off for now" from "this
 * feat is broken". That difference is one line of text on the screen, so the only honest test is one
 * that renders the component and reads the pixels: does the line appear for a record whose mechanics
 * were stripped, and stay away from a record that is fully on.
 *
 * The side map is stubbed rather than loaded: lane A owns applyTrustGate and content({ trustGate:
 * true }), and this test is about what the marker DOES with a side map, not about how it is filled.
 * Two things the stub cannot fake are checked against the REAL ledger below: the bucket NAMES the
 * surfaces pass, and that a surface still renders the marker at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderDom } from './_render';
import { content, build } from './_content';
import LEDGER from '../src/data/trust-ledger.json';

const OFF_PATHS = ['innateSpells', 'passiveEffects.resistances', 'choice.options[].grant.skills'];

/** Mutable so a test can turn the switch off, or darken a real record before rendering a surface. */
const stub = vi.hoisted(() => ({ on: true, dark: new Set<string>(['feats/dark-one']) }));

// Hoisted above the import below by vitest, which is why TrustMarker can be imported normally.
vi.mock('../src/data/trustGate', () => ({
  trustGateOn: () => stub.on,
  trustOff: (bucket: string, id: string) => {
    // A lookup on a record the caller could not name ("feats/undefined") is the bug the component's
    // own guard exists to prevent, so the stub refuses it instead of quietly answering undefined.
    if (!bucket || !id) throw new Error(`trustOff called with bucket=${bucket} id=${id}`);
    return stub.dark.has(`${bucket}/${id}`) ? OFF_PATHS : undefined;
  },
}));

import { TrustMarker, trustWords } from '../src/sheet/TrustMarker';
import { FeatsTab, featEntries } from '../src/sheet/FeatsTab';
import { trustRefOf, type FeatEntry } from '../src/sheet/FeatDetail';
import { ChoiceDetails } from '../src/builder/shared';

function render(el: Parameters<typeof renderDom>[0]) {
  const r = renderDom(el);
  const note = r.host.querySelector('[role="note"]');
  const out = { text: r.host.textContent ?? '', title: note?.getAttribute('title') ?? '' };
  r.stop();
  return out;
}

describe('TrustMarker', () => {
  it('says so on a record whose mechanics are stripped', () => {
    const { text, title } = render(<TrustMarker bucket="feats" id="dark-one" />);
    expect(text).toContain('Not yet verified');
    // Plain words in the tooltip, and none of our field names on the screen or in it.
    expect(title).toContain('the spells it grants');
    expect(title).toContain('resistances and immunities');
    expect(title).toContain('skill training');
    expect(title + text).not.toMatch(/innateSpells|passiveEffects|choice\.options/);
  });

  it('stays away from a record that is fully on', () => {
    expect(render(<TrustMarker bucket="feats" id="bright-one" />).text).toBe('');
  });

  it('stays away when the caller does not know which record it is showing', () => {
    expect(render(<TrustMarker bucket="feats" />).text).toBe('');
    expect(render(<TrustMarker id="dark-one" />).text).toBe('');
  });

  it('stays away when the player has turned the gate off', () => {
    stub.on = false;
    try {
      expect(render(<TrustMarker bucket="feats" id="dark-one" />).text).toBe('');
    } finally {
      stub.on = true;
    }
  });

  it('says every kind of stripped path in words, deduplicated', () => {
    expect(trustWords(['heldSpells', 'focusSpells'])).toBe('the spells it grants');
    expect(trustWords(['grantedStrikes'])).toBe('attacks and damage');
    expect(trustWords(['situational'])).toBe('its situational bonuses');
    expect(trustWords(['effectChoices[].options[].grant.passive.speeds'])).toBe('movement speeds');
    // A path no rule knows still gets a sentence rather than a raw field name.
    expect(trustWords(['somethingTheGeneratorAddedLater'])).toBe('some of its effects');
  });

  /** Every path the shipped ledger actually strips, so a generator that starts emitting a new field
   *  is caught here rather than printing "some of its effects" at a player. */
  it('has words for every path the shipped ledger strips', () => {
    const paths = [...new Set(Object.values(LEDGER.records as Record<string, string[]>).flat())];
    expect(paths.length).toBeGreaterThan(50);
    expect(paths.filter((p) => trustWords([p]) === 'some of its effects')).toEqual([]);
  });
});

describe('the surfaces that render it', () => {
  /** The record a feats-list row is showing. The bucket strings are the LEDGER's own keys, so a typo
   *  ('classFeature') or a bucket rename would silence the marker on every row of that kind. */
  it('maps a row to the bucket the ledger is keyed by', () => {
    const row = (o: Partial<FeatEntry>) => trustRefOf({ key: 'k', name: 'n', level: 1, traits: [], description: '', isFeature: false, bucket: 'Class', ...o });
    expect(row({ featId: 'x' })).toEqual({ bucket: 'feats', id: 'x' });
    expect(row({ featureId: 'x' })).toEqual({ bucket: 'classFeatures', id: 'x' });
    expect(row({ heritageId: 'x' })).toEqual({ bucket: 'heritages', id: 'x' });
    expect(row({})).toEqual({});
    const buckets = new Set(Object.keys(LEDGER.records).map((k) => k.slice(0, k.indexOf('/'))));
    // 'items' is the literal ItemDetail passes.
    for (const b of ['feats', 'classFeatures', 'heritages', 'items']) expect([b, buckets.has(b)]).toEqual([b, true]);
  });

  /* A SUBCLASS pick (a rogue's racket, a witch's lesson) is a class-feature record shown by a row
   * that carries no `featureId` — 51 of the 105 gated class features reach the sheet only this way,
   * and every one of them printed its full text with no marker until the row carried its id. */
  it('a gated subclass pick resolves to its class-feature record', () => {
    const con = content();
    const ch = build('rogue', 3, { subclassId: 'ruffian' } as never);
    const row = featEntries(ch, con).find((e) => trustRefOf(e).id === 'ruffian');
    expect(row?.name).toBe(con.classFeatures['ruffian'].name);
    expect(trustRefOf(row!)).toEqual({ bucket: 'classFeatures', id: 'ruffian' });
    /*
     * …and until 2026-09-11 `ruffian` was also one of the records the shipped ledger turned off. It is
     * not any more, and that is a RULING rather than a break: desk #157 (work/owner-questions.json,
     * authorisedExceptions) switched core class features back on — a class with its features off is not
     * a character — so every subclass option in public/core.json is now fully trusted, and the 28
     * classFeatures the ledger still gates are the archetype/subsystem records no class progression
     * owns (the deviant classifications, the witch lessons, the thaumaturge initiate benefits).
     *
     * That leaves this line one thing to prove, which is the thing it was always for: the key
     * trustRefOf builds is the key the ledger is keyed by. So it is asserted through trustRefOf's own
     * bucket against a record the ledger really holds, and still fails the moment the two drift.
     */
    expect(Object.keys(LEDGER.records)).not.toContain('classFeatures/ruffian');
    expect(Object.keys(LEDGER.records)).toContain(`${trustRefOf(row!).bucket}/lesson-of-vows`);
  });

  /* Rendering the component proves the component. Only rendering a SURFACE proves the surface still
   * calls it — deleting the <TrustMarker/> line from FeatsTab left every other suite green. */
  it('a gated feat the character owns says so in the feats list', () => {
    const con = content();
    const featId = Object.keys(LEDGER.records)
      .filter((k) => k.startsWith('feats/'))
      .map((k) => k.slice('feats/'.length))
      .find((id) => con.feats[id]);
    expect(featId).toBeTruthy();
    stub.dark.add(`feats/${featId}`);
    const ch = build('fighter', 5);
    const gated = { ...ch, feats: [...ch.feats, { featId: featId!, level: 1, category: 'class' as const }] };
    const { host, stop } = renderDom(<FeatsTab character={gated} content={con} onPlay={() => undefined} />);
    const text = host.textContent ?? '';
    stop();
    expect(text).toContain(con.feats[featId!].name);
    expect(text).toContain('Not yet verified');
  });

  /* THE BUILDER (docs/trust-gate.md §3, "a gated picker says why it does nothing"). ChoiceDetails is
   * the row for a thing you are GRANTED — the class features under "You gain automatically" and the
   * feats a background hands out — and it only knows which record it is showing if its caller says so.
   * Both halves are checked because either alone stays green while the marker is invisible in the
   * builder: the component renders nothing without props, and the props are the only wiring there is. */
  it('a granted row in the builder says so, and Builder tells it which record it is', () => {
    expect(render(<ChoiceDetails name="Dark One" flavor="Some printed text." bucket="feats" id="dark-one" />).text).toContain(
      'Not yet verified',
    );
    expect(render(<ChoiceDetails name="Bright One" flavor="Some printed text." bucket="feats" id="bright-one" />).text).not.toContain(
      'Not yet verified',
    );
    /* The exact expressions, not a bare `bucket=` substring: a decoy elsewhere in a 10k-line file
     * would keep a substring check green while the two real rows passed nothing (lane B's lesson). */
    const src = readFileSync('src/builder/Builder.tsx', 'utf8');
    expect(src).toMatch(/bucket="classFeatures"\s+id=\{f\.id\}/);
    expect(src).toMatch(/bucket="feats"\s+id=\{gid\}/);
  });
});
