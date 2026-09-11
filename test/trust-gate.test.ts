/*
 * WHY THIS FILE EXISTS
 *
 * The trust gate (docs/trust-gate.md) is the one place in the app that DELETES rules. Everything about
 * it fails quietly: strip one path too many and a weapon loses its damage; strip one too few and an
 * unchecked rule still moves a number; mutate instead of copy and the switch can never turn the rules
 * back on, because `merge()` in src/data/index.ts hands out the same record objects the raw core holds.
 * None of those show up as an exception — they show up as a wrong number on someone's character.
 *
 * So this file is plan section 5(a)-(g), one test each, against the REAL public/core.json and the REAL
 * src/data/trust-ledger.json through `content({ trustGate: true })` — the same `applyTrustGate` call
 * the app makes, on the same object, at the same point in the pipeline.
 *
 * The fixtures are named records rather than "the first record with property X", because a search that
 * silently finds nothing is a test that silently proves nothing. Each was measured on 2026-09-10 and
 * the ledger entry it relies on is asserted before the behaviour is — with `toContain`, not equality,
 * so a regenerated ledger that turns MORE off on the same record fails only if the behaviour is wrong.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { applyTrustGate, TRUST_LEDGER, trustCensus, trustOff } from '../src/data/trustGate';
import { loadContent, rebuildContent } from '../src/data';
import { getPrefs, setPref } from '../src/data/prefs';

type Rec = Record<string, unknown>;
const ungated = () => content() as unknown as Record<string, Record<string, Rec>>;
const gated = () => content({ trustGate: true }) as unknown as Record<string, Record<string, Rec>>;

/** Every value a ledger path reaches ("choice.options[].grant.skills" maps over the option rows). */
function valuesAt(node: unknown, segs: string[]): unknown[] {
  if (node === null || typeof node !== 'object') return [];
  const head = segs[0];
  const isArr = head.endsWith('[]');
  const key = isArr ? head.slice(0, -2) : head;
  const child = (node as Rec)[key];
  if (child === undefined) return [];
  if (segs.length === 1) return [child];
  const rest = segs.slice(1);
  if (isArr) return Array.isArray(child) ? child.flatMap((el) => valuesAt(el, rest)) : [];
  return valuesAt(child, rest);
}
const has = (rec: unknown, path: string) => valuesAt(rec, path.split('.')).length > 0;

/* One parse, shared by the two tests that need a raw core rather than a merged database. */
const CORE = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, Rec>>;

describe('trust gate', () => {
  it('(a) strips a we-only path and keeps the WG-encoded one on the SAME record', () => {
    // Apparition Sense: WG encodes the sense, not the granted action. Per-path, not per-record.
    expect(TRUST_LEDGER.records['feats/apparition-sense']).toContain('grantsActions');
    expect(TRUST_LEDGER.records['feats/apparition-sense']).not.toContain('senses');
    const before = ungated().feats['apparition-sense'];
    const after = gated().feats['apparition-sense'];
    expect(before.grantsActions).toBeDefined();
    expect(after.grantsActions).toBeUndefined();
    expect(after.senses).toEqual(before.senses);
    expect(after.name).toBe(before.name);
    expect(after.description).toBe(before.description);
  });

  it('(b) a deity and a class record keep everything', () => {
    // Deities are ON by ruling Q2 and unpaired by construction; classes are the character chassis.
    const laned = Object.keys(TRUST_LEDGER.records).filter(
      (k) => k.startsWith('deities/') || k.startsWith('classes/') || k.startsWith('ancestries/') || k.startsWith('backgrounds/'),
    );
    expect(laned).toEqual([]);
    const deity = Object.keys(ungated().deities)[0];
    expect(gated().deities[deity]).toEqual(ungated().deities[deity]);
    expect(gated().classes.fighter).toEqual(ungated().classes.fighter);
    expect(gated().classes.cleric).toEqual(ungated().classes.cleric);
  });

  it('(c) a fully dark record keeps its text, its picker and every option row', () => {
    expect(TRUST_LEDGER.records['feats/advanced-domain']).toEqual(
      expect.arrayContaining(['choice.options[].grant.focusSpells', 'focusPoolBonus']),
    );
    const before = ungated().feats['advanced-domain'];
    const after = gated().feats['advanced-domain'];
    // The mechanics: a top-level path AND a nested option grant, both gone.
    expect(before.focusPoolBonus).toBe(1);
    expect(after.focusPoolBonus).toBeUndefined();
    expect(has(before, 'choice.options[].grant.focusSpells')).toBe(true);
    expect(has(after, 'choice.options[].grant.focusSpells')).toBe(false);
    // The record: everything the player reads or answers is untouched.
    expect(after.name).toBe(before.name);
    expect(after.description).toBe(before.description);
    expect(after.prerequisites).toEqual(before.prerequisites);
    expect(after.traits).toEqual(before.traits);
    expect(after.level).toBe(before.level);
    expect(after.rarity).toBe(before.rarity);
    expect(after.source).toEqual(before.source);
    const bChoice = before.choice as { prompt: string; options: Rec[] };
    const aChoice = after.choice as { prompt: string; options: Rec[] };
    expect(aChoice.prompt).toBe(bChoice.prompt);
    expect(aChoice.options.length).toBe(bChoice.options.length);
    expect(aChoice.options.map((o) => o.value)).toEqual(bChoice.options.map((o) => o.value));
    expect(aChoice.options.map((o) => o.label)).toEqual(bChoice.options.map((o) => o.label));
    // The row still asks the question; the answer now grants nothing.
    expect(aChoice.options[0].grant).toEqual({});

    // A second picker, whose rows carry their own description and requirement — both survive.
    expect(TRUST_LEDGER.records['feats/ancestral-longevity']).toContain('choice.options[].grant.skills');
    const bLong = (ungated().feats['ancestral-longevity'].choice as { options: Rec[] }).options[0];
    const aLong = (gated().feats['ancestral-longevity'].choice as { options: Rec[] }).options[0];
    expect(aLong.description).toBe(bLong.description);
    expect(aLong.requiresSkillRank).toEqual(bLong.requiresSkillRank);
    expect((bLong.grant as Rec).skills).toBeDefined();
    expect((aLong.grant as Rec).skills).toBeUndefined();
  });

  it('(d) an approvals entry brings a path back', () => {
    const approvals = JSON.parse(readFileSync('scripts/data/trust-approvals.json', 'utf8')) as {
      approvals: { record: string; fields: string[] }[];
    };
    // Spirit Walk: docs/trust-gate.md §7 names it as a paired record that shares no kind with WG, so
    // its resistance would go dark; the desk ruled on it the same week and the approval keeps it.
    const walk = approvals.approvals.find((a) => a.record === 'feats/spirit-walk');
    expect(walk?.fields).toContain('resistances');
    expect(TRUST_LEDGER.records['feats/spirit-walk']).toBeUndefined();
    expect(gated().feats['spirit-walk'].resistances).toEqual(ungated().feats['spirit-walk'].resistances);

    // …and the same holds for every approval whose record and field exist today: no ledger entry may
    // name an approved path. One loop is what keeps a future regeneration from quietly overriding the
    // desk (48 of the 49 entries resolve to a record; the 49th is a record a desk fix will create).
    let checked = 0;
    for (const a of approvals.approvals) {
      const off = TRUST_LEDGER.records[a.record] ?? [];
      const slash = a.record.indexOf('/');
      const rec = CORE[a.record.slice(0, slash)]?.[a.record.slice(slash + 1)];
      if (!rec) continue;
      for (const f of a.fields) {
        expect(off).not.toContain(f);
        if (has(rec, f)) checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('(e) round trip: the gate copies, and the ungated source is never touched', () => {
    const snapshot = structuredClone(CORE);
    const g = applyTrustGate(CORE);
    // "Gate off" IS this object: index.ts passes the raw core straight through when the switch is off.
    // So a source that still deep-equals its snapshot after a gated load is the whole round trip.
    expect(CORE).toEqual(snapshot);
    expect(g).not.toBe(CORE);
    // Copied where it changed…
    expect(g.feats['advanced-domain']).not.toBe(CORE.feats['advanced-domain']);
    expect(g.feats['advanced-domain'].focusPoolBonus).toBeUndefined();
    expect(CORE.feats['advanced-domain'].focusPoolBonus).toBe(1);
    // …by reference everywhere else, which is why running it on every rebuild is cheap.
    expect(g.spells).toBe(CORE.spells);
    expect(g.feats['spirit-walk']).toBe(CORE.feats['spirit-walk']);
  }, 60_000);

  it('(f) the side map lists exactly the stripped paths, and no record grows a key', () => {
    const g = applyTrustGate(CORE);
    let stripped = 0;
    for (const [key, paths] of Object.entries(TRUST_LEDGER.records)) {
      const slash = key.indexOf('/');
      const bucket = key.slice(0, slash);
      const id = key.slice(slash + 1);
      const before = CORE[bucket]?.[id];
      if (!before) continue;
      const after = g[bucket][id];
      const listed = trustOff(bucket, id) ?? [];
      for (const p of paths) {
        if (has(before, p)) {
          expect(listed).toContain(p);
          expect(has(after, p)).toBe(false);
          stripped++;
        } else {
          // A path the record never carried is not a strip and must not be claimed as one.
          expect(listed).not.toContain(p);
        }
      }
      expect(listed.length).toBe(paths.filter((p) => has(before, p)).length);
      // No synthetic key: the marker reads the side map, never a stamp on the record.
      for (const k of Object.keys(after)) expect(before).toHaveProperty(k);
      expect(after).not.toHaveProperty('_trust');
    }
    expect(stripped).toBeGreaterThan(1000);
  }, 60_000);

  it('(g) costs and prose survive on a dark record', () => {
    const b = ungated();
    const a = gated();
    // Demon Mask: its innate spell goes dark; the printed frequency and the spell's own note stay.
    expect(TRUST_LEDGER.records['items/demon-mask']).toContain('innateSpells');
    expect(TRUST_LEDGER.records['items/demon-mask']).not.toContain('spellNotes');
    expect(a.items['demon-mask'].innateSpells).toBeUndefined();
    expect(a.items['demon-mask'].frequency).toEqual(b.items['demon-mask'].frequency);
    expect(a.items['demon-mask'].spellNotes).toEqual(b.items['demon-mask'].spellNotes);
    // A wand: the spells it holds go dark, its uses and frequency (both LIMITS) do not.
    expect(TRUST_LEDGER.records['items/arboreal-wand-rank-2']).toContain('heldSpells');
    expect(a.items['arboreal-wand-rank-2'].heldSpells).toBeUndefined();
    expect(a.items['arboreal-wand-rank-2'].uses).toEqual(b.items['arboreal-wand-rank-2'].uses);
    expect(a.items['arboreal-wand-rank-2'].frequency).toEqual(b.items['arboreal-wand-rank-2'].frequency);
    // A dedication: the feat it hands over goes dark, the "no other dedication until…" gate does not.
    expect(TRUST_LEDGER.records['feats/jalmeri-heavenseeker-dedication']).toContain('grantsFeats');
    expect(TRUST_LEDGER.records['feats/jalmeri-heavenseeker-dedication']).not.toContain('dedicationGate');
    expect(a.feats['jalmeri-heavenseeker-dedication'].grantsFeats).toBeUndefined();
    expect(a.feats['jalmeri-heavenseeker-dedication'].dedicationGate).toEqual(
      b.feats['jalmeri-heavenseeker-dedication'].dedicationGate,
    );
    // Prose is not a mechanic.
    expect(a.feats['apparition-sense'].note).toBe(b.feats['apparition-sense'].note);
    /* `abilityFlaws` has no dark carrier to test on: it lives only on ancestries, and ancestries are
     * the character chassis, which is all-on (measured 2026-09-10: 0 of the 2,418 ledger records
     * carry it). So the assertion is that the flaw is there and untouched — which is also the check
     * that would fail first if the chassis exemption were ever dropped. */
    expect(a.ancestries.shoony.abilityFlaws).toEqual(b.ancestries.shoony.abilityFlaws);
    expect(Object.keys(TRUST_LEDGER.records).some((k) => k.startsWith('ancestries/'))).toBe(false);
  });

  it('a gated mode and a gated stance keep their toggle and lose their payload', () => {
    const b = ungated();
    const a = gated();
    const mode = 'aura-shield-the-faithful';
    expect(TRUST_LEDGER.lanes.modes).toContain(mode);
    expect((b.modes[mode].modifiers as unknown[]).length).toBeGreaterThan(0);
    expect(a.modes[mode].modifiers).toEqual([]);
    expect(a.modes[mode].resistances).toBeUndefined();
    expect(a.modes[mode].name).toBe(b.modes[mode].name);
    expect(a.modes[mode].note).toBe(b.modes[mode].note);
    expect(a.modes[mode].duration).toBe(b.modes[mode].duration);
    expect(a.modes[mode].feats).toEqual(b.modes[mode].feats);
    // A mode the gate does not name keeps its numbers.
    expect(a.modes['aura-marshal-dedication']).toEqual(b.modes['aura-marshal-dedication']);

    const stance = 'crane-stance';
    expect(TRUST_LEDGER.lanes.stances).toContain(stance);
    expect(b.stances[stance].strikes).toBeDefined();
    expect(a.stances[stance].strikes).toBeUndefined();
    expect(a.stances[stance].acBonus).toBeUndefined();
    expect(a.stances[stance].name).toBe(b.stances[stance].name);
    expect(a.stances[stance].note).toBe(b.stances[stance].note);
    expect(a.stances[stance].requires).toEqual(b.stances[stance].requires);
    expect(a.stances['arcane-cascade']).toEqual(b.stances['arcane-cascade']);
  });

  it('the census counts what the gate actually did', () => {
    applyTrustGate(CORE);
    const c = trustCensus();
    expect(c.stars).toBe(TRUST_LEDGER.lanes.situational.length);
    const touched = Object.keys(TRUST_LEDGER.records).filter((k) => {
      const slash = k.indexOf('/');
      return trustOff(k.slice(0, slash), k.slice(slash + 1)) !== undefined;
    }).length;
    expect(c.recordsOff + c.recordsPartly).toBe(touched);
    expect(c.recordsOff).toBeGreaterThan(0);
    expect(c.recordsPartly).toBeGreaterThan(0);
  }, 60_000);

  /*
   * THE WIRING, through the REAL loader — src/data/index.ts:mergeWithSeed and the pref behind it.
   *
   * Everything above proves `applyTrustGate`. None of it proves the APP CALLS IT: measured
   * 2026-09-10, deleting the gate call out of `mergeWithSeed` left this file, content-loader,
   * homebrew, trust-gate-smoke, trust-marker and trust-gate-stars all green — 67 passing tests over a
   * feature that was no longer running anywhere. So this one drives the loader itself, with a stubbed
   * fetch and a two-record core, and covers the three things only the loader has: the chokepoint, the
   * pref's default, and the switch (including `clearTrustGate`, without which the last gated load's
   * side map would still be answering the marker after the player turned the gate off).
   */
  it('the app gates inside mergeWithSeed, and the switch turns the rules back on', async () => {
    const was = getPrefs().trustGate;
    expect(TRUST_LEDGER.records['feats/advanced-domain']).toContain('focusPoolBonus');
    const focus = (db: { feats: Record<string, unknown> }) => (db.feats['advanced-domain'] as Rec).focusPoolBonus;
    const core = { feats: { 'advanced-domain': { id: 'advanced-domain', name: 'Advanced Domain', focusPoolBonus: 1 } } };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => core })));
    try {
      const db = await loadContent();
      // Descriptions land in a second fetch that re-merges; let it finish so nothing races the asserts.
      await new Promise((r) => setTimeout(r, 0));
      // The pref DEFAULTS to on, so a fresh install's very first load is already gated.
      expect(was).toBe(true);
      expect(focus(db)).toBeUndefined();
      // …and the fetched core itself is untouched, which is what lets the switch put the rule back.
      expect(core.feats['advanced-domain'].focusPoolBonus).toBe(1);
      expect(trustOff('feats', 'advanced-domain')).toContain('focusPoolBonus');

      setPref('trustGate', false);
      expect(focus(rebuildContent())).toBe(1);
      // clearTrustGate ran: the marker must not still be reporting the previous load's strips.
      expect(trustOff('feats', 'advanced-domain')).toBeUndefined();

      setPref('trustGate', true);
      expect(focus(rebuildContent())).toBeUndefined();
      expect(trustOff('feats', 'advanced-domain')).toContain('focusPoolBonus');
    } finally {
      setPref('trustGate', was);
      vi.unstubAllGlobals();
    }
  });
});
