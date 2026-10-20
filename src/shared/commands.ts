// Imperative requests that don't change AppState (transport, navigation) and
// raw pointer input forwarded to an offscreen player. Validated like actions.

import { z } from 'zod';
import { YOUTUBE_SOURCE_IDS } from './state';

const youtubeId = z.enum(YOUTUBE_SOURCE_IDS);

const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('player/togglePlay'), source: youtubeId }),
  z.object({ type: z.literal('player/seek'), source: youtubeId, time: z.number().nonnegative() }),
  z.object({ type: z.literal('player/skip'), source: youtubeId, delta: z.number().min(-3600).max(3600) }),
  z.object({ type: z.literal('player/back'), source: youtubeId }),
  z.object({ type: z.literal('player/reload'), source: youtubeId }),
]);

export type Command = z.infer<typeof CommandSchema>;

export function parseCommand(input: unknown): { ok: true; command: Command } | { ok: false; error: string } {
  const r = CommandSchema.safeParse(input);
  return r.success ? { ok: true, command: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

/**
 * A pointer event on a player preview. x / y are 0..1 across the preview, so
 * the renderer doesn't need to know the page's size.
 */
const unit = z.number().min(0).max(1);
const PointerInputSchema = z.object({
  source: youtubeId,
  kind: z.enum(['down', 'up', 'move', 'wheel', 'leave']),
  x: unit,
  y: unit,
  button: z.enum(['left', 'middle', 'right']),
  clickCount: z.number().int().min(0).max(3),
  deltaX: z.number().min(-10000).max(10000),
  deltaY: z.number().min(-10000).max(10000),
  modifiers: z.array(z.enum(['shift', 'control', 'alt', 'meta'])).max(4),
});

export type PointerInput = z.infer<typeof PointerInputSchema>;

export function parsePointerInput(input: unknown): PointerInput | null {
  const r = PointerInputSchema.safeParse(input);
  return r.success ? r.data : null;
}
