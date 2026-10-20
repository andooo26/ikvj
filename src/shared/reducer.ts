// Pure state transitions. Actions are already validated (see actions.ts), so
// this only encodes what each one means.

import type { Action } from './actions';
import type { AppState, YouTubeSource, YouTubeSourceId } from './state';
import { toPlayableUrl } from './youtube';

function patchYouTube(state: AppState, id: YouTubeSourceId, patch: Partial<YouTubeSource>): AppState {
  return { ...state, sources: { ...state.sources, [id]: { ...state.sources[id], ...patch } } };
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'mixer/setOpacity':
      return {
        ...state,
        mixer: { ...state.mixer, opacity: { ...state.mixer.opacity, [action.source]: action.value } },
      };
    case 'mixer/reorder':
      return { ...state, mixer: { ...state.mixer, order: [...action.order] } };
    case 'output/set':
      return { ...state, outputs: { ...state.outputs, [action.source]: action.on } };
    case 'clock/setBpm':
      return { ...state, clock: { ...state.clock, bpm: action.bpm } };
    case 'clock/sync':
      return { ...state, clock: { ...state.clock, beatEpoch: action.at } };
    case 'settings/set':
      return {
        ...state,
        settings: {
          resolution: action.resolution ?? state.settings.resolution,
          fps: action.fps ?? state.settings.fps,
        },
      };
    case 'youtube/open': {
      const url = toPlayableUrl(action.input);
      return url ? patchYouTube(state, action.source, { url }) : state;
    }
    case 'youtube/navigated':
      return state.sources[action.source].url === action.url
        ? state
        : patchYouTube(state, action.source, { url: action.url });
    case 'youtube/setQuality':
      return patchYouTube(state, action.source, { quality: action.quality });
    case 'youtube/setMuted':
      return patchYouTube(state, action.source, { muted: action.muted });
  }
}
