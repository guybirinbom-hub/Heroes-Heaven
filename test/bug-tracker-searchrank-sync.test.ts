// tracker 2026-09-15: maintenance
//
// tracker/src/utils/searchRank.ts is a deliberate copy of src/data/searchRank.ts (the tracker must
// not import HH code — see its header comment). This guard reads both files and asserts everything
// after the copy's one-line header matches the source byte for byte, so a future edit to either side
// gets caught immediately instead of silently drifting.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'src', 'data', 'searchRank.ts');
const COPY = join(ROOT, 'tracker', 'src', 'utils', 'searchRank.ts');

describe('tracker 2026-09-15: maintenance', () => {
  it('keeps the tracker copy of searchRank.ts byte-identical to the source after its header line', () => {
    // core.autocrlf=true means a fresh checkout can land either file as CRLF; strip \r so this guard
    // tests content and drifts, not which line endings a checkout happened to produce.
    const source = readFileSync(SOURCE, 'utf8').replace(/\r/g, '');
    const copy = readFileSync(COPY, 'utf8').replace(/\r/g, '');

    const firstNewline = copy.indexOf('\n');
    expect(firstNewline).toBeGreaterThan(-1);
    const header = copy.slice(0, firstNewline + 1);
    const rest = copy.slice(firstNewline + 1);

    expect(header).toBe('// copy of src/data/searchRank.ts — keep in sync; the tracker does not import HH code\n');
    expect(rest).toBe(source);
  });
});
