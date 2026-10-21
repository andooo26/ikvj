// Everything the UI can ask for, as one validated union. The renderer is
// untrusted from main's point of view, so every action goes through
// `parseAction` before it reaches the reducer.

import { z } from 'zod';
import { GENRE_IDS, MAX_SEED } from './gen';
import { MAX_FADE_MS } from './mixer';
import {
  FRAME_RATES,
  GEN_SOURCE_IDS,
  MAX_BPM,
  MIN_BPM,
  RESOLUTIONS,
  SOURCE_IDS,
  YOUTUBE_SOURCE_IDS,
} from './state';
import { QUALITIES } from './youtube';

const sourceId = z.enum(SOURCE_IDS);
const youtubeId = z.enum(YOUTUBE_SOURCE_IDS);
const genId = z.enum(GEN_SOURCE_IDS);
const unit = z.number().min(0).max(1);

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mixer/setOpacity'), source: sourceId, value: unit }),
  z.object({
    type: z.literal('mixer/reorder'),
    order: z
      .array(sourceId)
      .length(SOURCE_IDS.length)
      .refine((o) => new Set(o).size === o.length, 'order must list each source once'),
  }),
  /** Fade this channel up to full and every other one out, over fadeMs. */
  z.object({ type: z.literal('mixer/solo'), source: sourceId }),
  z.object({ type: z.literal('mixer/setFadeMs'), ms: z.number().int().min(0).max(MAX_FADE_MS) }),
  z.object({ type: z.literal('output/set'), source: sourceId, on: z.boolean() }),
  z.object({ type: z.literal('clock/setBpm'), bpm: z.number().min(MIN_BPM).max(MAX_BPM) }),
  z.object({ type: z.literal('clock/sync'), at: z.number().nonnegative() }),
  z.object({
    type: z.literal('settings/set'),
    resolution: z.enum(Object.keys(RESOLUTIONS) as [keyof typeof RESOLUTIONS]).optional(),
    fps: z.union(FRAME_RATES.map((f) => z.literal(f))).optional(),
  }),
  /** Search-bar input: a URL or words to search YouTube for. */
  z.object({ type: z.literal('youtube/open'), source: youtubeId, input: z.string().max(4096) }),
  /** The page navigated by itself (a click inside it); keeps `url` restorable. */
  z.object({ type: z.literal('youtube/navigated'), source: youtubeId, url: z.url().max(8192) }),
  z.object({ type: z.literal('youtube/setQuality'), source: youtubeId, quality: z.enum(QUALITIES) }),
  z.object({ type: z.literal('youtube/setMuted'), source: youtubeId, muted: z.boolean() }),
  /** Change any of a generative source's look parameters. */
  z.object({
    type: z.literal('gen/set'),
    source: genId,
    genre: z.enum(GENRE_IDS).optional(),
    intensity: unit.optional(),
    tint: z.number().min(-1).max(1).optional(),
    seed: z.number().int().min(0).max(MAX_SEED).optional(),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

export function parseAction(input: unknown): { ok: true; action: Action } | { ok: false; error: string } {
  const r = ActionSchema.safeParse(input);
  return r.success ? { ok: true, action: r.data } : { ok: false, error: z.prettifyError(r.error) };
}
