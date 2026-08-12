// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyAutoDir, htmlWithAutoDir } from '../src/sheet/autoDir';

/** Parse an HTML fragment, run the pass over it, and hand back the container. */
function tagged(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  applyAutoDir(root);
  return root;
}

const HEB = 'על סבלנות';
const ARA = 'مرحبا بالعالم';

describe('autoDir: per-block reading direction for user-written text', () => {
  it('tags every block with dir="auto" so each picks its own direction', () => {
    const root = tagged('<p>English</p><h2>כותרת</h2><blockquote>quote</blockquote>');
    expect([...root.children].map((e) => e.getAttribute('dir'))).toEqual(['auto', 'auto', 'auto']);
  });

  it('leaves a direction the author set alone', () => {
    const root = tagged('<p dir="ltr">forced</p><p dir="rtl">forced too</p>');
    expect([...root.children].map((e) => e.getAttribute('dir'))).toEqual(['ltr', 'rtl']);
  });

  it('gives a list an EXPLICIT direction from its text, not dir="auto"', () => {
    // dir="auto" on the <ul> would skip the <li>s (they carry their own dir) and find no strong
    // character of its own — the bug that left a Hebrew list's indent stranded on the left while its
    // markers moved to the right.
    const rtl = tagged(`<ul><li>${HEB}</li><li>עוד שורה</li></ul>`);
    expect(rtl.querySelector('ul')!.getAttribute('dir')).toBe('rtl');
    const ltr = tagged('<ol><li>First</li><li>Second</li></ol>');
    expect(ltr.querySelector('ol')!.getAttribute('dir')).toBe('ltr');
  });

  it('keeps each list ITEM on auto, so a mixed-language list still reads correctly', () => {
    const root = tagged(`<ul><li>${HEB}</li><li>An English bullet</li></ul>`);
    expect([...root.querySelectorAll('li')].map((li) => li.getAttribute('dir'))).toEqual(['auto', 'auto']);
  });

  it('detects Arabic as well as Hebrew', () => {
    expect(tagged(`<ul><li>${ARA}</li></ul>`).querySelector('ul')!.getAttribute('dir')).toBe('rtl');
  });

  it('ignores digits and punctuation when deciding — the first STRONG character wins', () => {
    expect(tagged(`<ul><li>12. ${HEB}</li></ul>`).querySelector('ul')!.getAttribute('dir')).toBe('rtl');
    expect(tagged('<ul><li>12. English</li></ul>').querySelector('ul')!.getAttribute('dir')).toBe('ltr');
  });

  it('leaves a list with no strong character undirected', () => {
    expect(tagged('<ul><li>123</li><li>—</li></ul>').querySelector('ul')!.hasAttribute('dir')).toBe(false);
  });

  it('revises a list direction it set itself when the text changes', () => {
    const root = tagged(`<ul><li>${HEB}</li></ul>`);
    const ul = root.querySelector('ul')!;
    expect(ul.getAttribute('dir')).toBe('rtl');
    ul.textContent = 'Now in English';
    applyAutoDir(root);
    expect(ul.getAttribute('dir')).toBe('ltr');
  });

  it('never revises a direction the author set, however the text changes', () => {
    const root = tagged(`<ul dir="ltr"><li>${HEB}</li></ul>`);
    applyAutoDir(root);
    expect(root.querySelector('ul')!.getAttribute('dir')).toBe('ltr');
  });

  it('htmlWithAutoDir tags a saved note that predates any of this', () => {
    const out = htmlWithAutoDir(`<p>${HEB}</p><ul><li>${HEB}</li></ul>`);
    expect(out).toContain('<p dir="auto">');
    expect(out).toContain('<ul dir="rtl"');
  });

  it('is a no-op on empty input and on a missing root', () => {
    expect(htmlWithAutoDir('')).toBe('');
    expect(() => applyAutoDir(null)).not.toThrow();
  });
});
