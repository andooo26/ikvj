import { describe, expect, it } from 'vitest';
import { fromPersisted, toPersisted } from './persist';
import { initialState, type AppState } from './state';

function customized(): AppState {
  const s = initialState();
  return {
    ...s,
    settings: { resolution: '720p', fps: 30 },
    clock: { bpm: 140, beatEpoch: 123 },
    sources: {
      ...s.sources,
      A: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', quality: 'hd1080', muted: true },
      D: { kind: 'gen', genre: 'dnb', intensity: 0.9, tint: -0.4, seed: 777 },
    },
    mixer: {
      order: ['D', 'C', 'B', 'A'],
      opacity: { A: 0.1, B: 0.2, C: 0.3, D: 0.4 },
      fadeMs: 2000,
      fade: { from: { A: 1, B: 0, C: 0, D: 0 }, start: 5, duration: 2000 },
    },
    outputs: { A: true, B: false, C: true, D: false },
    projector: { target: 'C', displayId: 42, open: true },
  };
}

describe('persist round trip', () => {
  it('restores what was saved, through JSON', () => {
    const saved = JSON.parse(JSON.stringify(toPersisted(customized())));
    const restored = fromPersisted(saved, initialState());
    const expected = customized();
    expect(restored.settings).toEqual(expected.settings);
    expect(restored.sources).toEqual(expected.sources);
    expect(restored.mixer.order).toEqual(expected.mixer.order);
    expect(restored.mixer.opacity).toEqual(expected.mixer.opacity);
    expect(restored.mixer.fadeMs).toBe(2000);
    expect(restored.outputs).toEqual(expected.outputs);
    expect(restored.clock.bpm).toBe(140);
  });

  it('never restores an open projector, a running fade or the beat epoch', () => {
    const base = initialState();
    const restored = fromPersisted(JSON.parse(JSON.stringify(toPersisted(customized()))), base);
    expect(restored.projector).toEqual({ target: 'C', displayId: 42, open: false });
    expect(restored.mixer.fade).toBeNull();
    expect(restored.clock.beatEpoch).toBe(base.clock.beatEpoch);
  });
});

describe('fromPersisted with bad input', () => {
  it.each([null, 'text', 42, [], { version: 99 }])('falls back to the base for %j', (raw) => {
    const base = initialState();
    expect(fromPersisted(raw, base)).toBe(base);
  });

  it('replaces only the broken fields', () => {
    const saved = JSON.parse(JSON.stringify(toPersisted(customized())));
    saved.settings.fps = 50; // unsupported
    saved.sources.D.genre = 'polka'; // unknown genre -> whole source D falls back
    saved.mixer.order = ['A', 'A', 'B', 'C']; // not a permutation
    saved.mixer.opacity.B = 7; // out of range
    saved.sources.A.url = 'javascript:alert(1)'; // not http(s)
    const base = initialState();
    const restored = fromPersisted(saved, base);

    expect(restored.settings).toEqual({ resolution: '720p', fps: base.settings.fps });
    expect(restored.sources.D).toEqual(base.sources.D);
    expect(restored.sources.A).toEqual(base.sources.A);
    expect(restored.mixer.order).toEqual(base.mixer.order);
    expect(restored.mixer.opacity).toEqual({ A: 0.1, B: base.mixer.opacity.B, C: 0.3, D: 0.4 });
    expect(restored.clock.bpm).toBe(140); // untouched fields still restore
  });

  it('fills fields missing from an older file with defaults', () => {
    const base = initialState();
    const restored = fromPersisted({ version: 1, bpm: 100 }, base);
    expect(restored.clock.bpm).toBe(100);
    expect(restored.sources).toEqual(base.sources);
    expect(restored.mixer.order).toEqual(base.mixer.order);
  });
});
