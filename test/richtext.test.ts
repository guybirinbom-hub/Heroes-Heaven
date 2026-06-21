import { describe, it, expect } from 'vitest';
import { parseBlocks } from '../src/sheet/RichText';

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
