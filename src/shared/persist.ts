// What survives a restart, and how a saved file is read back. Reading is
// forgiving field by field: one broken or outdated value falls back to its
// default instead of costing the whole setup.

import { z } from 'zod';
import { GENRE_IDS, MAX_SEED } from './gen';
import { MAX_FADE_MS } from './mixer';
import { FRAME_RATES, MAX_BPM, MIN_BPM, OUTPUT_IDS, RESOLUTIONS, SOURCE_IDS, type AppState } from './state';
import { QUALITIES } from './youtube';

export const PERSIST_VERSION = 1;

/**
 * The saved subset of AppState. Left out on purpose: whether the projector is
 * open (a restart must never go fullscreen by itself), a fade in progress, and
 * the beat epoch (the clock restarts at launch).
 */
export interface Persisted {
  version: typeof PERSIST_VERSION;
  settings: AppState['settings'];
  bpm: number;
  sources: AppState['sources'];
  mixer: Pick<AppState['mixer'], 'order' | 'opacity' | 'fadeMs'>;
  outputs: AppState['outputs'];
  projector: Pick<AppState['projector'], 'target' | 'displayId'>;
}

export function toPersisted(state: AppState): Persisted {
  const { order, opacity, fadeMs } = state.mixer;
  const { target, displayId } = state.projector;
  return {
    version: PERSIST_VERSION,
    settings: state.settings,
    bpm: state.clock.bpm,
    sources: state.sources,
    mixer: { order, opacity, fadeMs },
    outputs: state.outputs,
    projector: { target, displayId },
  };
}

const unit = z.number().min(0).max(1);

/** Parse `value`, or keep `fallback` if it doesn't fit. */
function pick<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const r = schema.safeParse(value);
  return r.success ? r.data : fallback;
}

const youtubeSchema = z.object({
  kind: z.literal('youtube'),
  url: z.string().max(8192).refine((u) => u === '' || /^https?:\/\//.test(u)),
  quality: z.enum(QUALITIES),
  muted: z.boolean(),
});

const genSchema = z.object({
  kind: z.literal('gen'),
  genre: z.enum(GENRE_IDS),
  intensity: unit,
  tint: z.number().min(-1).max(1),
  seed: z.number().int().min(0).max(MAX_SEED),
});

const orderSchema = z
  .array(z.enum(SOURCE_IDS))
  .length(SOURCE_IDS.length)
  .refine((o) => new Set(o).size === o.length);

/** Rebuild state from a saved file's parsed JSON, on top of `base`. */
export function fromPersisted(raw: unknown, base: AppState): AppState {
  if (typeof raw !== 'object' || raw === null) return base;
  const p = raw as Partial<Record<keyof Persisted, unknown>>;
  if (p.version !== PERSIST_VERSION) return base;
  const obj = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

  const settings = obj(p.settings);
  const sources = obj(p.sources);
  const mixer = obj(p.mixer);
  const opacity = obj(mixer.opacity);
  const outputs = obj(p.outputs);
  const projector = obj(p.projector);

  return {
    ...base,
    settings: {
      resolution: pick(
        z.enum(Object.keys(RESOLUTIONS) as [keyof typeof RESOLUTIONS]),
        settings.resolution,
        base.settings.resolution,
      ),
      fps: pick(z.union(FRAME_RATES.map((f) => z.literal(f))), settings.fps, base.settings.fps),
    },
    clock: { ...base.clock, bpm: pick(z.number().min(MIN_BPM).max(MAX_BPM), p.bpm, base.clock.bpm) },
    sources: {
      A: pick(youtubeSchema, sources.A, base.sources.A),
      B: pick(youtubeSchema, sources.B, base.sources.B),
      C: pick(genSchema, sources.C, base.sources.C),
      D: pick(genSchema, sources.D, base.sources.D),
    },
    mixer: {
      ...base.mixer,
      order: pick(orderSchema, mixer.order, base.mixer.order),
      opacity: {
        A: pick(unit, opacity.A, base.mixer.opacity.A),
        B: pick(unit, opacity.B, base.mixer.opacity.B),
        C: pick(unit, opacity.C, base.mixer.opacity.C),
        D: pick(unit, opacity.D, base.mixer.opacity.D),
      },
      fadeMs: pick(z.number().int().min(0).max(MAX_FADE_MS), mixer.fadeMs, base.mixer.fadeMs),
      fade: null,
    },
    outputs: {
      A: pick(z.boolean(), outputs.A, base.outputs.A),
      B: pick(z.boolean(), outputs.B, base.outputs.B),
      C: pick(z.boolean(), outputs.C, base.outputs.C),
      D: pick(z.boolean(), outputs.D, base.outputs.D),
    },
    projector: {
      target: pick(z.enum(OUTPUT_IDS), projector.target, base.projector.target),
      displayId: pick(z.number().int().nullable(), projector.displayId, base.projector.displayId),
      open: false,
    },
  };
}
