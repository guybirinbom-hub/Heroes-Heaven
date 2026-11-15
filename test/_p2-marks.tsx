/*
 * THE ZERO-MARKS SWEEP (Tweaks phase 2, plan WP2): a character with no tweak that names a pick never shows a Tweak
 * mark. `marksIn` mounts the Builder on one build and counts `[data-tweak-mark]` on Setup and on every level page;
 * `sweepCharacters` picks the characters: every `overrides:` spec holding no `allowedFeats` and no phase-2 block,
 * plus an even 30-character sample of the rest. Under jsdom the parity snapshot's specs cannot load (its script
 * resolves its folder from `import.meta.url`), so `sweepHeroes` makes them: every class, tweaked and not. Written in WP2 (no surface draws a mark yet, so the
 * count is a floor) and RE-RUN by every WP that wires the mark into a surface: WP4-WP12, WP14, WP16, WP17, WP13.
 */
import { createElement } from 'react';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { hero } from './_tweaks-harness';
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides, ContentDatabase } from '../src/rules/types';

export type SweepSpec = { id: string; build: BuildState; dbPatch?: (db: ContentDatabase) => ContentDatabase };

const PHASE2 = /^(choice\.(?!allowAnyway$)|remove\.choicePlace$)/;
const noop = () => {};

/** Does a build hold a tweak a mark could name (a phase-1 Take anyway, or any phase-2 choice block)? */
export function namesAPick(b: BuildState): boolean {
  const ov = b.overrides as { allowedFeats?: unknown[]; blocks?: { kind?: unknown }[] } | undefined;
  if (ov?.allowedFeats?.length) return true;
  return (ov?.blocks ?? []).some((x) => typeof x?.kind === 'string' && (x.kind === 'choice.allowAnyway' || PHASE2.test(x.kind)));
}

/** The sweep's characters: the `overrides:` specs that name no pick (twins included), and 30 others, evenly. */
export function sweepCharacters(specs: SweepSpec[], sample = 30): SweepSpec[] {
  const ov = specs.filter((s) => s.id.startsWith('overrides:') && !namesAPick(s.build));
  const rest = specs.filter((s) => !s.id.startsWith('overrides:') && !namesAPick(s.build));
  const step = Math.max(1, Math.floor(rest.length / sample));
  return [...ov, ...rest.filter((_, i) => i % step === 0).slice(0, sample)];
}

/** Tweaks that name no pick: a bonus, a set number, a rank, a given feat, a language. */
const NUMBER_TWEAKS = (): BuildOverrides =>
  ({
    v: 2,
    addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }],
    addedLanguages: ['draconic'],
    proficiencies: { stealth: 'expert' },
    blocks: [
      { id: 't1_swp1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, reason: 'sweep' },
      { id: 't2_swp1', kind: 'number.set', v: 1, target: 'ac', value: 20 },
    ],
  }) as unknown as BuildOverrides;

/**
 * The sweep's characters when the parity specs cannot load (jsdom): every class at levels 1, 5, 12 and 20 in turn;
 * every other one holds the no-pick tweaks above (id `overrides:<class>-L<n>`), the rest none (`book:<class>-L<n>`).
 */
export function sweepHeroes(db: ContentDatabase): SweepSpec[] {
  const levels = [1, 5, 12, 20];
  return Object.keys(db.classes)
    .sort()
    .flatMap((classId, i) =>
      [0, 2].map((shift) => {
        const level = levels[(i + shift) % levels.length];
        const tweaked = shift === 0;
        const build = hero(db, classId, level, tweaked ? NUMBER_TWEAKS() : undefined, tweaked ? {} : { options: {} });
        return { id: `${tweaked ? 'overrides' : 'book'}:${classId}-L${level}`, build };
      }),
    );
}

/** Mount the Builder on `build` and count the Tweak marks on Setup and on each level page. */
export function marksIn(db: ContentDatabase, build: BuildState): { page: string; marks: number }[] {
  const r = renderDom(createElement(Builder, { content: db, initial: build, onCancel: noop, onCreate: noop }));
  try {
    const out: { page: string; marks: number }[] = [];
    const pages = [...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean);
    for (const page of pages) {
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === page) ?? null);
      const marks = [...r.host.querySelectorAll('[data-tweak-mark]')];
      // A mark sits BESIDE a card button, never inside one (WP2 check finding 2): invalid HTML, broken keys.
      const inButton = marks.filter((m) => m.closest('button'));
      if (inButton.length) throw new Error(`page ${page}: ${inButton.length} Tweak mark(s) inside a button`);
      out.push({ page, marks: marks.length });
    }
    return out;
  } finally {
    r.stop();
  }
}
