// Which top-level screen App should render, as a pure function of the three inputs that decide it.
// Kept out of App.tsx's JSX so the gate can be unit-tested — this exact decision regressed once:
// creating the FIRST character on an empty roster (a fresh phone install) hung on "Loading game
// content…" forever, because the loading gate required a `character` the builder never has yet.

export type Screen = 'roster' | 'loading' | 'builder' | 'homebrew' | 'sheet';

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
  // Content-dependent screens wait behind a lightweight shell until core.json is ready. The
  // BUILDER needs ONLY content — a brand-new character has no `character` yet — so it must not be
  // gated on `hasCharacter`; every other content screen also needs a character.
  if (!hasContent || (effectiveMode !== 'builder' && !hasCharacter)) return 'loading';
  if (effectiveMode === 'builder') return 'builder';
  if (effectiveMode === 'homebrew') return 'homebrew';
  return 'sheet';
}
