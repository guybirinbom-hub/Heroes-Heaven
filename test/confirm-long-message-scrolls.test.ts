import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A long message in a confirm box scrolls, so its buttons are never cut off on a phone.
 *
 * bug 2026-10-23 (sheet fixes): `.picker` caps its height (`max-height: calc(92vh … - 40px)`) and clips
 * (`overflow: hidden`), and `.confirm-body` had no overflow of its own. A message taller than the
 * screen — the Wanderer's Guide export list at 375x812 — grew the body past the cap, and the clip cut
 * the buttons off: the player could not answer the question. The body now shrinks and scrolls inside
 * the box; the buttons keep their size.
 *
 * jsdom applies no stylesheet, so this holds the cascade: every rule that targets `.confirm-body` /
 * `.confirm-actions`, folded in source order, unconditional plus every phone-width media query.
 */
type Rule = { sel: string; body: string; at: string | null };

function parse(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let at: string | null = null;
  let head = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{') {
      const sel = head.trim();
      head = '';
      if (sel.startsWith('@')) {
        at = sel;
        continue;
      }
      const end = clean.indexOf('}', i);
      rules.push({ sel, body: clean.slice(i + 1, end), at });
      i = end;
      continue;
    }
    if (ch === '}') {
      at = null;
      head = '';
      continue;
    }
    head += ch;
  }
  return rules;
}

const RULES = parse(readFileSync('src/sheet.css', 'utf8'));

/** The declarations a selector ends up with at a width, folded in source order. */
function resolved(target: string, width: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RULES) {
    if (!r.sel.split(',').some((s) => s.trim() === target)) continue;
    if (r.at) {
      if (!r.at.startsWith('@media')) continue;
      const max = /max-width:\s*(\d+)px/.exec(r.at);
      const min = /min-width:\s*(\d+)px/.exec(r.at);
      if (!max && !min) continue;
      if (max && width > Number(max[1])) continue;
      if (min && width < Number(min[1])) continue;
    }
    for (const decl of r.body.split(';')) {
      const m = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(decl);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

describe('confirm box — a long message scrolls and the buttons stay', () => {
  for (const width of [375, 1280]) {
    it(`at ${width}px the body shrinks and scrolls`, () => {
      const body = resolved('.confirm-body', width);
      expect(body['overflow-y'] ?? body.overflow).toBe('auto');
      expect(body['min-height']).toBe('0');
      expect(body.flex ?? '').toMatch(/^1 1 /);
    });
    it(`at ${width}px the buttons never shrink`, () => {
      expect(resolved('.confirm-actions', width).flex).toBe('none');
    });
  }

  it('the box itself still caps its height and clips — the premise of the fix', () => {
    const picker = resolved('.picker', 375);
    expect(picker['max-height']).toMatch(/vh/);
    expect(picker.overflow).toBe('hidden');
    expect(picker['flex-direction']).toBe('column');
  });
});
