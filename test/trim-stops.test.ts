import { describe, it, expect } from 'vitest';
import { trimStops } from '../src/sheet/FilterableSelect';
import { RANGE_STOPS } from '../src/rules/filterValues';

const labels = (stops: { label: string }[]) => stops.map((s) => s.label);

describe('trimStops — restrict a slider scale to the values present in the list', () => {
  it('keeps only stops bracketing the data (Touch…120 for a 0–120 list)', () => {
    const out = trimStops(RANGE_STOPS, [0, 30, 60, 120]);
    expect(labels(out)).toEqual(['Touch', '5 ft', '10 ft', '15 ft', '30 ft', '60 ft', '100 ft', '120 ft']);
    expect(out[out.length - 1].value).toBe(120); // no 500/1000/mi/∞
  });

  it('brackets values that fall between stops', () => {
    // mags 40 and 45 sit between the 30 and 60 stops → scale is just 30–60.
    const out = trimStops(RANGE_STOPS, [40, 45]);
    expect(labels(out)).toEqual(['30 ft', '60 ft']);
  });

  it('includes the ∞ stop when an unlimited value is present', () => {
    const out = trimStops(RANGE_STOPS, [60, Infinity]);
    expect(out[0].value).toBe(60);
    expect(out[out.length - 1].value).toBe(Infinity);
  });

  it('falls back to the full scale when it cannot narrow (single bucket / no data)', () => {
    expect(trimStops(RANGE_STOPS, [])).toEqual(RANGE_STOPS);
    expect(trimStops(RANGE_STOPS, [30, 30]).length).toBe(RANGE_STOPS.length); // degenerate → full
  });

  it('the trimmed default range still passes every item in the list', () => {
    const mags = [0, 15, 60, 120];
    const out = trimStops(RANGE_STOPS, mags);
    const lo = out[0].value;
    const hi = out[out.length - 1].value;
    expect(mags.every((m) => m >= lo && m <= hi)).toBe(true);
  });
});
