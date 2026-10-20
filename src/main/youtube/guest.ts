/// <reference lib="dom" />
// Code that runs inside the YouTube page. Each function is injected with
// `inject(fn, arg)`, i.e. as its source text, so it must be self-contained:
// no imports, no references to anything outside its own body.

/** The subset of YouTube's #movie_player API we use. */
interface MoviePlayer extends HTMLElement {
  getAvailableQualityLevels?(): string[];
  setPlaybackQualityRange?(min: string, max: string): void;
  setPlaybackQuality?(q: string): void;
  setOption?(module: string, option: string, value: unknown): void;
  unloadModule?(module: string): void;
}

type GuestWindow = Window & { __ikvjInstalled?: boolean; __ikvjQuality?: string };

/**
 * Installed once per document. Every 400ms it re-asserts what YouTube keeps
 * undoing: the video-only layout (only on watch pages, so browsing keeps the
 * full UI), skipping ads, captions off, and the target quality.
 */
export function installGuest(css: string): void {
  const w = window as GuestWindow;
  if (w.__ikvjInstalled) return;
  w.__ikvjInstalled = true;

  const QUALITY_ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const isWatch = () => /youtube\.com\/(watch|shorts\/|live\/)|youtu\.be\//.test(location.href);

  const ensureLayout = () => {
    let el = document.getElementById('__ikvj_player_only');
    if (!isWatch()) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = '__ikvj_player_only';
      el.textContent = css;
    }
    // Keep it last in <head> so it wins the cascade; YouTube rebuilds the DOM.
    const head = document.head ?? document.documentElement;
    if (el.parentNode !== head || head.lastChild !== el) head.appendChild(el);
  };

  const handleAds = () => {
    const skip = document.querySelector<HTMLElement>(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button',
    );
    skip?.click();
    if (document.querySelector('.ad-showing, .ytp-ad-player-overlay')) {
      const v = document.querySelector('video');
      if (v && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration;
    }
    document.querySelector<HTMLElement>('#dismiss-button button, .ytp-ad-overlay-close-button')?.click();
  };

  const enforcePlayer = () => {
    const p = document.getElementById('movie_player') as MoviePlayer | null;
    if (!p) return;
    try {
      p.setOption?.('captions', 'track', {});
      p.unloadModule?.('captions');
    } catch {
      /* captions module not loaded yet */
    }
    const target = w.__ikvjQuality ?? 'highest';
    const levels = p.getAvailableQualityLevels?.() ?? []; // best first, no 'auto'
    if (target === 'auto' || levels.length === 0) return;
    let pick: string | undefined;
    if (target === 'highest') {
      pick = levels[0];
    } else {
      // Best available at or below the target, else the lowest there is.
      const ti = QUALITY_ORDER.indexOf(target);
      pick = levels.find((l) => QUALITY_ORDER.indexOf(l) >= ti) ?? levels[levels.length - 1];
    }
    if (!pick) return;
    p.setPlaybackQualityRange?.(pick, pick);
    p.setPlaybackQuality?.(pick);
  };

  const tick = () => {
    try {
      ensureLayout();
      if (isWatch()) {
        handleAds();
        enforcePlayer();
      }
    } catch {
      /* never let one bad tick stop the loop */
    }
  };
  tick();
  setInterval(tick, 400);
}

export function setQuality(quality: string): void {
  (window as GuestWindow).__ikvjQuality = quality;
}

/** Transport state for the UI, or null when there is no sized video yet. */
export function readVideo(): {
  time: number;
  duration: number;
  paused: boolean;
  height: number;
  maxHeight: number;
} | null {
  const v = document.querySelector('video');
  if (!v || !v.videoHeight) return null;
  const HEIGHTS: Record<string, number> = {
    highres: 4320, hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720,
    large: 480, medium: 360, small: 240, tiny: 144,
  };
  const p = document.getElementById('movie_player') as MoviePlayer | null;
  const levels = p?.getAvailableQualityLevels?.() ?? [];
  return {
    time: v.currentTime,
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    paused: v.paused,
    height: v.videoHeight,
    maxHeight: Math.max(0, ...levels.map((l) => HEIGHTS[l] ?? 0)),
  };
}

export function togglePlay(): void {
  const v = document.querySelector('video');
  if (v) void (v.paused ? v.play() : v.pause());
}

export function seekTo(time: number): void {
  const v = document.querySelector('video');
  if (v) v.currentTime = time;
}

export function skipBy(delta: number): void {
  const v = document.querySelector('video');
  if (!v) return;
  const end = Number.isFinite(v.duration) ? v.duration : Infinity;
  v.currentTime = Math.min(Math.max(v.currentTime + delta, 0), end);
}

/** Source text to run `fn(arg)` in the page via executeJavaScript. */
export function inject<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): string {
  return `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
}
