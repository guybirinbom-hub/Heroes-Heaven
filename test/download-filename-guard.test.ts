// @vitest-environment jsdom
/*
 * Item 8 (2026-10-01): "it showed a bunch of weird characters instead of the homebrew name".
 *
 * From v0.1.9 the Homebrew page called downloadText(text, filename) against a helper declared
 * (filename, text). Both were plain strings, so tsc accepted it: every homebrew file was NAMED after
 * its JSON and HELD only the 27 characters "heroes-heaven-homebrew.json". The helper now takes ONE
 * { filename, text } object (a swap no longer compiles) and refuses at run time a name that looks like
 * file content — which is what a swapped call delivers once the type is bypassed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadText, fileSlug } from '../src/sheet/download';

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let blobs: Blob[];
let saved: string[];

beforeEach(() => {
  blobs = [];
  saved = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:test';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
});
afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  vi.restoreAllMocks();
});

const homebrewJson = JSON.stringify({ app: 'heroes-heaven', kind: 'homebrew', version: 1, sources: {}, content: {} }, null, 2);

describe('downloadText refuses a file name that is really file content', () => {
  it('saves a real name with its text, as JSON', async () => {
    downloadText({ filename: 'heroes-heaven-homebrew-2026-10-01.json', text: homebrewJson });
    expect(saved).toEqual(['heroes-heaven-homebrew-2026-10-01.json']);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('application/json');
    expect(await blobs[0].text()).toBe(homebrewJson);
  });

  it('throws, and saves nothing, on a JSON-looking name or a name with no extension', () => {
    // MUTATION PROOF (tried 2026-10-01): delete `assertDownloadFilename(filename);` from downloadText
    // and each of these saves a file — AssertionError: expected [Function] to throw an error.
    expect(() => downloadText({ filename: homebrewJson, text: 'heroes-heaven-homebrew.json' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: '{"app":"heroes-heaven"}.json', text: '' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: 'line\nbreak.json', text: '' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: 'heroes-heaven-homebrew', text: '' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: '.json', text: '' })).toThrow(/is not a file name/);
    expect(saved).toEqual([]);
    expect(blobs).toEqual([]);
  });

  it('each refused character alone is enough: a line feed, a carriage return, a "{", a double quote', () => {
    // One character per name, so dropping ANY one of them from assertDownloadFilename's /[\r\n{"]/
    // leaves its name saved. MUTATION PROOF (each tried 2026-10-01): remove `{` —
    //   AssertionError: expected [Function] to throw an error   (the 'brace{only.json' line)
    // and likewise for `"`, `\r` and `\n`, each failing on its own line below.
    expect(() => downloadText({ filename: 'line\nfeed.json', text: '' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: 'carriage\rreturn.json', text: '' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: 'brace{only.json', text: '' })).toThrow(/is not a file name/);
    expect(() => downloadText({ filename: 'quote"only.json', text: '' })).toThrow(/is not a file name/);
    expect(saved).toEqual([]);
    // …and the names the app really saves still pass.
    downloadText({ filename: 'zed-the-bold.codex.json', text: '{}' });
    downloadText({ filename: 'heroes-heaven-backup-2026-10-01.json', text: '{}' });
    expect(saved).toEqual(['zed-the-bold.codex.json', 'heroes-heaven-backup-2026-10-01.json']);
  });

  it('the old swapped call — (text, name) — throws instead of saving an empty file', () => {
    // What HomebrewPage.tsx sent from v0.1.9 until 2026-10, with the type check bypassed the way a
    // stale build or an `as never` would.
    const swapped = downloadText as unknown as (a: string, b: string) => void;
    expect(() => swapped(homebrewJson, 'heroes-heaven-homebrew.json')).toThrow(/is not a file name/);
    expect(saved).toEqual([]);
  });

  it('fileSlug (moved here from the roster and the GM sheet) still names character files the same way', () => {
    expect(fileSlug('Kyra')).toBe('kyra');
    expect(fileSlug('  Zed  the Bold!! ')).toBe('zed-the-bold');
    expect(fileSlug('')).toBe('character');
    expect(fileSlug('***')).toBe('character');
  });
});
