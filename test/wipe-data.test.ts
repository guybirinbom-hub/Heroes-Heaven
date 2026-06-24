import { describe, it, expect, beforeEach } from 'vitest';
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

describe('wipeAllData', () => {
  it('removes every stored key and reports how many were removed', () => {
    localStorage.setItem('wanderers-codex:roster:v1', '[{}]');
    localStorage.setItem('wanderers-codex:homebrew-items:v1', '{}');
    localStorage.setItem('wanderers-codex:modes:v1', '{}');
    localStorage.setItem('theme', 'dark');
    expect(localStorage.length).toBe(4);

    const removed = wipeAllData();

    expect(removed).toBe(4);
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('wanderers-codex:roster:v1')).toBeNull();
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('is a no-op (returns 0) when there is nothing stored', () => {
    expect(wipeAllData()).toBe(0);
  });
});
