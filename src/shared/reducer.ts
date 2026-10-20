// Pure state transitions. Actions are already validated (see actions.ts), so
// this only encodes what each one means.

import type { Action } from './actions';
import type { AppState } from './state';

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
  }
}
