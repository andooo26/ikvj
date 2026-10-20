import { describe, expect, it } from 'vitest';
import { parseAction } from './actions';

describe('parseAction', () => {
  it('accepts a valid action', () => {
    expect(parseAction({ type: 'mixer/setOpacity', source: 'C', value: 0.5 })).toEqual({
      ok: true,
      action: { type: 'mixer/setOpacity', source: 'C', value: 0.5 },
    });
  });

  it.each([
    ['unknown type', { type: 'nope' }],
    ['not an object', 'mixer/setOpacity'],
    ['unknown source', { type: 'mixer/setOpacity', source: 'E', value: 0.5 }],
    ['opacity above 1', { type: 'mixer/setOpacity', source: 'A', value: 1.5 }],
    ['opacity NaN', { type: 'mixer/setOpacity', source: 'A', value: Number.NaN }],
    ['order with a duplicate', { type: 'mixer/reorder', order: ['A', 'A', 'B', 'C'] }],
    ['order missing a source', { type: 'mixer/reorder', order: ['A', 'B', 'C'] }],
    ['bpm out of range', { type: 'clock/setBpm', bpm: 10 }],
    ['unsupported fps', { type: 'settings/set', fps: 50 }],
    ['unsupported resolution', { type: 'settings/set', resolution: '4320p' }],
  ])('rejects %s', (_label, input) => {
    expect(parseAction(input).ok).toBe(false);
  });
});
