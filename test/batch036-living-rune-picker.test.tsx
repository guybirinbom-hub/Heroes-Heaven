// @vitest-environment jsdom
/*
 * BATCH 036 — the Living Rune's crafter question as a CONTROL, not just a mechanic.
 *
 * The closer built the engine half of this lane (build.ts records the pick, derive.ts resolves it at
 * the bodyRune call site) and pinned it in test/batch036-closer.test.ts by writing
 * `effectChoices['energy-resistant:energy']` straight into a BuildState. That proves the reader. It
 * does not prove a player can ever produce that key: the only surface that writes it for a BODY rune
 * is the `<EffectChoicesPicker>` inside the Living Rune SetupCard in src/builder/shared.tsx, and
 * deleting that block left the whole batch green — the mechanic shipped with no way to answer it.
 *
 * The etched twin has had a real jsdom render since test/batch036-gap-rune-choice.test.tsx:42
 * (`renderDom(<ItemDetail …>)`). This is the same shape for the body-rune twin: render the builder
 * surface that HOSTS the picker (OriginPickers — the level-0 origins page, where the Living Rune card
 * lives), press the control the way a player does, and follow the answer through to the sheet.
 *
 * ⚠ Render OriginPickers, never EffectChoicesPicker directly. The component is exported and would
 *   still render perfectly with the Living Rune card's call site deleted, so a direct render proves
 *   the picker works and says nothing about whether it is mounted anywhere.
 */
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { OriginPickers, type BuilderActions } from '../src/builder/shared';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveDefenses } from '../src/rules/derive';

const db = content();
const anc = Object.keys(db.ancestries)[0];
const bg = Object.keys(db.backgrounds)[0];

/** The prompt the item record carries — items/energy-resistant, effectChoices[0].prompt. */
const PROMPT = "Choose the rune's energy type";

/** A Runescarred fighter carrying Energy-Resistant on his own flesh: the one shape with a body rune
 *  and no host inventory row to hang the crafter's answer on. */
const runescarred = (over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 't',
    level: 8,
    classId: 'fighter',
    ancestryId: anc,
    backgroundId: bg,
    keyAbility: 'str',
    featPicks: { '2:class:0': 'runescarred-dedication', '6:class:0': 'living-rune' },
    bodyRune: 'energy-resistant',
    ...over,
  }) as unknown as BuildState;

/** Render the origins page with a `patch` that records what the control writes. */
function page(build: BuildState) {
  const patches: Partial<BuildState>[] = [];
  const actions = { patch: (p: Partial<BuildState>) => patches.push(p) } as unknown as BuilderActions;
  const r = renderDom(<OriginPickers build={build} actions={actions} content={db} />);
  const control = [...r.host.querySelectorAll('[data-ctl="popup"]')].find(
    (el) => el.getAttribute('data-ctl-title') === PROMPT,
  );
  return { ...r, patches, control };
}

const resistances = (build: BuildState) => deriveDefenses(buildCharacter(build, db), db).resistances ?? [];

describe('batch 036 — the Living Rune card asks the energy-resistant crafter question on screen', () => {
  /*
   * Printed, AoN equipment-2788-2576: "You gain resistance 5 to acid, cold, electricity, or fire. The
   * crafter chooses the damage type when creating the rune." A body rune sits on no inventory row, so
   * the etched-rune control on the armour card (ItemDetail) can never reach it — this card is the only
   * place the question can be asked, and it must actually be asked.
   */
  // batch 036: energy-resistant
  it('runes/energy-resistant on the body renders a live control offering all four printed energy types', () => {
    const r = page(runescarred());
    expect(r.control, 'the Living Rune card mounts no crafter-choice control').toBeTruthy();
    expect(r.control!.getAttribute('data-ctl-options')).toBe('4');
    expect(r.control!.getAttribute('data-ctl-live')).toBe('4');
    expect(r.control!.getAttribute('data-ctl-state')).toBe('empty');
    expect(r.host.textContent).toContain(PROMPT);
    // Pressing it lists the four types the print names, each as its own selectable row.
    r.click(r.control!);
    for (const label of ['Acid resistance 5', 'Cold resistance 5', 'Electricity resistance 5', 'Fire resistance 5']) {
      expect(r.host.textContent).toContain(label);
    }
    r.stop();
  });

  /*
   * mutation-proof — the control, not the reader. Delete the `<EffectChoicesPicker>` block from the
   * Living Rune SetupCard in src/builder/shared.tsx and this `it` dies at the first expect: no popup
   * carries the prompt, so nothing can be pressed and the key the engine reads is unwritable. Every
   * other test in the batch stays green through that deletion, which is how the block shipped
   * unpinned in the first place. Adversarially confirmed by deleting the block and re-running.
   */
  // batch 036: energy-resistant
  it('choosing Fire writes energy-resistant:energy on the build, and the sheet resists fire instead of acid', () => {
    const start = runescarred();
    const r = page(start);
    r.click(r.control!);
    const fire = [...r.host.querySelectorAll('.picker-item')].find((b) => (b.textContent ?? '').includes('Fire resistance 5'));
    expect(fire, 'the crafter-choice popup offers no Fire row').toBeTruthy();
    r.click(fire!);
    r.stop();
    // The store key is `<runeId>:<choiceId>` — exactly what build.ts resolvePick reads for a body rune.
    const patched = Object.assign({}, ...r.patches) as Partial<BuildState>;
    expect(patched.effectChoices?.['energy-resistant:energy']).toBe('fire');
    // …and the answer the player just gave reaches the sheet, off the acid fallback.
    const res = resistances({ ...start, ...patched });
    expect(res.find((x) => x.type === 'fire')?.value).toBe(5);
    expect(res.some((x) => x.type === 'acid')).toBe(false);
    // The control is honest about the same build BEFORE the answer: acid 5, unanswered.
    expect(resistances(start).find((x) => x.type === 'acid')?.value).toBe(5);
  });
});
