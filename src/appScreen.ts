// Which top-level screen App should render, as a pure function of the three inputs that decide it.
// Kept out of App.tsx's JSX so the gate can be unit-tested — this exact decision regressed once:
// creating the FIRST character on an empty roster (a fresh phone install) hung on "Loading game
// content…" forever, because the loading gate required a `character` the builder never has yet.

export type Screen = 'roster' | 'loading' | 'builder' | 'homebrew' | 'campaigns' | 'sheet';

export interface ScreenInputs {
  /** 'roster' | 'builder' | 'homebrew' | 'sheet' — the mode after empty-roster coercion. */
  effectiveMode: string;
  /** core.json has finished loading and parsing. */
  hasContent: boolean;
  /** There is an active, in-play character to show (false while creating the first one). */
  hasCharacter: boolean;
}

export function pickScreen({ effectiveMode, hasContent, hasCharacter }: ScreenInputs): Screen {
  if (effectiveMode === 'roster') return 'roster';
  // Content-dependent screens wait behind a lightweight shell until core.json is ready. The BUILDER,
  // HOMEBREW manager, and CAMPAIGNS page need ONLY content — none requires an active character (you
  // reach them from the roster's menu on a fresh phone that has no characters yet, and a brand-new
  // character has no `character` in the builder) — so they must not be gated on `hasCharacter`. Only
  // the SHEET does.
  const characterless = effectiveMode === 'builder' || effectiveMode === 'homebrew' || effectiveMode === 'campaigns';
  if (!hasContent || (!characterless && !hasCharacter)) return 'loading';
  if (effectiveMode === 'builder') return 'builder';
  if (effectiveMode === 'homebrew') return 'homebrew';
  if (effectiveMode === 'campaigns') return 'campaigns';
  return 'sheet';
}
