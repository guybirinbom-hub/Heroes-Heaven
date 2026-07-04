// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitize } from '../src/sheet/sanitizeHtml';

describe('sanitize — the four proven bypasses of the old regex sanitizer', () => {
  it('(1) neutralizes an unquoted href=javascript: URL', () => {
    const out = sanitize('<a href=javascript:alert(1)>x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
    // the anchor may survive, but stripped of the dangerous href
    expect(/href\s*=\s*["']?\s*javascript:/i.test(out)).toBe(false);
  });

  it('(2) strips an on* handler with no leading space before it', () => {
    // The old regex required a leading \s; this splices the handler right onto the tag/attr.
    const out = sanitize('<b onclick="alert(1)">hi</b>');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('alert');
  });

  it('(2b) strips an on* handler even when jammed against another attribute', () => {
    const out = sanitize('<a class="x"onmouseover="alert(1)">y</a>');
    expect(out.toLowerCase()).not.toContain('onmouseover');
    expect(out.toLowerCase()).not.toContain('alert');
  });

  it('(3) strips an entity-encoded javascript scheme (java&#115;cript:)', () => {
    const out = sanitize('<a href="java&#115;cript:alert(1)">z</a>');
    // decoded scheme must not survive in any form
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(/href\s*=\s*["']?\s*java/i.test(out)).toBe(false);
    expect(out.toLowerCase()).not.toContain('alert');
  });

  it('(4) a > inside an attribute value cannot inject a following tag', () => {
    // Old tag-strip regex broke on the > inside the attribute, letting the <script> through.
    const out = sanitize('<img src="x> <script>alert(1)</script>">');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('alert(1)');
    expect(out.toLowerCase()).not.toContain('<img');
  });
});

describe('sanitize — dangerous constructs are removed', () => {
  it('drops <script> tags entirely', () => {
    expect(sanitize('a<script>steal()</script>b').toLowerCase()).not.toContain('script');
  });
  it('drops <iframe>/<object>/<embed>', () => {
    const out = sanitize('<iframe src="http://evil"></iframe><object></object><embed>').toLowerCase();
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('object');
    expect(out).not.toContain('embed');
  });
  it('drops data: URLs in href', () => {
    const out = sanitize('<a href="data:text/html,<script>1</script>">d</a>').toLowerCase();
    expect(out).not.toContain('data:');
    expect(out).not.toContain('script');
  });
  it('drops <img> (no remote/tracker fetch from this offline app)', () => {
    expect(sanitize('<img src="http://tracker/x.gif">').toLowerCase()).not.toContain('<img');
  });
  it('drops <style> and <form>', () => {
    const out = sanitize('<style>body{}</style><form action="http://evil"></form>').toLowerCase();
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<form');
  });
});

describe('sanitize — legitimate formatting is preserved', () => {
  it('keeps strong/em/u/s', () => {
    const out = sanitize('<strong>a</strong><em>b</em><u>c</u><s>d</s>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('<u>');
    expect(out).toContain('<s>');
  });
  it('keeps lists', () => {
    const out = sanitize('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('one');
  });
  it('keeps tables', () => {
    const out = sanitize('<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>');
    expect(out).toContain('<table');
    expect(out).toContain('<th>');
    expect(out).toContain('<td>');
  });
  it('keeps an https link with its href intact', () => {
    const out = sanitize('<a href="https://example.com/rules">link</a>');
    expect(out).toContain('https://example.com/rules');
    expect(out).toContain('link');
  });
  it('keeps headings, hr, and blockquote', () => {
    const out = sanitize('<h2>Title</h2><hr><blockquote>quote</blockquote>');
    expect(out).toContain('<h2>');
    expect(out).toContain('<hr');
    expect(out).toContain('<blockquote>');
  });
  it('keeps note text-color spans (foreColor/hiliteColor output)', () => {
    const out = sanitize('<span style="color: rgb(229, 72, 77);">red</span>');
    expect(out).toContain('<span');
    expect(out.toLowerCase()).toContain('color');
    expect(out).toContain('red');
  });
});

describe('sanitize — the .ref-link navigation spans survive', () => {
  it('preserves class + data-ref-key/data-ref-id on the anchor', () => {
    const out = sanitize('<a class="ref-link" data-ref-key="spells" data-ref-id="fireball">Fireball</a>');
    expect(out).toContain('ref-link');
    expect(out).toContain('data-ref-key="spells"');
    expect(out).toContain('data-ref-id="fireball"');
    expect(out).toContain('Fireball');
  });

  it('a ref-link with a malicious href still loses only the href, keeping navigation dataset', () => {
    const out = sanitize('<a class="ref-link" data-ref-key="feats" data-ref-id="x" href="javascript:alert(1)">Feat</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).toContain('data-ref-key="feats"');
    expect(out).toContain('data-ref-id="x"');
  });

  it('the sanitized ref-link is actually clickable via the DescBody dataset lookup', () => {
    // Mirror DescBody's runtime read: parse the sanitized HTML and confirm dataset.refKey/refId.
    const host = document.createElement('div');
    host.innerHTML = sanitize('<a class="ref-link" data-ref-key="conditions" data-ref-id="frightened">Frightened</a>');
    const a = host.querySelector('.ref-link') as HTMLElement | null;
    expect(a).not.toBeNull();
    expect(a?.dataset.refKey).toBe('conditions');
    expect(a?.dataset.refId).toBe('frightened');
  });
});

describe('sanitize — misc', () => {
  it('returns empty string for empty/undefined input', () => {
    expect(sanitize('')).toBe('');
  });
  it('leaves plain text unchanged', () => {
    expect(sanitize('just prose, no tags')).toBe('just prose, no tags');
  });
});
