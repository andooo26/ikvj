import { describe, expect, it } from 'vitest';
import { moveOnto } from './mixer';

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
