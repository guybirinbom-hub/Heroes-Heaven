import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { openChoiceOptions } from '../src/rules/openChoice';
import { cantripBonusFor, emptyBuild } from '../src/rules/build';

/**
 * ADAPTED CANTRIP — "Choose one cantrip from a magical tradition other than your own… You can cast
 * this cantrip as a spell of your class's tradition."
 *
 * The answer used to be RECORDED AND NOTHING ELSE: the record's own `choice.inert` said so out loud
 * ("add it yourself"), and the picker offered every cantrip in the game because a static `traditions`
 * list cannot express "other than your own" — the legal set depends on the character's class.
 *
 * Three things had to be true at once for the feat to work and not over-work: the pick joins the
 * CLASS pool (not the innate one), the picker excludes the traditions this character already casts
 * in, and the total does not go up — "replace one of your cantrips known" is a swap, not a bonus.
 */
const db = content();
const CANTRIPS = ['light', 'shield', 'daze', 'prestidigitation', 'detect-magic', 'sigil'];
const wiz = (answer?: string, over: Record<string, unknown> = {}) =>
  build('wizard', 5, {
    cantrips: CANTRIPS,
    ...(answer ? { featPicks: { '2:class': 'adapted-cantrip' }, featChoices: { '2:class': answer } } : {}),
    ...over,
  });
const pool = (ch: ReturnType<typeof build>) => ch.spellcasting.find((e) => e.id === 'wizard-casting')!;

describe('the record asks a question the picker can answer', () => {
  it('the pick is no longer inert, and says what it does', () => {
    const ch = db.feats['adapted-cantrip'].choice!;
    expect(ch.from).toMatchObject({ type: 'spell', cantripsOnly: true, excludeOwnTraditions: true, grantToClassEntry: true });
    // `inert` documents a pick the app deliberately does not apply. This one applies now, and leaving
    // the marker would tell the player their answer does nothing.
    expect(ch.inert).toBeUndefined();
  });

  it("offers no cantrip of the character's own tradition, and is never emptied for a non-caster", () => {
    const arcane = openChoiceOptions(db.feats['adapted-cantrip'].choice!.from, db, { character: wiz() });
    expect(arcane.length).toBeGreaterThan(20);
    for (const o of arcane) expect(db.spells[o.id].traditions, o.id).not.toContain('arcane');
    // A fighter with Wizard Dedication meets the prerequisite through an ARCHETYPE entry; a fighter
    // with no class casting at all excludes nothing, so the picker still offers something.
    const fighter = openChoiceOptions(db.feats['adapted-cantrip'].choice!.from, db, { character: build('fighter', 5) });
    expect(fighter.length).toBeGreaterThan(arcane.length);
  });
});

describe('the answer lands somewhere the player can cast it', () => {
  it("joins the character's own class pool, attributed to the feat", () => {
    const ch = wiz('guidance');
    expect(pool(ch).cantrips).toContain('guidance');
    expect(pool(ch).spellSources?.['guidance']).toBe('Adapted Cantrip');
    // NOT the innate pool: the printed sentence casts it as a spell of the class's tradition, off that
    // entry's spell attack and DC.
    expect(ch.spellcasting.find((e) => e.type === 'innate')?.cantrips ?? []).not.toContain('guidance');
  });

  it('and not through a rank-0 repertoire key, which nothing reads', () => {
    /* `grantedRepertoire` is read only inside SpellsTab's leveled-rank loop, whose ranks come from
     * `Object.keys(entry.repertoire)` — rank 0 is unreachable there, so a marker written at rank 0
     * would be write-only AND would break the `granted ⊆ repertoire` invariant that the repertoire
     * mirror landed on. */
    const g = pool(wiz('guidance')).grantedRepertoire ?? {};
    expect(g[0]).toBeUndefined();
    for (const [rank, ids] of Object.entries(g))
      for (const id of ids) expect(pool(wiz('guidance')).repertoire?.[Number(rank)] ?? [], `granted ${id}`).toContain(id);
  });

  it('does nothing at all without an answer — including not charging for it', () => {
    // Both halves of a swap land together. The `-1` budget applied the moment the feat was picked,
    // so taking Adapted Cantrip and not yet answering its picker DELETED one of the player's own
    // cantrips and gave nothing back — a feat that costs you something and pays out later.
    const ch = build('wizard', 5, { cantrips: CANTRIPS, featPicks: { '2:class': 'adapted-cantrip' } });
    expect(pool(ch).cantrips).toEqual(pool(wiz()).cantrips);
  });

  it('and the BUILDER counts the same cantrips the sheet does', () => {
    /* The builder drew its own cap from its own copy of the reduce, so the page read "5 / 4" over a
     * set of picks `buildCharacter` was perfectly happy with — and that copy had drifted further: it
     * ignored the `cantripsAt` ladder entirely, which is how Flexible Spellcaster states its count. */
    const state = { ...emptyBuild(), classId: 'wizard', level: 5, cantrips: CANTRIPS };
    expect(cantripBonusFor({ ...state, featPicks: { '2:class': 'adapted-cantrip' } }, db)).toBe(0);
    expect(cantripBonusFor({ ...state, featPicks: { '2:class': 'adapted-cantrip' }, featChoices: { '2:class': 'guidance' } }, db)).toBe(-1);
    expect(cantripBonusFor({ ...state, featPicks: { '2:class': 'cantrip-expansion' } }, db)).toBe(2);
  });
});

describe('and it does not over-grant — "replace one of your cantrips known"', () => {
  it('the record carries the replacement as a budget, not as prose', () => {
    // Without this the feat would hand a caster cantripsKnown + 1, strictly better than the printed
    // rule; a note saying "remember to drop one" is not a mechanic.
    expect(db.feats['adapted-cantrip'].spellSlotBonus).toEqual({ cantrips: -1 });
  });

  it('a caster at their cap ends with the same number of cantrips, one of them the new one', () => {
    const plain = pool(wiz()).cantrips;
    const adapted = pool(wiz('guidance')).cantrips;
    expect(plain.length, 'the fixture must be AT the cap or this proves nothing').toBe(CANTRIPS.length);
    expect(adapted).toHaveLength(plain.length);
    expect(adapted).toContain('guidance');
    // The one displaced is the LAST the player picked — they choose what to give up by not picking it.
    expect(adapted).not.toContain(CANTRIPS[CANTRIPS.length - 1]);
  });
});
