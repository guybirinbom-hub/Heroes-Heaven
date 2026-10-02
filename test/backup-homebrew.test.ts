// @vitest-environment jsdom
/*
 * Item 8 (2026-10-01): "export all and import all should also include homebrew".
 *
 * Settings → "Export everything" snapshots every stored key, so the homebrew rides along; a full
 * Restore puts it back. This pins that through the REAL homebrew writers (so a renamed storage key
 * cannot silently fall out of the backup's homebrew view), and pins the narrow read the Homebrew page
 * makes of such a file: its homebrew, and nothing else.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BACKUP_HOMEBREW_CONTENT_KEY,
  BACKUP_HOMEBREW_SOURCES_KEY,
  HOMEBREW_EXPORT_KIND,
  OLD_EMPTY_HOMEBREW_EXPORT,
  UnreadableBackupError,
  createBackup,
  homebrewFilename,
  parseBackup,
  readHomebrewFile,
  restoreBackup,
} from '../src/data/backup';
import { loadHomebrewContent, loadHomebrewSources, saveHomebrewEntry, saveHomebrewSource, wipeAllData } from '../src/data/storage';

const SRC = { id: 'hbsrc-syn-1', name: 'Synthetic Forge' };
const FEAT = { id: 'syn-glass-anvil', name: 'Glass Anvil Stance', homebrewSourceId: SRC.id };

beforeEach(() => {
  localStorage.clear();
});

describe('a full backup carries the homebrew', () => {
  it('Export everything → wipe → Restore brings the homebrew back', () => {
    saveHomebrewSource(SRC);
    saveHomebrewEntry('feats', FEAT as never);
    const file = createBackup();
    const env = parseBackup(file);
    // The keys the backup names ARE the keys the homebrew writers use.
    // MUTATION PROOF (tried 2026-10-01): change BACKUP_HOMEBREW_CONTENT_KEY in backup.ts —
    //   TypeError: Cannot read properties of undefined (reading 'syn-glass-anvil')
    expect(JSON.parse(env.data[BACKUP_HOMEBREW_SOURCES_KEY])[SRC.id]).toMatchObject(SRC);
    expect(JSON.parse(env.data[BACKUP_HOMEBREW_CONTENT_KEY]).feats[FEAT.id]).toMatchObject(FEAT);

    wipeAllData();
    expect(loadHomebrewSources()).toEqual({});
    restoreBackup(parseBackup(file));
    expect(loadHomebrewSources()[SRC.id]).toMatchObject(SRC);
    expect(loadHomebrewContent().feats[FEAT.id]).toMatchObject(FEAT);
  });
});

describe('readHomebrewFile — what Homebrew → Import takes from a file', () => {
  it('from a full backup: ONLY the homebrew sources and content', () => {
    saveHomebrewSource(SRC);
    saveHomebrewEntry('feats', FEAT as never);
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-syn","character":{"name":"Synthetic Hero"}}]');
    localStorage.setItem('pf2e-codex.prefs', '{"compactActions":true}');
    const read = readHomebrewFile(createBackup());
    // MUTATION PROOF (tried 2026-10-01): drop the `obj.kind === BACKUP_KIND` branch and a backup (no
    // top-level sources/content) throws — Error: That file is not a homebrew export.
    expect(read.from).toBe('backup');
    if (read.from === 'old-empty-export') throw new Error('unreachable');
    expect(Object.keys(read)).toEqual(['from', 'sources', 'content']);
    expect(read.sources[SRC.id]).toMatchObject(SRC);
    expect(read.content.feats?.[FEAT.id]).toMatchObject(FEAT);
    expect(JSON.stringify(read)).not.toContain('Synthetic Hero');
    expect(JSON.stringify(read)).not.toContain('compactActions');
  });

  it('folds a backup’s pre-sources homebrew items in, the newer key winning', () => {
    localStorage.setItem('wanderers-codex:homebrew-items:v1', JSON.stringify({ 'old-ring': { id: 'old-ring', name: 'Old Ring' }, dup: { id: 'dup', name: 'Legacy' } }));
    localStorage.setItem(BACKUP_HOMEBREW_CONTENT_KEY, JSON.stringify({ items: { dup: { id: 'dup', name: 'Current' } } }));
    const read = readHomebrewFile(createBackup());
    if (read.from === 'old-empty-export') throw new Error('unreachable');
    expect(read.content.items?.['old-ring']).toMatchObject({ name: 'Old Ring' });
    expect(read.content.items?.dup).toMatchObject({ name: 'Current' });
  });

  it('a homebrew export reads as one; the empty file older versions saved is told apart; anything else throws', () => {
    const exp = JSON.stringify({ app: 'heroes-heaven', kind: 'homebrew', version: 1, sources: { [SRC.id]: SRC }, content: { feats: { [FEAT.id]: FEAT } } });
    const read = readHomebrewFile(exp);
    expect(read.from).toBe('export');
    expect(readHomebrewFile(OLD_EMPTY_HOMEBREW_EXPORT)).toEqual({ from: 'old-empty-export' });
    expect(readHomebrewFile(OLD_EMPTY_HOMEBREW_EXPORT + '\n')).toEqual({ from: 'old-empty-export' });
    expect(() => readHomebrewFile('not json')).toThrow();
    expect(() => readHomebrewFile('{"version":4,"character":{}}')).toThrow();
    expect(() => readHomebrewFile('[]')).toThrow();
  });

  it('only a file that says it is a homebrew export reads as one: kind "homebrew", and app "heroes-heaven" when it names one', () => {
    const body = { sources: { [SRC.id]: SRC }, content: { feats: { [FEAT.id]: FEAT } } };
    const read = (o: unknown) => () => readHomebrewFile(JSON.stringify(o));
    // MUTATION PROOF (tried 2026-10-01): drop readHomebrewFile's `obj.kind !== HOMEBREW_EXPORT_KIND …` check —
    //   AssertionError: expected [Function] to throw an error
    // The sheet's own Wanderer's Guide character export (src/data/transfer.ts exportWg) has a top-level
    // `content` object of its own — here one that would even hold a feat.
    expect(read({ version: 4, character: { name: 'Synthetic Wanderer' }, content: body.content })).toThrow('That file is not a homebrew export.');
    expect(read(body)).toThrow('That file is not a homebrew export.');
    expect(read({ app: 'another-app', kind: 'homebrew', ...body })).toThrow('That file is not a homebrew export.');
    expect(read({ app: 'heroes-heaven', kind: 'character', ...body })).toThrow('That file is not a homebrew export.');
    // Not a backup either, so the page words it generically.
    let err: unknown;
    try {
      read(body)();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnreadableBackupError);
    // Every real export carries both; `app` alone may be absent.
    expect(readHomebrewFile(JSON.stringify({ app: 'heroes-heaven', kind: HOMEBREW_EXPORT_KIND, version: 1, ...body })).from).toBe('export');
    expect(readHomebrewFile(JSON.stringify({ kind: 'homebrew', ...body })).from).toBe('export');
  });

  it('a backup this version cannot read throws UnreadableBackupError with the backup reader’s own words', () => {
    const env = JSON.parse(createBackup());
    env.formatVersion = 99;
    // MUTATION PROOF (tried 2026-10-01): call parseBackup bare in readHomebrewFile (no wrap) —
    //   AssertionError: expected error to be instance of UnreadableBackupError
    expect(() => readHomebrewFile(JSON.stringify(env))).toThrow(UnreadableBackupError);
    expect(() => readHomebrewFile(JSON.stringify(env))).toThrow(/format version 99.*Update the app, then try again\./);
    delete env.data;
    env.formatVersion = 1;
    expect(() => readHomebrewFile(JSON.stringify(env))).toThrow(UnreadableBackupError);
    // A file that is not a backup at all is a plain Error, which the page words generically.
    let other: unknown;
    try {
      readHomebrewFile('{"version":4,"character":{}}');
    } catch (e) {
      other = e;
    }
    expect(other).toBeInstanceOf(Error);
    expect(other).not.toBeInstanceOf(UnreadableBackupError);
  });
});

describe('homebrewFilename', () => {
  it('is heroes-heaven-homebrew-YYYY-MM-DD.json with zero-padded parts', () => {
    expect(homebrewFilename(new Date(2026, 9, 1))).toBe('heroes-heaven-homebrew-2026-10-01.json');
    expect(homebrewFilename(new Date(2026, 0, 9))).toBe('heroes-heaven-homebrew-2026-01-09.json');
  });
});
