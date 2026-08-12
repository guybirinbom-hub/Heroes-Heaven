// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SkillEditor, PopupSelect, type BuilderActions } from '../src/builder/shared';
import { AlchemyPanel } from '../src/sheet/AlchemyPanel';
import { emptyBuild, buildCharacter, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * UNPICKABLE MUST LOOK UNPICKABLE — gold-set Q27.
 *
 * > "when I can choose a skill to be trained in it shows me options I'm already trained in. It
 * > doesn't let me pick them like it should, but there isn't any point in showing them — the user is
 * > just annoyed. Instead I want them greyed out."
 *
 * Every assertion below is deliberately made against the RENDERED NODE — the option is present, it
 * carries `disabled`, and it prints the reason — because the defect class this guards is exactly
 * "the predicate is right and the pixel doesn't show it". A test that only asked whether some
 * function returns false would have passed the entire time the bug was live.
 */
const c = () => content();
const noop = () => undefined;

/** Every option row inside an open picker, whichever of the two row shapes it uses. */
function options(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.picker-item, .pick-row')];
}
const rowFor = (host: HTMLElement, name: string) =>
  options(host).find((el) => (el.querySelector('.picker-name')?.textContent ?? '').trim().startsWith(name));
/** True when this row's own action is disabled — the button on a pick-row, the row itself otherwise. */
const isDisabled = (row: HTMLElement) =>
  row.classList.contains('pick-row')
    ? !!row.querySelector<HTMLButtonElement>('.pick-add')?.disabled
    : !!(row as HTMLButtonElement).disabled;
const why = (row: HTMLElement) => row.querySelector('.picker-why')?.textContent ?? '';

/** Open the one card-style picker inside a SkillEditor / SubCard render. */
function openPicker(r: ReturnType<typeof renderDom>, sel = 'button.lvl-card, button.popsel') {
  const btn = r.host.querySelector<HTMLButtonElement>(sel);
  r.click(btn);
}

describe('the reported bug: a trained-skill picker showing skills you already have', () => {
  it('greys the skill a cleric’s deity already trained, and names the source', () => {
    // Kostchtchie's clerics are trained in Athletics. buildCharacter LOCKS that skill, so a free
    // class-skill pick spent on it is silently discarded — and the picker offered it as though live.
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'cleric',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      keyAbility: 'wis',
      deityId: 'kostchtchie',
    };
    const ch = buildCharacter(b, c());
    expect(ch.grantedSkills?.athletics).toBe('your deity');

    const actions = { toggleSkill: noop } as unknown as BuilderActions;
    const r = renderDom(<SkillEditor build={b} actions={actions} content={c()} character={ch} />);
    openPicker(r);
    const row = rowFor(r.host, 'Athletics');
    // Shown — not filtered away. That is the owner's ruling: greyed, not hidden.
    expect(row).toBeTruthy();
    expect(isDisabled(row!)).toBe(true);
    expect(why(row!)).toContain('Already trained');
    expect(why(row!)).toContain('your deity');
    // …and a skill nothing has granted is still perfectly live beside it.
    const live = rowFor(r.host, 'Acrobatics')!;
    expect(isDisabled(live)).toBe(false);
    expect(why(live)).toBe('');
    r.stop();
  });

  it('does not grey a skill the character is trained in by a source that does NOT block the pick', () => {
    // A plain fighter: nothing is locked, so every skill in the picker must stay live.
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'fighter',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      keyAbility: 'str',
    };
    const ch = buildCharacter(b, c());
    const actions = { toggleSkill: noop } as unknown as BuilderActions;
    const r = renderDom(<SkillEditor build={b} actions={actions} content={c()} character={ch} />);
    openPicker(r);
    // Religion comes from the background, which DOES lock it…
    expect(isDisabled(rowFor(r.host, 'Religion')!)).toBe(true);
    // …Athletics comes from nowhere, and must not be greyed by association.
    expect(isDisabled(rowFor(r.host, 'Athletics')!)).toBe(false);
    r.stop();
  });
});

describe('a feat’s skill-training grant does not offer a skill it cannot raise', () => {
  const dedicationBuild = (over: Partial<BuildState> = {}): BuildState => ({
    ...emptyBuild(),
    name: 't',
    level: 2,
    classId: 'fighter',
    ancestryId: 'human',
    backgroundId: 'acolyte',
    keyAbility: 'str',
    featPicks: { '2:class:0': 'rogue-dedication' },
    ...over,
  });

  /** Open level 2, then the picker inside the SubCard whose label is `label`. */
  function openFeatSubPicker(r: ReturnType<typeof renderDom>, label: string, which = 0) {
    const lvl = [...r.host.querySelectorAll<HTMLButtonElement>('button')].find((x) => (x.textContent ?? '').trim() === '2');
    r.click(lvl ?? null);
    const cards = [...r.host.querySelectorAll<HTMLElement>('.lvl-subcard')].filter((el) =>
      (el.textContent ?? '').includes(label),
    );
    const card = cards[which] ?? cards[0];
    r.click(card?.querySelector('button.popsel, button.lvl-card') ?? null);
  }

  it('greys a skill that is already trained, saying so, and leaves the untrained one live', () => {
    // Rogue Dedication's second slot is "a skill of your choice". The background trained Religion,
    // so choosing it would write `trained` over `trained` and buy nothing at all.
    const b = dedicationBuild();
    const r = renderDom(<Builder content={c()} initial={b} onCancel={noop} onCreate={noop} />);
    openFeatSubPicker(r, 'Trained skill', 1);
    const dead = rowFor(r.host, 'Religion');
    expect(dead).toBeTruthy();
    expect(isDisabled(dead!)).toBe(true);
    expect(why(dead!)).toContain('would change nothing');
    expect(isDisabled(rowFor(r.host, 'Survival')!)).toBe(false);
    r.stop();
  });

  it('keeps an already-trained option LIVE when a later upgrade redeems it (Q21)', () => {
    // Nantambu Chime-Ringer: "trained in Arcana or Occultism; EXPERT if you are already trained".
    // Greying the already-trained option here would deny the feat its whole point — the same shape
    // as Canny Acumen, which the owner ruled must never be filtered.
    // The slot is ANSWERED with Occultism, so Arcana is judged on its own standing: trained from the
    // wizard's class list, and therefore worth expert here — the option must stay live.
    const b = dedicationBuild({
      level: 2,
      classId: 'wizard',
      keyAbility: 'int',
      featPicks: { '2:class:0': 'nantambu-chime-ringer-dedication' },
      featSkillChoices: { 'nantambu-chime-ringer-dedication:0': 'occultism' },
    });
    const ch = buildCharacter(b, c());
    expect(ch.proficiencies.skills.arcana).toBe('trained'); // the wizard's own class skill
    const r = renderDom(<Builder content={c()} initial={b} onCancel={noop} onCreate={noop} />);
    openFeatSubPicker(r, 'Trained skill');
    const arcana = rowFor(r.host, 'Arcana');
    expect(arcana).toBeTruthy();
    expect(isDisabled(arcana!)).toBe(false);
    r.stop();
  });

  it('greys a maxed skill increase, and one the level cannot reach yet, and says which', () => {
    // Religion (trained from the background) taken at 3 → expert, 7 → master, 15 → legendary. By
    // level 19 it has nowhere left to go, and Athletics — untrained — cannot jump past trained.
    const b = dedicationBuild({
      level: 19,
      featPicks: {},
      skillIncreases: { 3: 'religion', 7: 'religion', 15: 'religion' },
    });
    const r = renderDom(<Builder content={c()} initial={b} onCancel={noop} onCreate={noop} />);
    const lvl = [...r.host.querySelectorAll<HTMLButtonElement>('button')].find((x) => (x.textContent ?? '').trim() === '19');
    r.click(lvl ?? null);
    const card = [...r.host.querySelectorAll<HTMLElement>('.lvl-card')].find((el) => (el.textContent ?? '').includes('Skill increase'));
    r.click(card?.querySelector('button.popsel') ?? null);
    const maxed = rowFor(r.host, 'Religion');
    expect(maxed).toBeTruthy();
    expect(isDisabled(maxed!)).toBe(true);
    expect(why(maxed!)).toContain('legendary');
    // A skill with room to grow stays live, so the greying is a statement about THAT row.
    expect(isDisabled(rowFor(r.host, 'Athletics')!)).toBe(false);
    r.stop();
  });
});

describe('the shared treatment is one treatment', () => {
  const opts = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', disabled: true, disabledReason: 'Already yours.' },
  ];

  it('greys + explains a plain option row', () => {
    const r = renderDom(<PopupSelect value="" onChange={noop} options={opts} />);
    openPicker(r, '.popsel');
    const row = rowFor(r.host, 'Beta')!;
    expect(isDisabled(row)).toBe(true);
    expect(why(row)).toBe('Already yours.');
    expect(row.getAttribute('title')).toBe('Already yours.');
    r.stop();
  });

  it('greys + explains a read-first option row, with the SAME classes', () => {
    // An option carrying a description renders through PickerRow instead. Both shapes must land on
    // the same `.picker-why` line and the same greyed row, or "greyed out" means two things.
    const withDesc = opts.map((o) => ({ ...o, description: `About ${o.label}` }));
    const r = renderDom(<PopupSelect value="" onChange={noop} options={withDesc} />);
    openPicker(r, '.popsel');
    const row = rowFor(r.host, 'Beta')!;
    expect(row.classList.contains('dim')).toBe(true);
    expect(isDisabled(row)).toBe(true);
    expect(why(row)).toBe('Already yours.');
    r.stop();
  });
});

describe('the sheet’s spend-a-resource pickers', () => {
  it('greys every Prepare row once the day’s alchemy budget is spent', () => {
    const ch = buildCharacter(
      { ...emptyBuild(), name: 't', level: 1, classId: 'alchemist', ancestryId: 'human', backgroundId: 'acolyte', keyAbility: 'int' },
      c(),
    );
    const budget = ch.advancedAlchemy?.max ?? 4;
    // A day's preparations already at the maximum: setAlchemyItem's guard now bails on every row.
    const spent: Character = { ...ch, alchemyPrep: { 'alchemists-fire-lesser': budget } };
    const live = applyPlayState(spent, initialPlay(spent, c()), c());
    const r = renderDom(<AlchemyPanel character={{ ...live, alchemyPrep: { 'alchemists-fire-lesser': budget } }} content={c()} onPlay={noop} />);
    r.click([...r.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Prepare item')) ?? null);
    const rows = options(r.host);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(isDisabled(row)).toBe(true);
      expect(why(row)).toContain('daily maximum');
    }
    r.stop();
  });
});
