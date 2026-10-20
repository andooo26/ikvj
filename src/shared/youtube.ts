// What the search bar accepts, and how YouTube URLs are classified. Pure so it
// can be shared by the reducer, the player and tests.

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const VIDEO_ID_PATTERNS = [
  /[?&]v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/embed\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/,
  /youtube\.com\/live\/([\w-]{11})/,
];

export const YOUTUBE_HOME = 'https://www.youtube.com/';

export function videoId(url: string): string | null {
  for (const re of VIDEO_ID_PATTERNS) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Has a scheme, or is a bare host like "youtu.be/…" (no spaces, dotted host). */
function looksLikeUrl(s: string): boolean {
  return SCHEME.test(s) || (!/\s/.test(s) && /^[^\s/]+\.[^\s/]+/.test(s));
}

/**
 * Turn search-bar input into a URL to load:
 *  - any YouTube video link -> its normal watch page (the /embed/ player
 *    refuses videos whose owners disabled embedding),
 *  - any other URL -> as typed (https:// added to bare hosts),
 *  - anything else -> a YouTube search for it.
 * Returns null for empty input.
 */
export function toPlayableUrl(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const id = videoId(input);
  if (id && /youtu\.?be/.test(input)) return `https://www.youtube.com/watch?v=${id}`;
  if (looksLikeUrl(input)) return SCHEME.test(input) ? input : `https://${input}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(input)}`;
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

/**
 * What the page is, which decides what is output:
 *  - 'watch'  YouTube playback page -> collapsed to the video, output live
 *  - 'browse' any other YouTube page (home, search, channel) -> output black,
 *             so the YouTube UI never leaks to the projector
 *  - 'other'  any non-YouTube URL -> output as is
 */
export type PageKind = 'watch' | 'browse' | 'other';

export function pageKind(url: string): PageKind {
  if (!isYouTubeUrl(url)) return 'other';
  return /youtube\.com\/(watch|shorts\/|live\/)|youtu\.be\//.test(url) ? 'watch' : 'browse';
}

/** YouTube playback-quality targets ('highest' = best available). */
export const QUALITIES = [
  'highest',
  'auto',
  'hd2160',
  'hd1440',
  'hd1080',
  'hd720',
  'large',
  'medium',
] as const;
export type Quality = (typeof QUALITIES)[number];

export const QUALITY_LABEL: Record<Quality, string> = {
  highest: 'Max',
  auto: 'Auto',
  hd2160: '2160p',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
};
