import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isNewerVersion, parseVersion } from '../src/data/updateCheck';

describe('parseVersion', () => {
  it('parses x.y.z with or without a leading v', () => {
    expect(parseVersion('v0.1.5')).toEqual([0, 1, 5]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion(' v10.20.30 ')).toEqual([10, 20, 30]);
  });

  it('returns null for anything that is not a plain x.y.z', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('0.1')).toBeNull();
    expect(parseVersion('1.2.3-beta')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('compares major, minor, patch in order', () => {
    expect(isNewerVersion('v0.1.5', '0.1.4')).toBe(true);
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('v1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('v0.1.4', '0.1.4')).toBe(false);
    expect(isNewerVersion('v0.1.3', '0.1.4')).toBe(false);
    expect(isNewerVersion('v0.10.0', '0.9.0')).toBe(true); // numeric, not lexicographic
  });

  it('never reports an unparseable version as newer', () => {
    expect(isNewerVersion('latest', '0.1.4')).toBe(false);
    expect(isNewerVersion('v9.9.9', 'garbage')).toBe(false);
  });
});

/** checkForUpdate memoizes per module instance, so each test imports a fresh copy. */
async function freshCheck() {
  vi.resetModules();
  const mod = await import('../src/data/updateCheck');
  return mod.checkForUpdate;
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;
}

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the tag when the latest release is newer than the app', async () => {
    vi.stubGlobal('fetch', fetchReturning(200, { tag_name: 'v999.0.0' }));
    const checkForUpdate = await freshCheck();
    expect(await checkForUpdate()).toBe('v999.0.0');
  });

  it('returns null when the latest release is not newer', async () => {
    vi.stubGlobal('fetch', fetchReturning(200, { tag_name: 'v0.0.1' }));
    const checkForUpdate = await freshCheck();
    expect(await checkForUpdate()).toBeNull();
  });

  it('returns null on API errors, bad payloads, and network failures — never throws', async () => {
    vi.stubGlobal('fetch', fetchReturning(403, { message: 'rate limited' }));
    expect(await (await freshCheck())()).toBeNull();

    vi.stubGlobal('fetch', fetchReturning(200, { tag_name: 12345 }));
    expect(await (await freshCheck())()).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
    expect(await (await freshCheck())()).toBeNull();
  });

  it('fetches at most once per session (later calls share the memoized promise)', async () => {
    const f = fetchReturning(200, { tag_name: 'v999.0.0' });
    vi.stubGlobal('fetch', f);
    const checkForUpdate = await freshCheck();
    expect(await checkForUpdate()).toBe('v999.0.0');
    expect(await checkForUpdate()).toBe('v999.0.0');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
