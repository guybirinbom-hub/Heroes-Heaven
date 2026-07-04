import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { applySources, emptyBuild, type BuildState } from '../src/rules/build';
import { enabledBookSet } from '../src/rules/sources';
import { eligibleFeatsForSlot, findHiddenFeatMatches } from '../src/rules/featSlots';

/*
 * Regression coverage for the "I search for a feat I know exists and get nothing" bug:
 * the builder's slot pickers offer only source-FILTERED content (absent enabledSources = Core-only)
 * while the Overrides add-feat picker browses the FULL content — so ~70% of feats were silently
 * invisible. findHiddenFeatMatches computes the honest diff the picker now explains.
 */

const full = content();
// Core-only picker pool — exactly what the Builder computes for a fresh character (enabledSources absent).
const coreOnly = applySources(full, enabledBookSet(undefined), new Set());

const elfFighter: BuildState = {
  ...emptyBuild(),
  name: 't',
  level: 4,
  classId: 'fighter',
  ancestryId: 'elf',
  backgroundId: Object.keys(full.backgrounds)[0],
};

const ids = (feats: { id: string }[]) => new Set(feats.map((f) => f.id));

describe('feat-slot source visibility (the missing-feats bug)', () => {
  const ancestrySlot = { level: 1, category: 'ancestry' as const, idx: 0 };
  const classSlot = { level: 2, category: 'class' as const, idx: 0 };

  it('a non-Core ancestry feat is slot-eligible on the FULL pool but absent from the Core-only pool', () => {
    // Elven Aloofness — Advanced Player's Guide, elf ancestry feat, level 1.
    expect(full.feats['elven-aloofness']).toBeTruthy();
    expect(ids(eligibleFeatsForSlot(elfFighter, full, ancestrySlot)).has('elven-aloofness')).toBe(true);
    expect(ids(eligibleFeatsForSlot(elfFighter, coreOnly, ancestrySlot)).has('elven-aloofness')).toBe(false);
  });

  it('the default source filter hides a large share of feats (reproduces the report)', () => {
    expect(Object.keys(coreOnly.feats).length).toBeLessThan(Object.keys(full.feats).length / 2);
  });

  it('classifies a source-hidden slot-valid feat under `sources` with its book', () => {
    const shown = ids(eligibleFeatsForSlot(elfFighter, coreOnly, ancestrySlot));
    const slotEligible = ids(eligibleFeatsForSlot(elfFighter, full, ancestrySlot));
    const hidden = findHiddenFeatMatches({
      query: 'Elven Aloofness',
      allFeats: Object.values(full.feats),
      shownIds: shown,
      slotEligibleIds: slotEligible,
      enabledBooks: enabledBookSet(undefined),
      archetypesHidden: false,
    });
    expect(hidden).not.toBeNull();
    const src = hidden!.sources.find((f) => f.id === 'elven-aloofness');
    expect(src?.source?.book).toBe("Pathfinder Advanced Player's Guide");
  });

  it('the same query from a CLASS slot counts as not-valid-for-this-slot, not a source problem', () => {
    const shown = ids(eligibleFeatsForSlot(elfFighter, coreOnly, classSlot));
    const slotEligible = ids(eligibleFeatsForSlot(elfFighter, full, classSlot));
    const hidden = findHiddenFeatMatches({
      query: 'Elven Aloofness',
      allFeats: Object.values(full.feats),
      shownIds: shown,
      slotEligibleIds: slotEligible,
      enabledBooks: enabledBookSet(undefined),
      archetypesHidden: true,
    });
    expect(hidden).not.toBeNull();
    expect(hidden!.sources.some((f) => f.id === 'elven-aloofness')).toBe(false);
    expect(hidden!.invalid).toBeGreaterThan(0);
  });

  it('a Core archetype dedication hidden behind the class-slot Archetypes toggle counts as `archetype`', () => {
    // Wizard Dedication — Player Core (enabled), archetype trait, valid for a class slot, but the
    // picker hides archetype feats until the toggle is on.
    const shownFiltered = eligibleFeatsForSlot(elfFighter, coreOnly, classSlot).filter(
      (f) => !f.traits.includes('archetype'),
    );
    const hidden = findHiddenFeatMatches({
      query: 'Wizard Dedication',
      allFeats: Object.values(full.feats),
      shownIds: ids(shownFiltered),
      slotEligibleIds: ids(eligibleFeatsForSlot(elfFighter, full, classSlot)),
      enabledBooks: enabledBookSet(undefined),
      archetypesHidden: true,
    });
    expect(hidden).not.toBeNull();
    expect(hidden!.archetype).toBeGreaterThan(0);
    expect(hidden!.sources.some((f) => f.id === 'wizard-dedication')).toBe(false);
  });

  it('a non-Core archetype feat with Archetypes OFF is reported as `archetype`, not a disabled book', () => {
    // Aldori Duelist Dedication — Battlecry! (a book that is disabled by default), archetype + dedication.
    // In a class slot with the Archetypes toggle off, enabling the book alone can't reveal it (the
    // archetype filter still hides it), so the notice must tell the user to enable Archetypes.
    expect(full.feats['aldori-duelist-dedication']).toBeTruthy();
    const hidden = findHiddenFeatMatches({
      query: 'Aldori Duelist Dedication',
      allFeats: Object.values(full.feats),
      shownIds: new Set(), // picker shows nothing matching (book disabled + archetypes off)
      slotEligibleIds: ids(eligibleFeatsForSlot(elfFighter, full, classSlot)),
      enabledBooks: enabledBookSet(undefined), // Battlecry! NOT enabled
      archetypesHidden: true,
    });
    expect(hidden).not.toBeNull();
    expect(hidden!.archetype).toBeGreaterThan(0);
    // It must NOT be filed under `sources` (which would render an unhelpful "enable book" row).
    expect(hidden!.sources.some((f) => f.id === 'aldori-duelist-dedication')).toBe(false);
  });

  it('an empty query reports nothing', () => {
    expect(
      findHiddenFeatMatches({
        query: '   ',
        allFeats: Object.values(full.feats),
        shownIds: new Set(),
        slotEligibleIds: new Set(),
        enabledBooks: enabledBookSet(undefined),
        archetypesHidden: false,
      }),
    ).toBeNull();
  });

  it('feats the picker already shows are never reported hidden', () => {
    const shown = eligibleFeatsForSlot(elfFighter, coreOnly, ancestrySlot);
    const someShown = shown[0];
    const hidden = findHiddenFeatMatches({
      query: someShown.name,
      allFeats: Object.values(full.feats),
      shownIds: ids(shown),
      slotEligibleIds: ids(eligibleFeatsForSlot(elfFighter, full, ancestrySlot)),
      enabledBooks: enabledBookSet(undefined),
      archetypesHidden: false,
    });
    if (hidden) {
      expect(hidden.sources.some((f) => f.id === someShown.id)).toBe(false);
    }
  });
});

describe('eligibleFeatsForSlot basics (extracted from Builder)', () => {
  it('general slots accept skill feats; skill slots reject general-only feats', () => {
    const general = eligibleFeatsForSlot(elfFighter, coreOnly, { level: 3, category: 'general', idx: 0 });
    expect(general.some((f) => f.category === 'skill')).toBe(true);
    const skill = eligibleFeatsForSlot(elfFighter, coreOnly, { level: 2, category: 'skill', idx: 0 });
    expect(skill.every((f) => f.category === 'skill')).toBe(true);
  });

  it('ancestry slots are gated to the chosen ancestry by trait', () => {
    const anc = eligibleFeatsForSlot(elfFighter, coreOnly, { level: 1, category: 'ancestry', idx: 0 });
    expect(anc.length).toBeGreaterThan(0);
    expect(anc.every((f) => f.traits.includes('elf'))).toBe(true);
  });
});
