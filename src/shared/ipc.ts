// The whole main <-> renderer contract. Channel names live only here; main
// and preload both build on these constants.

import type { Action } from './actions';
import type { Command, PointerInput } from './commands';
import type { AppState, PlayerStatus, Stats, YouTubeSourceId } from './state';

export const IPC = {
  /** renderer -> main (invoke): apply an action, resolves with the result. */
  dispatch: 'ikvj:dispatch',
  /** renderer -> main (invoke): current state, for the first render. */
  getState: 'ikvj:get-state',
  /** main -> renderer: full state after every change. */
  state: 'ikvj:state',
  /** main -> renderer: live numbers, once a second. */
  stats: 'ikvj:stats',
  /** renderer -> main (invoke): transport / navigation of a player. */
  command: 'ikvj:command',
  /** renderer -> main (send, high rate): pointer input on a player preview. */
  input: 'ikvj:input',
  /** main -> renderer: one player's live status, a few times a second. */
  player: 'ikvj:player',
} as const;

export type PlayerStatuses = Partial<Record<YouTubeSourceId, PlayerStatus>>;

export type DispatchResult = { ok: true } | { ok: false; error: string };

/** What preload exposes as `window.ikvj`. */
export interface IkvjApi {
  dispatch(action: Action): Promise<DispatchResult>;
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): () => void;
  onStats(cb: (stats: Stats) => void): () => void;
  command(command: Command): Promise<DispatchResult>;
  input(input: PointerInput): void;
  onPlayer(cb: (id: YouTubeSourceId, status: PlayerStatus) => void): () => void;
}

/**
 * Player previews don't go through this API: preload receives each frame
 * (Electron sharedTexture, zero-copy) and draws it straight into
 * `<canvas data-preview="A">`, so the renderer only has to render that element.
 */
export const PREVIEW_ATTR = 'data-preview';
