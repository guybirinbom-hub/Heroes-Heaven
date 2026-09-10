import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveEidolon, LANGUAGE_UNCHOSEN } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import type { CompanionConfig } from '../src/rules/types';

/*
 * BATCH 035 gaps, engine-1 family — the four CROSS-FILE lines the engine-1 chunk filed against
 * src/rules/companionGrants.ts and src/rules/companions.ts, which were outside its own file grant.
 *
 * Every assertion runs on a BUILT summoner through the same deriveEidolon route the sheet's
 * Companions tab uses, so the pin is on the player-visible block and not on the table literal alone.
 */

const eidolonBlock = (typeId: string, level = 5) => {
  const c = content();
  const ch = build('summoner', level, { subclassId: typeId });
  const cfg: CompanionConfig = { id: `c-${typeId}`, kind: 'eidolon', name: 'Test Eidolon', typeId, eidolon: {} };
  return deriveEidolon(cfg, ch, c);
};

describe('batch 035 gap — plant-eidolon speaks the language print names', () => {
  // batch 035: plant-eidolon#language
  // AoN eidolon-9 (the page this record cites): "**Language** Sylvan" — a fixed ANSWER, not a pick.
  // The row carried senses and a note but no `languages`, so the block showed no Languages line.
  it('plant-eidolon shows Sylvan on the block, with no unanswered pick', () => {
    expect(COMPANION_MODS['plant-eidolon'].languages).toEqual(['Sylvan']);
    expect(COMPANION_MODS['plant-eidolon'].languageChoices).toBeUndefined();
    const b = eidolonBlock('plant-eidolon');
    expect(b.languages).toEqual(['Sylvan']);
    expect(b.languages).not.toContain(LANGUAGE_UNCHOSEN);
  });

  // batch 035: plant-eidolon#language
  // The printed NAME, not an id: our language table is remaster-only ('fey', 'muan') and has no
  // 'sylvan' record, so deriveEidolon's `content.languages?.[l]?.name ?? l` must fall through to the
  // string as written. This pins WHY the entry is spelled "Sylvan" and not "sylvan" — the id form
  // would print the raw token to the player the day someone "tidies" it.
  it('plant-eidolon carries the printed name because no sylvan language record exists', () => {
    expect(content().languages?.['sylvan']).toBeUndefined();
  });
});

describe('batch 035 gap — swarm-eidolon speaks Common and takes area damage', () => {
  // batch 035: swarm-eidolon#language
  // AoN eidolon-13: "**Language** Common". The swarm type had no COMPANION_MODS row at all — its
  // package lives in the companions.ts TYPE_PACKAGE literal, which carries no language field — so
  // the printed line reached the player as description prose only.
  it('swarm-eidolon shows Common on the block', () => {
    expect(COMPANION_MODS['swarm-eidolon'].languages).toEqual(['common']);
    const b = eidolonBlock('swarm-eidolon');
    expect(b.languages).toEqual([content().languages['common'].name]);
    expect(b.languages).not.toContain(LANGUAGE_UNCHOSEN);
  });

  // batch 035: swarm-eidolon#language
  // The row carries `languages` and NOTHING else on purpose. deriveEidolon merges the TYPE_PACKAGE
  // entry AND this row, and `evoIwr.push(...)` does not dedupe (evoSenses does), so a copy of the
  // package's iwr here would print the immunity twice. Pinned because the duplicate would be
  // invisible to a reader of either file on its own.
  it('swarm-eidolon lists its grabbed/prone/restrained immunity exactly once', () => {
    const iwr = eidolonBlock('swarm-eidolon').iwr ?? [];
    expect(iwr.filter((l) => l === 'immune grabbed, prone, restrained')).toHaveLength(1);
    expect(COMPANION_MODS['swarm-eidolon'].iwr).toBeUndefined();
    expect(COMPANION_MODS['swarm-eidolon'].senses).toBeUndefined();
  });

  // batch 035: swarm-eidolon#area-weakness
  // AoN eidolon-13, Swarm Form: "it's immune to the grabbed, prone, and restrained conditions … It
  // has weakness to area damage equal to its level." The immunities from that sentence shipped and
  // the weakness did not, because a static TYPE_PACKAGE string cannot scale with level. Two levels,
  // so the assertion pins a computation and not a constant.
  it('swarm-eidolon has weakness to area damage equal to its level', () => {
    expect(eidolonBlock('swarm-eidolon', 5).iwr).toContain('weakness 5 area damage');
    expect(eidolonBlock('swarm-eidolon', 12).iwr).toContain('weakness 12 area damage');
  });

  // batch 035: swarm-eidolon#area-weakness
  // The weakness is the SWARM's, not every eidolon's — the push is gated on cfg.typeId and nothing
  // else, and this is the guard that the gate is still there.
  it('swarm-eidolon area weakness reaches no other eidolon type', () => {
    for (const other of ['undead-eidolon', 'plant-eidolon', 'dragon-eidolon']) {
      expect((eidolonBlock(other).iwr ?? []).join(' | ')).not.toContain('area damage');
    }
  });
});

describe('batch 035 gap — undead-eidolon speaks Necril', () => {
  // batch 035: undead-eidolon#language
  // AoN eidolon-11 and its remaster twin eidolon-26 both print "**Language** Necril". The type had
  // no COMPANION_MODS row, only the companions.ts TYPE_PACKAGE senses/note entry, so
  // eidolonLanguages stayed empty and the Languages line was omitted from the block.
  it('undead-eidolon shows Necril on the block, resolved through the language table', () => {
    expect(COMPANION_MODS['undead-eidolon'].languages).toEqual(['necril']);
    expect(content().languages['necril'].name).toBe('Necril');
    expect(eidolonBlock('undead-eidolon').languages).toEqual(['Necril']);
  });

  // batch 035: undead-eidolon#language
  // The row adds no senses, so the TYPE_PACKAGE darkvision and the Negative Essence note stay the
  // single source of both and cannot be doubled.
  it('undead-eidolon keeps its darkvision and Negative Essence note exactly once', () => {
    const b = eidolonBlock('undead-eidolon');
    expect((b.senses ?? []).filter((s) => s === 'darkvision')).toHaveLength(1);
    expect((b.evoNotes ?? []).filter((n) => n.startsWith('Negative Essence'))).toHaveLength(1);
  });
});

/*
 * The Player Core 2 instinct mis-join, the other half of work/.b035-rows-gap-engine-1.json.
 *
 * The rows are NOT applied yet (the driver applies the spec), so every assertion below runs on a
 * content copy PATCHED IN MEMORY with the corrected join — never a patched-vs-shipped delta that
 * would flip once the rows land.
 */
describe('batch 035 gap — animal-instinct#edition: the four Player Core 2 sibling instincts', () => {
  const SIBLINGS: Record<string, string> = {
    'giant-instinct': 'instinct-11',
    'spirit-instinct': 'instinct-12',
    'superstition-instinct': 'instinct-13',
    'animal-instinct': 'instinct-8',
  };

  // batch 035: animal-instinct#edition
  // The finding's own proposal: "The same mislink is on its four siblings sourced to Player Core 2 …
  // fix them in the same pass so the print-read lane stops being pointed at the CRB text." This pins
  // the premise the rows rest on — every one of the four says Player Core 2 in its own source.book
  // while citing a Core Rulebook / APG aonId.
  it('every animal-instinct sibling is a Player Core 2 record citing a pre-remaster page', () => {
    const cf = content().classFeatures;
    /* WAS: "…toContain(cf[id].aonId)" over the five pre-remaster ids, asserting the mislink was still
     * there. That was a claim about a spec that had not been applied yet, and the driver has since
     * applied it — so the same line now asserts a defect this batch fixed. Flipped to the state the
     * rows produce, which is what the record must hold from here on: its own Player Core 2 page, and
     * the `edition` the AST backfill derives from that page. */
    // batch 035: animal-instinct#edition
    for (const [id, aonId] of Object.entries(SIBLINGS)) {
      expect(cf[id].source?.book).toBe('Pathfinder Player Core 2');
      expect(cf[id].aonId).toBe(aonId);
      expect(cf[id].edition).toBe('remaster');
      expect(['instinct-1', 'instinct-3', 'instinct-4', 'instinct-5', 'instinct-6']).not.toContain(cf[id].aonId);
    }
  });

  // batch 035: animal-instinct#edition
  // With the rows applied the record is a remaster record citing its own PC2 page. Asserted on a
  // PATCHED copy: the spec is the durable route and the driver applies it, so this test states what
  // the rows must produce without depending on whether they have landed yet.
  it('animal-instinct and its siblings read as remaster once the rows are applied', () => {
    const cf = content().classFeatures;
    for (const [id, aonId] of Object.entries(SIBLINGS)) {
      const patched = { ...cf[id], aonId, edition: 'remaster' };
      expect(patched.edition).toBe('remaster');
      expect(patched.aonId).toBe(aonId);
      // the join now agrees with the record's own printing
      expect(patched.source?.book).toBe('Pathfinder Player Core 2');
    }
  });
});
