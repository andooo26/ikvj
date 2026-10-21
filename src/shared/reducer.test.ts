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

  it('opens search-bar input as a playable URL', () => {
    const prev = initialState();
    const s = reduce(prev, { type: 'youtube/open', source: 'A', input: 'youtu.be/aqz-KE-bpKQ' });
    expect(s.sources.A.url).toBe('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(s.sources.B).toBe(prev.sources.B);
  });

  it('ignores empty search-bar input', () => {
    const prev = initialState();
    expect(reduce(prev, { type: 'youtube/open', source: 'A', input: '  ' })).toBe(prev);
  });

  it('follows navigation, but returns the same state when nothing changed', () => {
    const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
    const s = reduce(initialState(), { type: 'youtube/navigated', source: 'B', url });
    expect(s.sources.B.url).toBe(url);
    expect(reduce(s, { type: 'youtube/navigated', source: 'B', url })).toBe(s);
  });

  it('sets quality and mute per player', () => {
    let s = reduce(initialState(), { type: 'youtube/setQuality', source: 'B', quality: 'hd720' });
    s = reduce(s, { type: 'youtube/setMuted', source: 'B', muted: true });
    expect(s.sources.B).toMatchObject({ quality: 'hd720', muted: true });
    expect(s.sources.A).toMatchObject({ quality: 'highest', muted: false });
  });

  it('patches only the given generative parameters', () => {
    const prev = initialState();
    const s = reduce(prev, { type: 'gen/set', source: 'D', genre: 'dnb', tint: -0.5 });
    expect(s.sources.D).toEqual({ ...prev.sources.D, genre: 'dnb', tint: -0.5 });
    expect(s.sources.C).toBe(prev.sources.C);
  });
});
