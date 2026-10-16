import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs script with no type declarations
import { routes, violations } from '../scripts/sw-freshness-check.mjs';

/**
 * scripts/sw-freshness-check.mjs (in `npm run verify`) — the freshness rule for the web build's
 * service worker, 2026-10-16. A phone ran new code on months-old rules data because a runtime-cache
 * route served a FIXED URL CacheFirst. These cases prove the check passes today and REJECTS the real
 * bad config it was written for.
 */

const ROOT = path.join(__dirname, '..');
type Check = (config: string, read: (f: string) => string) => string[];
const check = violations as Check;
const readNow = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const readAt = (rev: string) => (f: string) => execFileSync('git', ['show', `${rev}:${f}`], { cwd: ROOT, encoding: 'utf8' });

describe('service worker freshness rule', () => {
  it('today: every route either asks the network first or serves only versioned URLs', () => {
    expect(check(readNow('vite.config.ts'), readNow)).toEqual([]);
  });

  it('the parser sees both routes (rules data + tracker data)', () => {
    expect((routes as (c: string) => { handler: string }[])(readNow('vite.config.ts')).map((r) => r.handler)).toEqual(['CacheFirst', 'NetworkFirst']);
  });

  // The planted bad case is the real one: v0.1.44's config and loader, which kept a phone on its first
  // visit's rules data. The rule must reject it on BOTH counts.
  it('rejects v0.1.44 (3c358ff): a fixed-URL CacheFirst rules route and a StaleWhileRevalidate tracker route', () => {
    const bad = check(readAt('3c358ff')('vite.config.ts'), readAt('3c358ff'));
    expect(bad.some((b) => b.includes('core') && b.includes('no longer puts the version'))).toBe(true);
    expect(bad.some((b) => b.startsWith('StaleWhileRevalidate') && b.includes('/data/'))).toBe(true);
  });

  it('runs as a command for npm run verify', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/sw-freshness-check.mjs')], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/sw-freshness-check: OK/);
    expect(JSON.parse(readNow('package.json')).scripts.verify).toContain('node scripts/sw-freshness-check.mjs');
  });
});
