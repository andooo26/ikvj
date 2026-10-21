import type { AppState, SourceId } from './state';

type Mixer = AppState['mixer'];

/** Fade lengths offered in the UI (ms); 0 is a hard cut. */
export const FADE_PRESETS = [0, 250, 500, 1000, 2000, 4000, 8000] as const;
export const MAX_FADE_MS = 10000;

/** Ease in and out, so a fade starts and lands softly. */
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * The opacities actually on air at `now`. While a fade runs they travel from
 * `fade.from` to `opacity` (the target); otherwise they are `opacity`.
 */
export function liveOpacity(mixer: Mixer, now: number): Record<SourceId, number> {
  const { fade, opacity } = mixer;
  if (!fade) return opacity;
  const t = fade.duration > 0 ? (now - fade.start) / fade.duration : 1;
  if (t >= 1) return opacity;
  const e = smoothstep(Math.max(0, t));
  const out = { ...opacity };
  for (const id of Object.keys(out) as SourceId[]) {
    out[id] = fade.from[id] + (opacity[id] - fade.from[id]) * e;
  }
  return out;
}

export function isFading(mixer: Mixer, now: number): boolean {
  return mixer.fade !== null && now < mixer.fade.start + mixer.fade.duration;
}

/**
 * Move `item` so it ends up at the position `target` occupied, shifting the
 * rest. Dropping a dragged layer onto another one means "take its place",
 * whichever direction it came from.
 */
export function moveOnto<T>(list: readonly T[], item: T, target: T): T[] {
  const to = list.indexOf(target);
  if (to < 0 || !list.includes(item) || item === target) return [...list];
  const next = list.filter((x) => x !== item);
  next.splice(to, 0, item);
  return next;
}
