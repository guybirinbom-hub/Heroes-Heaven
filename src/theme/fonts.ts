/*
 * Font registry — the TYPEFACE axis of the design system.
 *
 * Orthogonal to palette and style: a font sets only --app-font (the body text
 * stack). Each entry is a system-font stack with graceful fallbacks, so they
 * work offline with no bundled font files — the first family the OS has wins.
 */

export interface AppFont {
  id: string;
  name: string;
  /** CSS font-family stack assigned to --app-font. */
  stack: string;
}

export const fonts: Record<string, AppFont> = {
  system: {
    id: 'system',
    name: 'System',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  grotesque: {
    id: 'grotesque',
    name: 'Grotesque',
    stack: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  },
  humanist: {
    id: 'humanist',
    name: 'Humanist',
    stack: "Optima, Candara, 'Gill Sans', 'Segoe UI', sans-serif",
  },
  rounded: {
    id: 'rounded',
    name: 'Rounded',
    stack: "'Quicksand', 'Trebuchet MS', Verdana, sans-serif",
  },
  book: {
    id: 'book',
    name: 'Book serif',
    stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  },
  tome: {
    id: 'tome',
    name: 'Old tome',
    stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, Garamond, 'Times New Roman', serif",
  },
  slab: {
    id: 'slab',
    name: 'Slab',
    stack: "Rockwell, 'Roboto Slab', 'Courier New', Georgia, serif",
  },
  mono: {
    id: 'mono',
    name: 'Monospace',
    stack: "'Cascadia Code', Consolas, 'SF Mono', 'Roboto Mono', monospace",
  },
  readable: {
    id: 'readable',
    name: 'Readable',
    stack: "'Atkinson Hyperlegible', Verdana, Tahoma, 'Segoe UI', sans-serif",
  },
  dyslexic: {
    id: 'dyslexic',
    name: 'Dyslexia-friendly',
    stack: "'OpenDyslexic', 'Comic Sans MS', 'Comic Neue', Verdana, sans-serif",
  },
};

export const fontList: AppFont[] = Object.values(fonts);

/**
 * Resolve every stack's families ONCE, off the critical path.
 *
 * The Font axis in the Customize panel is the only place in the app that asks the browser for these
 * ten stacks, and most of the families they name are not installed — 'Inter', 'Quicksand', 'Iowan Old
 * Style', 'Roboto Slab', 'SF Mono', 'Atkinson Hyperlegible', 'OpenDyslexic'. A cold family lookup
 * walks the system font list: laying the ten out in an offscreen box measured 14.4 / 26.3 / 30.2 ms
 * in three dev-preview renderer processes that had never seen them, against 0.1-0.5 ms on every call
 * after. That cache belongs to the RENDERER PROCESS, not the document — it survives a reload, so only
 * a brand-new tab (the app's own cold start) is ever cold, and a page can hold exactly one cold
 * sample. Doing it here while the app is idle moves the cost off the first open; a second call has
 * nothing left to do and says so by returning nothing.
 *
 * This is one part of the first open, not all of it. Measured with the stacks already warm, the first
 * open still costs ~20 ms more layout than later opens (the drawer's first layout in that document),
 * plus the whole sheet re-rendering behind the drawer. Neither is touched from here.
 *
 * Nothing is painted: the box is aria-hidden, 9999px off to the left, and removed before returning.
 */
let warmedFonts = false;
export function warmFontStacks(): string[] {
  if (warmedFonts || typeof document === 'undefined' || !document.body) return [];
  warmedFonts = true;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none';
  const stacks = fontList.map((f) => f.stack);
  for (const stack of stacks) {
    const probe = document.createElement('span');
    probe.style.fontFamily = stack;
    // A glyph, not an empty span — an empty box is never measured against the font, so nothing is matched.
    probe.textContent = 'Ag';
    box.appendChild(probe);
  }
  document.body.appendChild(box);
  box.getBoundingClientRect(); // forces the match here rather than when the panel opens
  box.remove();
  return stacks;
}
