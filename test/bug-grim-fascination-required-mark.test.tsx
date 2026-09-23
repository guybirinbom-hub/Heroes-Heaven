// @vitest-environment jsdom
/*
 * A REQUIRED CHOICE THAT IS COUNTED BUT NOT MARKED.
 *
 * `levelChoices` already counted the necromancer's Grim Fascination with `required: true` — the level
 * chip went amber, the page header read "3 choices left" and the Create/Save confirmation listed it.
 * What the page did not do was say WHICH three: the subclass row and the ancestry-feat row each drew
 * the `!` that `.lvl-pending` renders, and the Grim Fascination row drew nothing. Measured in the dev
 * preview before the fix: `[{Grim Fascination, pending:false}, {Choose your grim fascination…,
 * pending:false}, {Fatal Method, pending:true}, {Ancestry feat, pending:true}]`.
 *
 * The marker's predicate is the same one `levelChoices` counts by — unanswered AND not self-answering
 * — so the count and the markers cannot disagree. Both halves are asserted here.
 */
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { EffectChoicesPicker, type BuilderActions } from '../src/builder/shared';
import { levelChoices, emptyBuild, type BuildState } from '../src/rules/build';

const db = content();
const KEY = 'grim-fascination:grim-fascination';

const necro = (over: Partial<BuildState> = {}): BuildState =>
  ({ ...emptyBuild(), name: 't', level: 1, classId: 'necromancer', keyAbility: 'int', ...over }) as unknown as BuildState;

function marks(build: BuildState) {
  const actions = { patch: () => undefined } as unknown as BuilderActions;
  const r = renderDom(
    <EffectChoicesPicker
      recordId="grim-fascination"
      choices={db.classFeatures['grim-fascination']?.effectChoices}
      build={build}
      actions={actions}
      content={db}
    />,
  );
  return r.host.querySelectorAll('.lvl-pending').length;
}

describe('the necromancer\'s Grim Fascination row is marked required', () => {
  it('draws the `!` while it is unanswered', () => {
    expect(marks(necro())).toBe(1);
  });

  it('drops the `!` once it is answered', () => {
    expect(marks(necro({ effectChoices: { [KEY]: 'bone' } } as Partial<BuildState>))).toBe(0);
  });

  it('the marker and the outstanding-choices count agree', () => {
    const counted = (b: BuildState) =>
      levelChoices(b, db).filter((m) => m.label === 'Level 1 — Grim Fascination — choose').length;
    expect(counted(necro())).toBe(marks(necro()));
    const answered = necro({ effectChoices: { [KEY]: 'bone' } } as Partial<BuildState>);
    expect(counted(answered)).toBe(marks(answered));
  });
});
