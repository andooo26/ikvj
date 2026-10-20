// Holds AppState and is the only thing allowed to change it. Subscribers (the
// IPC broadcaster, the pipeline) get the new and previous state after each
// change and reconcile whatever they own.

import { parseAction, type Action } from '../shared/actions';
import type { DispatchResult } from '../shared/ipc';
import { reduce } from '../shared/reducer';
import { initialState, type AppState } from '../shared/state';

type Listener = (next: AppState, prev: AppState) => void;

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(state: AppState = initialState()) {
    this.state = state;
  }

  get(): AppState {
    return this.state;
  }

  /** Validate untrusted input (from the renderer) and apply it. */
  dispatchUnknown(input: unknown): DispatchResult {
    const parsed = parseAction(input);
    if (!parsed.ok) return parsed;
    this.dispatch(parsed.action);
    return { ok: true };
  }

  dispatch(action: Action): void {
    const prev = this.state;
    this.state = reduce(prev, action);
    if (this.state === prev) return;
    for (const l of this.listeners) l(this.state, prev);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
