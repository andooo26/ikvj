import { describe, expect, it } from 'vitest';
import { parseCommand, parsePointerInput } from './commands';

describe('parseCommand', () => {
  it('accepts transport commands for YouTube sources', () => {
    expect(parseCommand({ type: 'player/skip', source: 'B', delta: -0.5 }).ok).toBe(true);
  });

  it.each([
    ['a generative source', { type: 'player/togglePlay', source: 'C' }],
    ['a negative seek', { type: 'player/seek', source: 'A', time: -1 }],
    ['an unknown command', { type: 'player/eject', source: 'A' }],
  ])('rejects %s', (_label, input) => {
    expect(parseCommand(input).ok).toBe(false);
  });
});

describe('parsePointerInput', () => {
  const click = {
    source: 'A',
    kind: 'down',
    x: 0.5,
    y: 0.25,
    button: 'left',
    clickCount: 1,
    deltaX: 0,
    deltaY: 0,
    modifiers: ['shift'],
  };

  it('accepts a pointer event', () => {
    expect(parsePointerInput(click)).toEqual(click);
  });

  it('rejects coordinates outside the preview', () => {
    expect(parsePointerInput({ ...click, x: 1.5 })).toBeNull();
  });

  it('rejects unknown modifiers', () => {
    expect(parsePointerInput({ ...click, modifiers: ['hyper'] })).toBeNull();
  });
});
