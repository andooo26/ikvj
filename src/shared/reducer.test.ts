import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { liveOpacity } from './mixer';
import { reduce as reduceAt } from './reducer';
import { initialState, type AppState } from './state';

const reduce = (s: AppState, a: Action) => reduceAt(s, a, 0);

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

  describe('solo', () => {
    it('fades the chosen channel up and the rest out from where they are', () => {
      const s = reduceAt(initialState(), { type: 'mixer/solo', source: 'C' }, 5000);
      expect(s.mixer.opacity).toEqual({ A: 0, B: 0, C: 1, D: 0 });
      expect(s.mixer.fade).toEqual({ from: { A: 1, B: 0, C: 0, D: 0 }, start: 5000, duration: 1000 });
      expect(liveOpacity(s.mixer, 5000)).toEqual({ A: 1, B: 0, C: 0, D: 0 });
      expect(liveOpacity(s.mixer, 5500)).toEqual({ A: 0.5, B: 0, C: 0.5, D: 0 });
      expect(liveOpacity(s.mixer, 6000)).toEqual({ A: 0, B: 0, C: 1, D: 0 });
    });

    it('cuts immediately when the fade length is 0', () => {
      let s = reduce(initialState(), { type: 'mixer/setFadeMs', ms: 0 });
      s = reduceAt(s, { type: 'mixer/solo', source: 'B' }, 100);
      expect(s.mixer.fade).toBeNull();
      expect(liveOpacity(s.mixer, 100)).toEqual({ A: 0, B: 1, C: 0, D: 0 });
    });

    it('starts a new solo from mid-fade without jumping', () => {
      let s = reduceAt(initialState(), { type: 'mixer/solo', source: 'C' }, 0);
      s = reduceAt(s, { type: 'mixer/solo', source: 'D' }, 500);
      expect(s.mixer.fade?.from).toEqual({ A: 0.5, B: 0, C: 0.5, D: 0 });
    });

    it('lets a fader move cancel the fade, freezing the other channels', () => {
      let s = reduceAt(initialState(), { type: 'mixer/solo', source: 'C' }, 0);
      s = reduceAt(s, { type: 'mixer/setOpacity', source: 'B', value: 0.3 }, 500);
      expect(s.mixer.fade).toBeNull();
      expect(s.mixer.opacity).toEqual({ A: 0.5, B: 0.3, C: 0.5, D: 0 });
    });
  });

  it('sets projector target and display independently', () => {
    let s = reduce(initialState(), { type: 'projector/set', displayId: 7 });
    s = reduce(s, { type: 'projector/set', target: 'C' });
    expect(s.projector).toEqual({ target: 'C', displayId: 7, open: false });
  });

  it('opens the projector, and returns the same state when nothing changes', () => {
    const s = reduce(initialState(), { type: 'projector/setOpen', open: true });
    expect(s.projector.open).toBe(true);
    expect(reduce(s, { type: 'projector/setOpen', open: true })).toBe(s);
  });
});
