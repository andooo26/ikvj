import { describe, expect, it } from 'vitest';
import { formatTime } from './format';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [59.9, '0:59'],
    [61, '1:01'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [Number.NaN, '0:00'],
    [-5, '0:00'],
  ])('%s -> %s', (sec, text) => {
    expect(formatTime(sec)).toBe(text);
  });
});
