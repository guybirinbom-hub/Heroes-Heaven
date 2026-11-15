/*
 * CONTRAST RATCHET — PC only (1440x900). axe-core's `color-contrast` rule on two screens (Characters,
 * the sheet's Main tab) in EVERY palette in src/theme/themes.ts.
 *
 * Today's app already has some failures, so this is a ratchet, not a zero gate: contrast-baseline.json
 * holds, per palette+screen, the count of failing elements AND the sorted list of those elements (axe's
 * CSS selector for each). A test fails when
 *   - the count goes UP, or
 *   - ANY element fails that is not on the list — even if the count stayed the same or went down, so a
 *     new failure cannot hide behind a fix made in the same change.
 * It prints which elements are new. When a fix brings counts DOWN, lock the improvement in with
 *     UPDATE_CONTRAST_BASELINE=1 npm run test:contrast
 * which lowers entries (and adds entries for a new palette) but NEVER raises a count or adds an element
 * to an existing list. Raising is a hand edit of the JSON with a reason in the commit message.
 *
 * Each palette+screen has a SECOND entry, "<palette>/<screen>#incomplete": the elements axe could not
 * measure (result.incomplete — text over a gradient, an image or a translucent stack). A real failure
 * there is invisible to the violations entry, so it is ratcheted with exactly the same rules.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { themeList } from '../../src/theme/themes';
import { open, assertNoReload, marker, type Screen } from './helpers';

const BASELINE = fileURLToPath(new URL('./contrast-baseline.json', import.meta.url));
const UPDATE = process.env.UPDATE_CONTRAST_BASELINE === '1';
const SCREENS: Screen[] = ['roster', 'sheet'];

interface Entry {
  count: number;
  /** Sorted axe selectors of the failing elements. Absent only in an old count-only entry. */
  elements?: string[];
}
type Baseline = Record<string, Entry>;

/** Reads the baseline; an old count-only entry (a bare number) reads as an entry with no element list. */
const readBaseline = (): Baseline => {
  if (!existsSync(BASELINE)) return {};
  const raw = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number | Entry>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? { count: v } : v]));
};
const writeBaseline = (b: Baseline): void => {
  const sorted = Object.fromEntries(Object.entries(b).sort(([a], [z]) => a.localeCompare(z)));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
};

type AxeNode = { target: unknown[]; any: { message?: string }[]; failureSummary?: string };
const selectorOf = (n: AxeNode): string => n.target.map(String).join(' >> ');
const describe = (list: AxeNode[]): string =>
  list.map((n) => `  ${selectorOf(n)}  —  ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');

/**
 * Holds one baseline entry against this run's nodes. Failures are SOFT, so a test reports both of its
 * entries (violations and incomplete) before it fails.
 */
function ratchet(key: string, what: string, nodes: AxeNode[]): void {
  const count = nodes.length;
  const elements = nodes.map(selectorOf).sort();
  const was = readBaseline()[key];
  const known = new Set(was?.elements ?? []);
  const fresh = was?.elements ? nodes.filter((n) => !known.has(selectorOf(n))) : [];
  console.log(`contrast ${key}: ${count} ${what} element(s)` + (was === undefined ? ' (no baseline yet)' : ` (baseline ${was.count})`));

  // Update mode: record a missing entry; fill in a missing element list or lower a count, but only
  // when nothing got worse (no higher count, no element absent from the old list).
  if (UPDATE) {
    const worse = was !== undefined && (count > was.count || fresh.length > 0);
    if (!worse && (was === undefined || !was.elements || count < was.count)) {
      const b = readBaseline();
      b[key] = { count, elements };
      writeBaseline(b);
      console.log(`  baseline ${was === undefined ? 'added' : was.elements ? 'lowered' : 'given its element list'}: ${key} = ${count}`);
      return;
    }
  }
  if (was === undefined || !was.elements) {
    const why = was === undefined ? 'has no baseline entry' : 'has only a count in the baseline, no element list';
    expect.soft(false, `${key} ${why} — run once with UPDATE_CONTRAST_BASELINE=1 to record it`).toBe(true);
    return;
  }
  expect
    .soft(count, `${key}: ${what} elements went UP from ${was.count} to ${count}. Elements:\n${describe(nodes)}`)
    .toBeLessThanOrEqual(was.count);
  expect
    .soft(
      fresh.length,
      `${key}: ${fresh.length} element(s) are now ${what} that were not before (count ${was.count} → ${count}):\n${describe(fresh)}`,
    )
    .toBe(0);
  if (count < was.count) console.log(`  ${key} improved (${was.count} → ${count}) — lower the baseline with UPDATE_CONTRAST_BASELINE=1`);
}

for (const theme of themeList) {
  for (const screen of SCREENS) {
    const key = `${theme.id}/${screen}`;
    test(`contrast ${key}`, async ({ page }) => {
      await open(page, { themeId: theme.id }, screen);
      const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      // A scan across a dev-server reload counts a blank page's zero failures — refuse it.
      await assertNoReload(page);
      await expect(marker(page, screen)).toBeVisible();
      // Two entries per palette+screen, each with the same ratchet rules:
      //   "<palette>/<screen>"            — axe VIOLATIONS: contrast measured and too low.
      //   "<palette>/<screen>#incomplete" — axe could NOT measure the contrast (a gradient, an image or a
      //     translucent stack behind the text), so it says "needs review". A real failure there would be
      //     invisible to the first entry, so these are ratcheted too.
      const pick = (list: typeof result.violations) => list.filter((r) => r.id === 'color-contrast').flatMap((r) => r.nodes);
      ratchet(key, 'failing', pick(result.violations));
      ratchet(`${key}#incomplete`, 'unmeasurable ("needs review")', pick(result.incomplete));
    });
  }
}
