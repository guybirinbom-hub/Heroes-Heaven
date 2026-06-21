/*
 * Style registry — the SHAPE + TYPE axis of the design system.
 *
 * Orthogonal to palette: a style sets corner radius, border weight, shadow,
 * font family and density. Palette x Style x Accent multiply, so a handful of
 * each yields a huge range of distinct looks from pure data.
 */

export interface AppStyle {
  id: string;
  name: string;
  /** Values for the shape/type/density tokens in tokens.css. */
  tokens: Record<string, string>;
}

export const styles: Record<string, AppStyle> = {
  modern: {
    id: 'modern',
    name: 'Modern',
    tokens: {
      '--app-radius': '11px',
      '--app-radius-sm': '7px',
      '--app-radius-lg': '15px',
      '--app-bw': '1px',
      '--app-shadow': '0 3px 16px rgba(0, 0, 0, 0.28)',
      '--app-font': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      '--app-pad': '14px',
      '--app-gap': '11px',
    },
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    tokens: {
      '--app-radius': '4px',
      '--app-radius-sm': '3px',
      '--app-radius-lg': '6px',
      '--app-bw': '1px',
      '--app-shadow': 'none',
      '--app-font': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      '--app-pad': '9px',
      '--app-gap': '8px',
    },
  },
  storybook: {
    id: 'storybook',
    name: 'Storybook',
    tokens: {
      '--app-radius': '14px',
      '--app-radius-sm': '10px',
      '--app-radius-lg': '18px',
      '--app-bw': '1.5px',
      '--app-shadow': '0 3px 12px rgba(0, 0, 0, 0.24)',
      '--app-font': "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
      '--app-pad': '14px',
      '--app-gap': '12px',
    },
  },
};

export const styleList: AppStyle[] = Object.values(styles);
