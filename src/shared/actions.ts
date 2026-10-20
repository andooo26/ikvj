// Everything the UI can ask for, as one validated union. The renderer is
// untrusted from main's point of view, so every action goes through
// `parseAction` before it reaches the reducer.

import { z } from 'zod';
import { FRAME_RATES, MAX_BPM, MIN_BPM, RESOLUTIONS, SOURCE_IDS } from './state';

const sourceId = z.enum(SOURCE_IDS);
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
  z.object({ type: z.literal('output/set'), source: sourceId, on: z.boolean() }),
  z.object({ type: z.literal('clock/setBpm'), bpm: z.number().min(MIN_BPM).max(MAX_BPM) }),
  z.object({ type: z.literal('clock/sync'), at: z.number().nonnegative() }),
  z.object({
    type: z.literal('settings/set'),
    resolution: z.enum(Object.keys(RESOLUTIONS) as [keyof typeof RESOLUTIONS]).optional(),
    fps: z.union(FRAME_RATES.map((f) => z.literal(f))).optional(),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

export function parseAction(input: unknown): { ok: true; action: Action } | { ok: false; error: string } {
  const r = ActionSchema.safeParse(input);
  return r.success ? { ok: true, action: r.data } : { ok: false, error: z.prettifyError(r.error) };
}
