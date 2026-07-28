import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { cleanRun, stripAonMarkers } from '../src/sheet/RichText';

const c = content();

/**
 * Archives of Nethys links terms with its own template syntax, `<%CAT%ID%%>label<%END>`, and a few
 * records ship it unsubstituted. It leaked to the screen because the HTML-tag stripper only matches
 * tags that start with a LETTER, and `<%` does not.
 */
describe('unresolved AoN template markers', () => {
  it('keeps the label and drops the wrapper', () => {
    expect(stripAonMarkers('5-foot <%RULES%2387%%>emanation<%END>')).toBe('5-foot emanation');
    expect(stripAonMarkers('60-foot <%RULES%2386%%>cone<%END>')).toBe('60-foot cone');
  });

  it('drops stray openers and closers', () => {
    expect(stripAonMarkers('Politics (master) or <%%32%%> Warfare <%END> (expert)')).toBe(
      'Politics (master) or  Warfare  (expert)',
    );
  });

  it('cleanRun handles them even when they arrive HTML-escaped', () => {
    // The ordering matters: decode entities FIRST, then strip — the tracker's cleaner had this
    // backwards, so escaped markers survived and were decoded into view afterwards.
    expect(cleanRun('5-foot &lt;%RULES%2387%%&gt;emanation&lt;%END&gt;')).toBe('5-foot emanation');
  });

  it('leaves ordinary text alone', () => {
    expect(cleanRun('30-foot cone')).toBe('30-foot cone');
    expect(cleanRun('1 minute')).toBe('1 minute');
    expect(stripAonMarkers('100% of the time')).toBe('100% of the time');
  });

  it('no spell stat line renders a marker after cleaning', () => {
    const marker = /<%|%%>|<%END>/;
    for (const s of Object.values(c.spells)) {
      for (const field of ['range', 'area', 'targets', 'duration'] as const) {
        const v = s[field];
        if (typeof v === 'string' && v) {
          expect(marker.test(cleanRun(v)), `${s.name}.${field} -> ${cleanRun(v)}`).toBe(false);
        }
      }
    }
  });

  it('the record that exposed this reads correctly', () => {
    // `aon-discomfiting-whisper` is the only shipped record with an unresolved marker. It is also an
    // `aon-` duplicate, so it is already hidden from pickers — but it stays REACHABLE by id (a
    // character may have picked it), which is exactly why the render-time cleaner still matters.
    const spell = c.spells['aon-discomfiting-whisper'];
    expect(spell?.area).toBe('5-foot <%RULES%2387%%>emanation<%END>');
    expect(cleanRun(spell!.area!)).toBe('5-foot emanation');
    expect(c.duplicateIds?.has('aon-discomfiting-whisper')).toBe(true);
  });
});
