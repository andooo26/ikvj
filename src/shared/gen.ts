// Generative presets, shared by the UI (pickers) and the sketch renderer.

export const GENRES = [
  { id: 'techno', label: 'Techno' },
  { id: 'house', label: 'House' },
  { id: 'dnb', label: 'Drum & Bass' },
  { id: 'hiphop', label: 'Hip-Hop' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'pop', label: 'Pop / EDM' },
  { id: 'kawaii', label: 'Kawaii' },
  { id: 'hyperpop', label: 'Hyperpop / 音割れ' },
] as const;

export type Genre = (typeof GENRES)[number]['id'];
export const GENRE_IDS = GENRES.map((g) => g.id) as [Genre, ...Genre[]];

export const MAX_SEED = 99999;

/** Everything one frame of the sketch depends on (besides the wall clock). */
export interface GenFrameParams {
  bpm: number;
  /** ms timestamp of beat 0, shared by every generative source. */
  beatEpoch: number;
  genre: Genre;
  /** 0..1 — how hard the director works the preset. */
  intensity: number;
  /** -1..1 — bends the preset's spot inks; 0 is the palette as designed. */
  tint: number;
  seed: number;
}
