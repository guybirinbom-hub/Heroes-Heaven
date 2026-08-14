import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { applyPlayState, initialPlay, setSignatureSpells } from '../src/rules/play';

/**
 * A SPELL A FEAT GRANTS INTO A REPERTOIRE HAS TO APPEAR ON THE SPELLS PAGE.
 *
 * `grantedRepertoire` is a MARKER, not a store. SpellsTab renders rows from `entry.repertoire` and
 * reads `grantedRepertoire` only to keep granted ids out of the known-spells count and to lock their
 * remove button. The class path has always unioned granted ids into `repertoire`; the two feat paths
 * wrote the marker alone — so a granted spell was known, counted against nothing, locked, and
 * rendered nowhere. Four records grant this way and all four were invisible.
 */
const c = () => content();

describe('a feat-granted repertoire spell', () => {
  it('lands in the repertoire the page actually renders, not only in the granted marker', () => {
    const con = c();
    const ch = build('animist', 4, { featPicks: { '2:class:0': 'embodiment-of-the-balance' } });
    expect(ch.feats.some((f) => f.featId === 'embodiment-of-the-balance')).toBe(true);
    const entry = ch.spellcasting.find((e) => Object.values(e.grantedRepertoire ?? {}).flat().includes('heal'));
    expect(entry, 'no entry received the grant at all').toBeTruthy();
    const rank = con.spells['heal'].rank ?? 1;
    expect(entry!.grantedRepertoire?.[rank] ?? []).toContain('heal');
    // …and this is the half that was missing.
    expect(entry!.repertoire?.[rank] ?? []).toContain('heal');
  });

  it('holds the invariant across every entry: granted is a subset of repertoire', () => {
    for (const [cls, lvl, picks] of [
      ['animist', 4, { '2:class:0': 'embodiment-of-the-balance' }],
      ['animist', 6, { '4:class:0': 'walk-the-wilds' }],
    ] as const) {
      const ch = build(cls, lvl, { featPicks: picks });
      for (const e of ch.spellcasting) {
        for (const [rankStr, ids] of Object.entries(e.grantedRepertoire ?? {})) {
          for (const id of ids) {
            expect(`${e.id} rank ${rankStr}: ${id} in repertoire? ${(e.repertoire?.[Number(rankStr)] ?? []).includes(id)}`).toBe(
              `${e.id} rank ${rankStr}: ${id} in repertoire? true`,
            );
          }
        }
      }
    }
  });
});

/**
 * A SIGNATURE SPELL A RECORD GRANTED IS NOT THE PLAYER'S TO UN-STAR.
 *
 * applyPlayState read `play.signatureSpells?.[id] ?? e.signature`, so the moment an entry had a stored
 * list at all the authored one stopped being consulted — permanently, including any the record gained
 * later. An animist's apparition entry has its WHOLE repertoire authored as signature.
 */
describe('granted signature spells', () => {
  /* The fixture is SYNTHETIC, deliberately. Only two code paths author an entry signature today — the
   * animist apparition entries — and in the test content their repertoire is empty, so no shipped
   * build produces one. That is exactly why this bug was latent: nothing could reach it. The Halcyon
   * merge is what makes it live (Vellumis Excision authors a signature on a halcyon entry, and a bard
   * can take that archetype), so the merge is pinned here BEFORE the record that trips it exists. */
  const withAuthoredSignature = () => {
    const ch = build('bard', 8);
    const i = ch.spellcasting.findIndex((e) => e.type === 'spontaneous');
    expect(i, 'the bard fixture lost its spontaneous entry').toBeGreaterThanOrEqual(0);
    const e = ch.spellcasting[i];
    const authored = (e.repertoire?.[1] ?? []).slice(0, 1);
    expect(authored.length, 'the bard fixture has no rank-1 repertoire to mark').toBe(1);
    return {
      ch: { ...ch, spellcasting: ch.spellcasting.map((x, j) => (j === i ? { ...x, signature: authored } : x)) },
      entryId: e.id,
      authored,
    };
  };

  it('survive the player storing their own ★ list', () => {
    const con = c();
    const { ch, entryId, authored } = withAuthoredSignature();

    // The player stars something else on that entry — this used to discard the authored list outright.
    const chosen = (ch.spellcasting.find((e) => e.id === entryId)!.repertoire?.[2] ?? []).slice(0, 1);
    const live = applyPlayState(ch, setSignatureSpells(initialPlay(ch, con), entryId, chosen), con);
    const after = live.spellcasting.find((e) => e.id === entryId)!;

    for (const id of authored) expect(after.signature ?? []).toContain(id);
    for (const id of chosen) expect(after.signature ?? []).toContain(id);
    // and the UI needs to know which ones its ★ must refuse to unset
    expect(after.signatureFixed ?? []).toEqual(authored);
  });

  it('cannot be dropped even by a ★ list that omits them entirely', () => {
    const con = c();
    const { ch, entryId, authored } = withAuthoredSignature();
    const live = applyPlayState(ch, setSignatureSpells(initialPlay(ch, con), entryId, []), con);
    expect(live.spellcasting.find((e) => e.id === entryId)!.signature ?? []).toEqual(authored);
  });

  it('leaves an entry with no granted signature exactly as the player set it', () => {
    const con = c();
    const ch = build('bard', 8);
    const entry = ch.spellcasting.find((e) => e.type === 'spontaneous' && !(e.signature?.length));
    if (!entry) return;
    const live = applyPlayState(ch, setSignatureSpells(initialPlay(ch, con), entry.id, ['x', 'y']), con);
    const after = live.spellcasting.find((e) => e.id === entry.id)!;
    expect(after.signature).toEqual(['x', 'y']);
    expect(after.signatureFixed).toBeUndefined();
  });
});
