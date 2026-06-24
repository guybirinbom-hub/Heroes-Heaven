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
