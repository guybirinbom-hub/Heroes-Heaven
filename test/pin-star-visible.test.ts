import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/*
 * bug 2026-10-14 (the owner's list): "star highlighted not obvious enough, it's too dim, I can't see
 * it's highlighted". A pinned star was the same OUTLINE glyph as an unpinned one, only recoloured. It is
 * now a FILLED star in the theme's gold on a gold patch. These checks fail if any part of that quietly
 * stops working: the rule, the font file it loads, or the glyph's code in that font.
 */

const ROOT = join(__dirname, '..');
const css = readFileSync(join(ROOT, 'src', 'sheet.css'), 'utf8');

/** The declarations of the first rule whose selector list contains `selector` exactly. */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[},\\s])${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css);
  return m?.[1] ?? '';
}

describe('a pinned star is unmistakable', () => {
  for (const sel of ['.info-star.on', '.pin-star.on', '.ms-sig.on']) {
    it(`${sel} is gold on a gold patch`, () => {
      const body = ruleBody(sel);
      expect(body).toMatch(/color:\s*var\(--app-warn\)/);
      expect(body).toMatch(/background:\s*color-mix\(in srgb, var\(--app-warn\)/);
    });
    it(`${sel} draws the FILLED star glyph`, () => {
      const body = ruleBody(`${sel} .ti-star::before`);
      expect(body).toMatch(/font-family:\s*'hh-star-filled'\s*!important/);
      expect(body).toMatch(/content:\s*'\\f6a6'/);
    });
  }

  it('the filled font the rule loads exists', () => {
    const m = /font-family:\s*'hh-star-filled';\s*src:\s*url\('([^']+)'\)/.exec(css);
    expect(m).not.toBeNull();
    expect(existsSync(resolve(join(ROOT, 'src'), m![1]))).toBe(true);
  });

  it("\\f6a6 is still the star in Tabler's filled font (an icon-font upgrade can move it)", () => {
    const filled = readFileSync(join(ROOT, 'node_modules', '@tabler', 'icons-webfont', 'dist', 'tabler-icons-filled.min.css'), 'utf8');
    expect(filled).toContain('.ti-star:before{content:"\\f6a6"}');
  });

  it('catches a planted bad case: the old accent-only rule fails the check', () => {
    const OLD = '.info-star.on {\n  color: var(--app-accent);\n}';
    expect(/color:\s*var\(--app-warn\)/.test(OLD)).toBe(false);
  });
});
