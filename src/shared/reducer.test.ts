import { describe, expect, it } from 'vitest';
import { reduce } from './reducer';
import { initialState } from './state';

describe('reduce', () => {
  it('sets one channel opacity without touching the others', () => {
    const s = reduce(initialState(), { type: 'mixer/setOpacity', source: 'C', value: 0.25 });
    expect(s.mixer.opacity).toEqual({ A: 1, B: 0, C: 0.25, D: 0 });
  });

  it('replaces the layer order', () => {
    const s = reduce(initialState(), { type: 'mixer/reorder', order: ['D', 'C', 'B', 'A'] });
    expect(s.mixer.order).toEqual(['D', 'C', 'B', 'A']);
  });

  it('toggles a per-source output', () => {
    const s = reduce(initialState(), { type: 'output/set', source: 'B', on: true });
    expect(s.outputs).toEqual({ A: false, B: true, C: false, D: false });
  });

  it('updates only the given settings', () => {
    const s = reduce(initialState(), { type: 'settings/set', fps: 30 });
    expect(s.settings).toEqual({ resolution: '1080p', fps: 30 });
  });

  it('keeps unrelated branches identical so subscribers can diff by reference', () => {
    const prev = initialState();
    const next = reduce(prev, { type: 'clock/setBpm', bpm: 140 });
    expect(next.clock.bpm).toBe(140);
    expect(next.settings).toBe(prev.settings);
    expect(next.outputs).toBe(prev.outputs);
    expect(next.mixer).toBe(prev.mixer);
  });
});
