// Pure state transitions. Actions are already validated (see actions.ts), so
// this only encodes what each one means. `now` (ms, wall clock) is passed in
// rather than read, so fades stay testable.

import type { Action } from './actions';
import { liveOpacity } from './mixer';
import type { AppState, GenSource, GenSourceId, YouTubeSource, YouTubeSourceId } from './state';
import { toPlayableUrl } from './youtube';

function patchYouTube(state: AppState, id: YouTubeSourceId, patch: Partial<YouTubeSource>): AppState {
  return { ...state, sources: { ...state.sources, [id]: { ...state.sources[id], ...patch } } };
}

function patchGen(state: AppState, id: GenSourceId, patch: Partial<GenSource>): AppState {
  return { ...state, sources: { ...state.sources, [id]: { ...state.sources[id], ...patch } } };
}

export function reduce(state: AppState, action: Action, now: number): AppState {
  switch (action.type) {
    case 'mixer/setOpacity': {
      // A hand on a fader wins over a running fade: freeze every channel where
      // the fade has got to, then apply the move.
      const opacity = { ...liveOpacity(state.mixer, now), [action.source]: action.value };
      return { ...state, mixer: { ...state.mixer, opacity, fade: null } };
    }
    case 'mixer/solo': {
      const from = liveOpacity(state.mixer, now);
      const opacity = { A: 0, B: 0, C: 0, D: 0, [action.source]: 1 };
      const { fadeMs } = state.mixer;
      return {
        ...state,
        mixer: { ...state.mixer, opacity, fade: fadeMs > 0 ? { from, start: now, duration: fadeMs } : null },
      };
    }
    case 'mixer/setFadeMs':
      return { ...state, mixer: { ...state.mixer, fadeMs: action.ms } };
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
    case 'projector/set':
      return {
        ...state,
        projector: {
          ...state.projector,
          target: action.target ?? state.projector.target,
          displayId: action.displayId ?? state.projector.displayId,
        },
      };
    case 'projector/setOpen':
      return state.projector.open === action.open
        ? state
        : { ...state, projector: { ...state.projector, open: action.open } };
    case 'gen/set': {
      const { type: _type, source, ...patch } = action;
      // Optional keys arrive as undefined when unset; don't let them clobber.
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      return patchGen(state, source, defined);
    }
  }
}
