/*
 * Per-paragraph direction detection for user-authored rich text (notes, homebrew descriptions).
 *
 * A note written in Hebrew or Arabic inside an LTR app doesn't just need right-aligned text: the list
 * BULLET has to move to the right of the line too, and a note that mixes languages needs each block to
 * decide for itself. `unicode-bidi: plaintext` gets the text runs right but leaves list markers on the
 * left, and one `dir="rtl"` on the whole editor gets a mixed note wrong. The HTML answer to both is
 * `dir="auto"` on each block: the browser picks that block's direction from its first strong character,
 * and a list item's marker follows its own direction. (A <ul>/<ol> is the exception — see below.)
 *
 * Applied in two places: to the editor's DOM as you type (so the direction is right immediately AND the
 * attribute is part of the HTML that gets saved), and to already-saved notes when they're rendered
 * read-only (notes written before this existed carry no dir attributes).
 */

/** Blocks that lay out their own line box, so each can carry its own direction. */
const BLOCK_SELECTOR = 'p,div,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,pre';

// The standard "first strong character" ranges, written as \u escapes so the intent survives a
// review diff and any file-encoding accident.
/** Strong right-to-left: Hebrew, Arabic, Syriac, Thaana, N'Ko + the Arabic presentation forms. */
const STRONG_RTL = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
/** Strong left-to-right: Latin, Greek, Cyrillic and the other LTR planes, minus the RTL blocks. */
const STRONG_LTR =
  /[A-Za-z\u00C0-\u058F\u0800-\u1FFF\u2C00-\uD7FF\uF900-\uFB17\uFDFE-\uFE6F\uFEFD-\uFFFF]/;

/** The direction a run of text would resolve to, or null when it holds no strong character at all. */
function firstStrongDir(text: string): 'rtl' | 'ltr' | null {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return 'rtl';
    if (STRONG_LTR.test(ch)) return 'ltr';
  }
  return null;
}

/** Tag `dir` on every block inside `root` (the root itself is left alone). */
export function applyAutoDir(root: HTMLElement | null | undefined): void {
  if (!root) return;
  // Never overwrite a direction the author set deliberately (pasted markup can carry ltr/rtl).
  const alreadySet = (el: HTMLElement) => {
    const cur = el.getAttribute('dir');
    return cur === 'ltr' || cur === 'rtl' || cur === 'auto';
  };
  for (const el of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (!alreadySet(el)) el.setAttribute('dir', 'auto');
  }
  // Lists need an EXPLICIT direction rather than `auto`. `dir="auto"` reads the first strong character
  // of an element's own text, skipping any descendant that carries its own dir — and every <li> above
  // just got one, so a <ul> full of Hebrew saw no strong character and stayed left-to-right. The items'
  // markers then sat on the right while the list's indent stayed on the left. Resolve it from the list's
  // text ourselves; each <li> keeps its own `auto` so a mixed-language list still reads correctly.
  //
  // `data-autodir` marks the ones WE set, so a later pass can revise them as the text changes while
  // still never touching a direction the author wrote by hand.
  for (const list of root.querySelectorAll<HTMLElement>('ul,ol')) {
    const ours = list.hasAttribute('data-autodir');
    if (list.hasAttribute('dir') && !ours) continue;
    const dir = firstStrongDir(list.textContent ?? '');
    if (dir) {
      list.setAttribute('dir', dir);
      list.setAttribute('data-autodir', '');
    } else if (ours) {
      list.removeAttribute('dir');
      list.removeAttribute('data-autodir');
    }
  }
}

/** The same pass over an HTML string, for content rendered read-only. Returns the input unchanged in a
 *  DOM-less context (tests / SSR) — the direction is a presentation nicety, never a correctness one. */
export function htmlWithAutoDir(html: string): string {
  if (!html || typeof document === 'undefined') return html;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  applyAutoDir(holder);
  return holder.innerHTML;
}
