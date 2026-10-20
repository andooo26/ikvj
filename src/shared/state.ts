// The single source of truth for the app, owned by the main process and
// mirrored read-only into the renderer. Plain data only (it crosses IPC and is
// persisted as JSON).

export const SOURCE_IDS = ['A', 'B', 'C', 'D'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** Engine slot index for each source (matches the native addon). */
export const SLOT: Record<SourceId, number> = { A: 0, B: 1, C: 2, D: 3 };

export const RESOLUTIONS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2160p': { width: 3840, height: 2160 },
} as const;
export type Resolution = keyof typeof RESOLUTIONS;

export const FRAME_RATES = [30, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

export const MIN_BPM = 40;
export const MAX_BPM = 240;

export interface YouTubeSource {
  kind: 'youtube';
  url: string;
}

export interface GenSource {
  kind: 'gen';
  genre: string;
  /** 0..1 */
  intensity: number;
  /** 0..359 */
  tint: number;
  seed: number;
}

export type Source = YouTubeSource | GenSource;

export interface AppState {
  settings: {
    resolution: Resolution;
    fps: FrameRate;
  };
  /** One musical clock shared by every generative source. */
  clock: {
    bpm: number;
    /** ms timestamp of beat 0; Tap / Sync move it. */
    beatEpoch: number;
  };
  sources: {
    A: YouTubeSource;
    B: YouTubeSource;
    C: GenSource;
    D: GenSource;
  };
  mixer: {
    /** Bottom layer first; the last entry is drawn on top. */
    order: SourceId[];
    opacity: Record<SourceId, number>;
  };
  /** Per-source Syphon/Spout output (ikvj-A..D). ikvj-MIX is always on. */
  outputs: Record<SourceId, boolean>;
}

export const OUTPUT_NAMES: Record<SourceId | 'MIX', string> = {
  A: 'ikvj-A',
  B: 'ikvj-B',
  C: 'ikvj-C',
  D: 'ikvj-D',
  MIX: 'ikvj-MIX',
};

export function initialState(): AppState {
  return {
    settings: { resolution: '1080p', fps: 60 },
    clock: { bpm: 128, beatEpoch: 0 },
    sources: {
      A: { kind: 'youtube', url: '' },
      B: { kind: 'youtube', url: '' },
      C: { kind: 'gen', genre: 'techno', intensity: 0.6, tint: 0, seed: 1 },
      D: { kind: 'gen', genre: 'kawaii', intensity: 0.6, tint: 0, seed: 2 },
    },
    mixer: {
      order: ['A', 'B', 'C', 'D'],
      opacity: { A: 1, B: 0, C: 0, D: 0 },
    },
    outputs: { A: false, B: false, C: false, D: false },
  };
}

/** Live numbers the main process reports once a second (not part of state). */
export interface Stats {
  /** Frames delivered by each source in the last second. */
  sourceFps: Record<SourceId, number>;
  /** Mix frames composed and published in the last second. */
  mixFps: number;
  /** Receiver connected per output; null when the protocol can't tell (Spout). */
  clients: Partial<Record<SourceId | 'MIX', boolean | null>>;
  /** Engine backend and GPU, e.g. "metal · Apple M5". */
  engine: string;
  error: string | null;
}
