import { describe, expect, it } from 'vitest';
import { isFading, liveOpacity, moveOnto } from './mixer';
import { initialState } from './state';

describe('moveOnto', () => {
  const list = ['D', 'C', 'B', 'A'];

  it('moves an item later into the target position', () => {
    expect(moveOnto(list, 'D', 'B')).toEqual(['C', 'B', 'D', 'A']);
  });

  it('moves an item earlier into the target position', () => {
    expect(moveOnto(list, 'A', 'C')).toEqual(['D', 'A', 'C', 'B']);
  });

  it('swaps neighbours', () => {
    expect(moveOnto(list, 'C', 'D')).toEqual(['C', 'D', 'B', 'A']);
    expect(moveOnto(list, 'D', 'C')).toEqual(['C', 'D', 'B', 'A']);
  });

  it('leaves the list alone for a no-op or unknown item', () => {
    expect(moveOnto(list, 'B', 'B')).toEqual(list);
    expect(moveOnto(list, 'X', 'B')).toEqual(list);
  });
});

describe('liveOpacity', () => {
  const base = initialState().mixer;
  const fading = {
    ...base,
    opacity: { A: 0, B: 1, C: 0, D: 0 },
    fade: { from: { A: 1, B: 0, C: 0, D: 0 }, start: 1000, duration: 1000 },
  };

  it('is the resting opacity when nothing is fading', () => {
    expect(liveOpacity(base, 123)).toBe(base.opacity);
  });

  it('eases: slow at both ends, half way at the midpoint', () => {
    const quarter = liveOpacity(fading, 1250).B;
    expect(quarter).toBeLessThan(0.25);
    expect(liveOpacity(fading, 1500).B).toBeCloseTo(0.5);
    expect(liveOpacity(fading, 1750).B).toBeCloseTo(1 - quarter);
  });

  it('holds the start before the fade begins and the target after it ends', () => {
    expect(liveOpacity(fading, 0)).toEqual(fading.fade.from);
    expect(liveOpacity(fading, 9999)).toBe(fading.opacity);
  });

  it('reports whether a fade is still running', () => {
    expect(isFading(fading, 1999)).toBe(true);
    expect(isFading(fading, 2000)).toBe(false);
    expect(isFading(base, 0)).toBe(false);
  });
});
