// The single source of truth for the app, owned by the main process and
// mirrored read-only into the renderer. Plain data only (it crosses IPC and is
// persisted as JSON).

import type { Genre } from './gen';
import type { PageKind, Quality } from './youtube';

export const SOURCE_IDS = ['A', 'B', 'C', 'D'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const YOUTUBE_SOURCE_IDS = ['A', 'B'] as const;
export type YouTubeSourceId = (typeof YOUTUBE_SOURCE_IDS)[number];

export const GEN_SOURCE_IDS = ['C', 'D'] as const;
export type GenSourceId = (typeof GEN_SOURCE_IDS)[number];

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
  /** Page to show; follows in-page navigation. Not saved across restarts. */
  url: string;
  quality: Quality;
  muted: boolean;
}

export interface GenSource {
  kind: 'gen';
  genre: Genre;
  /** 0..1 */
  intensity: number;
  /** -1..1, 0 = the preset's own palette */
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
    /** Resting opacities, or where the running fade is heading. */
    opacity: Record<SourceId, number>;
    /** Length of a Solo fade, ms (0 = cut). */
    fadeMs: number;
    /**
     * A fade in progress from `from` to `opacity`. What is on air at a given
     * moment is liveOpacity() in mixer.ts; nothing ticks the state itself.
     */
    fade: { from: Record<SourceId, number>; start: number; duration: number } | null;
  };
  /** Per-source Syphon/Spout output (ikvj-A..D). ikvj-MIX is always on. */
  outputs: Record<SourceId, boolean>;
  /** Fullscreen output window on a display (a projector). */
  projector: {
    target: OutputId;
    /** Electron display id; null = not chosen yet. */
    displayId: number | null;
    open: boolean;
  };
}

export type OutputId = SourceId | 'MIX';
export const OUTPUT_IDS = [...SOURCE_IDS, 'MIX'] as const satisfies readonly OutputId[];

export const OUTPUT_NAMES: Record<OutputId, string> = {
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
      A: { kind: 'youtube', url: '', quality: 'highest', muted: false },
      B: { kind: 'youtube', url: '', quality: 'highest', muted: false },
      C: { kind: 'gen', genre: 'techno', intensity: 0.6, tint: 0, seed: 1 },
      D: { kind: 'gen', genre: 'kawaii', intensity: 0.6, tint: 0, seed: 2 },
    },
    mixer: {
      order: ['A', 'B', 'C', 'D'],
      opacity: { A: 1, B: 0, C: 0, D: 0 },
      fadeMs: 1000,
      fade: null,
    },
    outputs: { A: false, B: false, C: false, D: false },
    projector: { target: 'MIX', displayId: null, open: false },
  };
}

/** Live numbers the main process reports once a second (not part of state). */
export interface Stats {
  /** Frames delivered by each source in the last second. */
  sourceFps: Record<SourceId, number>;
  /** Mix frames composed and published in the last second. */
  mixFps: number;
  /** Receiver connected per output; null when the protocol can't tell (Spout). */
  clients: Partial<Record<OutputId, boolean | null>>;
  /** Engine backend and GPU, e.g. "metal · Apple M5". */
  engine: string;
  error: string | null;
  displays: DisplayInfo[];
  /** Frames the projector window drew in the last second (0 when closed). */
  projectorFps: number;
}

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

/** Live state of one YouTube player, pushed a few times a second. */
export interface PlayerStatus {
  url: string;
  title: string;
  page: PageKind;
  loading: boolean;
  canGoBack: boolean;
  /** CSS cursor the page wants under the pointer (e.g. "pointer"). */
  cursor: string;
  /** null until a <video> with metadata is on the page. */
  video: {
    time: number;
    duration: number;
    paused: boolean;
    /** Decoded height now, and the best this video offers (0 = unknown). */
    height: number;
    maxHeight: number;
  } | null;
}
