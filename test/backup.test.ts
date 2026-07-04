import { describe, it, expect, beforeEach } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  backupCharCount,
  backupFilename,
  createBackup,
  parseBackup,
  restoreBackup,
  type BackupEnvelope,
} from '../src/data/backup';
import { wipeAllData } from '../src/data/storage';

function mockStorage() {
  const store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as unknown as Storage;
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = mockStorage();
});

describe('createBackup', () => {
  it('snapshots every stored key into a versioned envelope', () => {
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-1","character":{}}]');
    localStorage.setItem('pf2e-codex.prefs', '{"compactActions":true}');
    localStorage.setItem('some-future-key', 'kept-as-is');

    const env = JSON.parse(createBackup()) as BackupEnvelope;

    expect(env.app).toBe('heroes-heaven');
    expect(env.kind).toBe('full-backup');
    expect(env.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(typeof env.appVersion).toBe('string');
    expect(new Date(env.savedAt).toString()).not.toBe('Invalid Date');
    expect(env.data['wanderers-codex:roster:v1']).toBe('[{"id":"c-1","character":{}}]');
    expect(env.data['pf2e-codex.prefs']).toBe('{"compactActions":true}');
    expect(env.data['some-future-key']).toBe('kept-as-is');
  });

  it('always includes the roster/homebrew/modes keys, even on a fresh device', () => {
    const env = JSON.parse(createBackup()) as BackupEnvelope;
    expect(env.data['wanderers-codex:roster:v1']).toBe('[]');
    expect(env.data['wanderers-codex:homebrew-sources:v1']).toBe('{}');
    expect(env.data['wanderers-codex:homebrew-content:v1']).toBe('{}');
    expect(env.data['wanderers-codex:modes:v1']).toBe('{}');
  });
});

describe('backupFilename', () => {
  it('is heroes-heaven-backup-YYYY-MM-DD.json with zero-padded parts', () => {
    expect(backupFilename(new Date(2026, 6, 2))).toBe('heroes-heaven-backup-2026-07-02.json');
  });
});

describe('parseBackup', () => {
  it('accepts a file made by createBackup', () => {
    localStorage.setItem('wanderers-codex:roster:v1', '[1,2,3]');
    const env = parseBackup(createBackup());
    expect(backupCharCount(env)).toBe(3);
  });

  it('rejects non-JSON', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/);
  });

  it('rejects JSON that is not a Heroes Heaven backup', () => {
    expect(() => parseBackup('{"version":4,"character":{}}')).toThrow(/not a Heroes Heaven backup/);
    expect(() => parseBackup('{"app":"heroes-heaven","kind":"character"}')).toThrow(/not a Heroes Heaven backup/);
    expect(() => parseBackup('null')).toThrow(/not a Heroes Heaven backup/);
  });

  it('rejects an unknown format version with a clear message', () => {
    const env = JSON.parse(createBackup()) as BackupEnvelope;
    const future = JSON.stringify({ ...env, formatVersion: 99 });
    expect(() => parseBackup(future)).toThrow(/format version 99/);
  });

  it('rejects a backup without a data object', () => {
    const env = JSON.parse(createBackup()) as { data: unknown };
    expect(() => parseBackup(JSON.stringify({ ...env, data: undefined }))).toThrow(/no data section/);
    expect(() => parseBackup(JSON.stringify({ ...env, data: [] }))).toThrow(/no data section/);
  });
});

describe('restoreBackup', () => {
  it('round-trips: export → wipe → restore reproduces every key', () => {
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-1","character":{}}]');
    localStorage.setItem('wanderers-codex:homebrew-content:v1', '{"items":{"hb-1":{}}}');
    localStorage.setItem('pf2e-codex.appearance', '{"themeId":"dark"}');
    const file = createBackup();

    wipeAllData();
    expect(localStorage.length).toBe(0);

    restoreBackup(parseBackup(file));
    expect(localStorage.getItem('wanderers-codex:roster:v1')).toBe('[{"id":"c-1","character":{}}]');
    expect(localStorage.getItem('wanderers-codex:homebrew-content:v1')).toBe('{"items":{"hb-1":{}}}');
    expect(localStorage.getItem('pf2e-codex.appearance')).toBe('{"themeId":"dark"}');
  });

  it('writes unknown app keys as-is (forward compat) and CLEARS target-only keys the backup omits', () => {
    // A newer feature's key lives only on this device (not in the backup): "replace everything" must
    // remove it so the restore truly matches the backup rather than leaving stray target-device data.
    localStorage.setItem('pf2e-codex.zoom', '1.2');
    const env = parseBackup(createBackup());
    delete env.data['pf2e-codex.zoom'];
    env.data['pf2e-codex.some-newer-feature'] = '{"on":true}';

    localStorage.setItem('wanderers-codex:roster:v1', '["overwritten"]');
    const written = restoreBackup(env);

    // Empty-string ALWAYS_KEYS placeholders (active/prefs/appearance the source never wrote) are
    // skipped on write, so `written` counts only the real values.
    const nonEmpty = Object.values(env.data).filter((v) => typeof v === 'string' && v !== '').length;
    expect(written).toBe(nonEmpty);
    expect(localStorage.getItem('pf2e-codex.some-newer-feature')).toBe('{"on":true}');
    expect(localStorage.getItem('pf2e-codex.zoom')).toBe(null); // target-only key cleared
    expect(localStorage.getItem('wanderers-codex:roster:v1')).toBe('[]'); // roster always replaced
  });

  it('is ATOMIC: a mid-write failure rolls back to the original state', () => {
    // Seed a device with real data, then take a backup that will be restored on top of NEW data.
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-restored","character":{}}]');
    localStorage.setItem('wanderers-codex:homebrew-content:v1', '{"items":{"hb-restored":{}}}');
    const file = createBackup();

    // Now the device holds different, must-not-be-lost data.
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-original","character":{}}]');
    localStorage.setItem('wanderers-codex:homebrew-content:v1', '{"items":{"hb-original":{}}}');
    localStorage.setItem('wanderers-codex:modes:v1', '{"m-original":{}}');

    // Inject a setItem that fails partway through the FORWARD write (a restored value), simulating a
    // quota error mid-restore. Rollback writes back the '-original' snapshot values, which must still
    // succeed (they fit — we just cleared everything), so only the forward '-restored' writes throw.
    const realSet = localStorage.setItem.bind(localStorage);
    let restoredWrites = 0;
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = (k: string, v: string) => {
      if (v.includes('restored') && ++restoredWrites > 1) throw new DOMException('quota', 'QuotaExceededError');
      realSet(k, v);
    };

    expect(() => restoreBackup(parseBackup(file))).toThrow(/Restore failed/);

    // Restore the real setItem so later tests aren't affected.
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = realSet;

    // Rollback must have reproduced the ORIGINAL (pre-restore) values, not left a half-restored mix.
    expect(localStorage.getItem('wanderers-codex:roster:v1')).toBe('[{"id":"c-original","character":{}}]');
    expect(localStorage.getItem('wanderers-codex:homebrew-content:v1')).toBe('{"items":{"hb-original":{}}}');
    expect(localStorage.getItem('wanderers-codex:modes:v1')).toBe('{"m-original":{}}');
  });

  it('replaces roster + homebrew even when restoring a fresh device’s backup', () => {
    const freshFile = createBackup(); // nothing stored yet → empty required keys
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-old","character":{}}]');
    localStorage.setItem('wanderers-codex:homebrew-content:v1', '{"items":{"hb-old":{}}}');

    restoreBackup(parseBackup(freshFile));
    expect(localStorage.getItem('wanderers-codex:roster:v1')).toBe('[]');
    expect(localStorage.getItem('wanderers-codex:homebrew-content:v1')).toBe('{}');
  });
});
