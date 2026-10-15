import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { openChoiceOptions } from '../src/rules/openChoice';
import { cantripBonusFor, classCantripBonus, emptyBuild } from '../src/rules/build';

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
 * in, and a REPERTOIRE's total does not go up — "replace one of your cantrips known" is a swap, not a
 * bonus. A caster who PREPARES spells is the other half of the same sentence: *"you can choose this
 * spell when you prepare your cantrips, in addition to your other options"* — no swap, every opening
 * kept (test/adapted-cantrip-prepared.test.ts; the swap legs below moved from a wizard to a bard on
 * 2026-10-15, because they had asserted the swap on a prepared caster, the owner's bug).
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
/** A bard — a spell REPERTOIRE — at its five cantrips; electric arc is off the occult list. */
const BARD5 = ['daze', 'detect-magic', 'figment', 'light', 'message'];
const bard = (answer?: string, cantrips = BARD5) =>
  build('bard', 5, { cantrips, ...(answer ? { featPicks: { '2:class': 'adapted-cantrip' }, featChoices: { '2:class': answer } } : {}) });
const bardPool = (ch: ReturnType<typeof build>) => ch.spellcasting.find((e) => e.id === 'bard-casting')!;

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
    // Was > 20, counting 51 cantrips with no tradition at all (allegro, hexes, psi cantrips); print says
    // "from a magical tradition other than your own", so they are gone (2026-10-15, feat-4474) and an
    // arcane caster has 14 — test/adapted-cantrip-followups.test.ts holds that rule.
    expect(arcane.length).toBeGreaterThan(5);
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
    // A wizard with every opening filled prepares it OUT OF THE BOOK (not on top of the six) — see the
    // prepared leg below; a bard knows it outright.
    expect(pool(ch).bookCantrips).toContain('guidance');
    expect(pool(ch).spellSources?.['guidance']).toBe('Adapted Cantrip');
    expect(bardPool(bard('electric-arc')).cantrips).toContain('electric-arc');
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
    // cantrips and gave nothing back — a feat that costs you something and pays out later. A bard,
    // because only a repertoire is ever charged (a wizard is not charged at all now).
    const ch = build('bard', 5, { cantrips: BARD5, featPicks: { '2:class': 'adapted-cantrip' } });
    expect(bardPool(ch).cantrips).toEqual(bardPool(bard()).cantrips);
    expect(bardPool(ch).cantripCap).toBe(bardPool(bard()).cantripCap);
  });

  it('and the BUILDER counts the same cantrips the sheet does', () => {
    /* The builder drew its own cap from its own copy of the reduce, so the page read "5 / 4" over a
     * set of picks `buildCharacter` was perfectly happy with — and that copy had drifted further: it
     * ignored the `cantripsAt` ladder entirely, which is how Flexible Spellcaster states its count. */
    const state = { ...emptyBuild(), classId: 'wizard', level: 5, cantrips: CANTRIPS };
    expect(cantripBonusFor({ ...state, featPicks: { '2:class': 'adapted-cantrip' } }, db)).toBe(0);
    expect(cantripBonusFor({ ...state, featPicks: { '2:class': 'adapted-cantrip' }, featChoices: { '2:class': 'guidance' } }, db)).toBe(-1);
    expect(cantripBonusFor({ ...state, featPicks: { '2:class': 'cantrip-expansion' } }, db)).toBe(2);
    // …and the per-class answer both surfaces read: the swap is the repertoire's alone.
    const answered = { featPicks: { '2:class': 'adapted-cantrip' }, featChoices: { '2:class': 'guidance' } };
    expect(classCantripBonus({ ...state, ...answered }, db, 'wizard'), 'a wizard prepares: no swap').toBe(0);
    expect(classCantripBonus({ ...state, classId: 'bard', ...answered }, db, 'bard'), 'a bard swaps').toBe(-1);
  });
});

describe('and it does not over-grant — "replace one of your cantrips known"', () => {
  it('the record carries the replacement as a budget, not as prose', () => {
    // Without this the feat would hand a caster cantripsKnown + 1, strictly better than the printed
    // rule; a note saying "remember to drop one" is not a mechanic.
    expect(db.feats['adapted-cantrip'].spellSlotBonus).toEqual({ cantrips: -1 });
  });

  it('a repertoire at its cap ends with the same number of cantrips, one of them the new one', () => {
    const plain = bardPool(bard()).cantrips;
    const adapted = bardPool(bard('electric-arc')).cantrips;
    expect(plain.length, 'the fixture must be AT the cap or this proves nothing').toBe(BARD5.length);
    expect(db.spells['electric-arc']?.traditions, 'fixture: off the occult list').not.toContain('occult');
    expect(adapted).toHaveLength(plain.length);
    expect(adapted).toContain('electric-arc');
    // The one displaced is the LAST the player picked — they choose what to give up by not picking it.
    expect(adapted).not.toContain(BARD5[BARD5.length - 1]);
  });

  it('…and a caster who PREPARES keeps all of them, the new one beside them', () => {
    // *"If you prepare spells, you can choose this spell when you prepare your cantrips, in addition to
    // your other options"* — the wizard's six stay prepared, guidance is one more in the book to choose from.
    const ch = wiz('guidance');
    const adapted = pool(ch);
    expect(adapted.cantripCap).toBe(pool(wiz()).cantripCap);
    expect(adapted.cantrips).toEqual(CANTRIPS);
    expect(adapted.bookCantrips).toContain('guidance');
    expect(ch.spellListAdditions?.['wizard-casting']).toContain('guidance');
  });
});
