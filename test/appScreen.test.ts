import { describe, it, expect } from 'vitest';
import { pickScreen } from '../src/appScreen';

describe('pickScreen', () => {
  it('shows the roster whenever effectiveMode is roster, regardless of content/character', () => {
    expect(pickScreen({ effectiveMode: 'roster', hasContent: false, hasCharacter: false })).toBe('roster');
    expect(pickScreen({ effectiveMode: 'roster', hasContent: true, hasCharacter: true })).toBe('roster');
  });

  it('waits behind the loading shell until content is ready (any content mode)', () => {
    expect(pickScreen({ effectiveMode: 'builder', hasContent: false, hasCharacter: false })).toBe('loading');
    expect(pickScreen({ effectiveMode: 'sheet', hasContent: false, hasCharacter: true })).toBe('loading');
    expect(pickScreen({ effectiveMode: 'homebrew', hasContent: false, hasCharacter: true })).toBe('loading');
  });

  // The exact regression this module exists to guard: creating the FIRST character on an empty
  // roster (a fresh phone install) — content loads but there is no active character yet. The
  // builder must open, NOT hang forever on "Loading game content…".
  it('opens the builder for a new character even with no active character (empty-roster path)', () => {
    expect(pickScreen({ effectiveMode: 'builder', hasContent: true, hasCharacter: false })).toBe('builder');
  });

  it('opens the builder when editing an existing character too', () => {
    expect(pickScreen({ effectiveMode: 'builder', hasContent: true, hasCharacter: true })).toBe('builder');
  });

  it('holds the sheet/homebrew behind loading until a character exists', () => {
    // These modes are only reachable with an active character in App (effectiveMode coercion),
    // but pickScreen must still refuse to render them character-less.
    expect(pickScreen({ effectiveMode: 'sheet', hasContent: true, hasCharacter: false })).toBe('loading');
    expect(pickScreen({ effectiveMode: 'homebrew', hasContent: true, hasCharacter: false })).toBe('loading');
  });

  it('renders sheet and homebrew once content and character are both present', () => {
    expect(pickScreen({ effectiveMode: 'sheet', hasContent: true, hasCharacter: true })).toBe('sheet');
    expect(pickScreen({ effectiveMode: 'homebrew', hasContent: true, hasCharacter: true })).toBe('homebrew');
  });
});
