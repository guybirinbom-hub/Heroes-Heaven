/*
 * Style registry — the SHAPE + DENSITY axis of the design system.
 *
 * Orthogonal to palette AND font: a style sets corner radius, border weight,
 * shadow and density. Palette x Style x Font x Accent multiply, so a handful of
 * each yields a huge range of distinct looks from pure data. (Font lives in its
 * own registry, fonts.ts, so any typeface pairs with any style.)
 */

export interface AppStyle {
  id: string;
  name: string;
  /** Values for the shape/density tokens in tokens.css. */
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
      '--app-pad': '9px',
      '--app-gap': '8px',
    },
  },
  cozy: {
    id: 'cozy',
    name: 'Cozy',
    tokens: {
      '--app-radius': '16px',
      '--app-radius-sm': '11px',
      '--app-radius-lg': '22px',
      '--app-bw': '1px',
      '--app-shadow': '0 4px 22px rgba(0, 0, 0, 0.30)',
      '--app-pad': '16px',
      '--app-gap': '13px',
    },
  },
  crisp: {
    id: 'crisp',
    name: 'Crisp',
    tokens: {
      '--app-radius': '2px',
      '--app-radius-sm': '1px',
      '--app-radius-lg': '3px',
      '--app-bw': '1px',
      '--app-shadow': 'none',
      '--app-pad': '12px',
      '--app-gap': '10px',
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
      '--app-pad': '14px',
      '--app-gap': '12px',
    },
  },
  tome: {
    id: 'tome',
    name: 'Tome',
    tokens: {
      '--app-radius': '6px',
      '--app-radius-sm': '4px',
      '--app-radius-lg': '9px',
      '--app-bw': '2px',
      '--app-shadow': '0 3px 12px rgba(0, 0, 0, 0.26)',
      '--app-pad': '15px',
      '--app-gap': '11px',
    },
  },
};

export const styleList: AppStyle[] = Object.values(styles);
