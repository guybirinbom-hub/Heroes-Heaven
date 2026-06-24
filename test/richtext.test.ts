import { describe, it, expect } from 'vitest';
import { parseBlocks, toPlainText } from '../src/sheet/RichText';

describe('toPlainText (compact preview flattening)', () => {
  it('strips bold markers and the --- divider from an action blurb (Channel Smite case)', () => {
    const desc = '**Cost** Expend a Harm or Heal spell.\n\n---\n\nYou siphon the energies of life and death.';
    expect(toPlainText(desc)).toBe('Cost Expend a Harm or Heal spell. You siphon the energies of life and death.');
  });
  it('flattens headings, list markers, italics, highlights, and pipes; collapses whitespace', () => {
    expect(toPlainText('# Heading\n\n- one\n- *two*\n\n⟦heightened⟧ | x |')).toBe('Heading one two heightened x');
  });
  it('reduces @refs and inline rolls to readable text', () => {
    expect(toPlainText('See @UUID[Compendium.x]{Demoralize} and roll [[/r 1d6]] now.')).toBe('See Demoralize and roll now.');
  });
  it('strips markdown table separator rows (--- groups), not just whole-line dividers', () => {
    expect(toPlainText('| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe('A B 1 2');
  });
  it('returns empty string for undefined / empty', () => {
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText('')).toBe('');
  });
});

describe('parseBlocks (markdown-lite)', () => {
  it('splits blank-line-separated paragraphs', () => {
    const b = parseBlocks('First para.\n\nSecond para.');
    expect(b).toEqual([
      { kind: 'p', text: 'First para.' },
      { kind: 'p', text: 'Second para.' },
    ]);
  });

  it('recognizes a degree-of-success block and strips the bold label', () => {
    const text = 'You plant fear.\n\n---\n\n**Critical Success** Unaffected.\n\n**Success** Frightened 1.\n\n**Failure** Frightened 2.\n\n**Critical Failure** Frightened 3.';
    const b = parseBlocks(text);
    expect(b[0]).toEqual({ kind: 'p', text: 'You plant fear.' });
    expect(b[1]).toEqual({ kind: 'hr' });
    expect(b[2]).toEqual({ kind: 'ds', tier: 'crit-success', text: 'Unaffected.' });
    expect(b[3]).toEqual({ kind: 'ds', tier: 'success', text: 'Frightened 1.' });
    expect(b[4]).toEqual({ kind: 'ds', tier: 'failure', text: 'Frightened 2.' });
    expect(b[5]).toEqual({ kind: 'ds', tier: 'crit-failure', text: 'Frightened 3.' });
  });

  it('does not mistake "Critical Success" for the "Success" tier', () => {
    const b = parseBlocks('**Critical Success** Foo.');
    expect(b[0]).toMatchObject({ kind: 'ds', tier: 'crit-success' });
  });

  it('parses headings', () => {
    const b = parseBlocks('## Section\n\nBody.');
    expect(b[0]).toEqual({ kind: 'h', level: 2, text: 'Section' });
    expect(b[1]).toEqual({ kind: 'p', text: 'Body.' });
  });

  it('parses unordered and ordered lists', () => {
    expect(parseBlocks('- a\n- b\n- c')[0]).toEqual({ kind: 'ul', items: ['a', 'b', 'c'] });
    expect(parseBlocks('1. first\n2. second')[0]).toEqual({ kind: 'ol', items: ['first', 'second'] });
  });

  it('parses a GFM pipe table', () => {
    const b = parseBlocks('| 1d4 | Effect |\n| --- | --- |\n| 1 | **Bad** thing |\n| 2 | Good thing |');
    expect(b[0]).toEqual({
      kind: 'table',
      headers: ['1d4', 'Effect'],
      rows: [
        ['1', '**Bad** thing'],
        ['2', 'Good thing'],
      ],
    });
  });

  it('treats plain prose with no markup as a single paragraph (back-compat)', () => {
    const b = parseBlocks('Just one sentence with no structure.');
    expect(b).toEqual([{ kind: 'p', text: 'Just one sentence with no structure.' }]);
  });
});
