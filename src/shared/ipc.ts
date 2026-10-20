// The whole main <-> renderer contract. Channel names live only here; main
// and preload both build on these constants.

import type { Action } from './actions';
import type { AppState, Stats } from './state';

export const IPC = {
  /** renderer -> main (invoke): apply an action, resolves with the result. */
  dispatch: 'ikvj:dispatch',
  /** renderer -> main (invoke): current state, for the first render. */
  getState: 'ikvj:get-state',
  /** main -> renderer: full state after every change. */
  state: 'ikvj:state',
  /** main -> renderer: live numbers, once a second. */
  stats: 'ikvj:stats',
} as const;

export type DispatchResult = { ok: true } | { ok: false; error: string };

/** What preload exposes as `window.ikvj`. */
export interface IkvjApi {
  dispatch(action: Action): Promise<DispatchResult>;
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): () => void;
  onStats(cb: (stats: Stats) => void): () => void;
}
