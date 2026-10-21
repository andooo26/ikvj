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
  /** Actions dispatched by a listener while it was being notified. */
  private readonly queue: Action[] = [];
  private notifying = false;

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
    // A listener reacting to a change may dispatch again. Running that inline
    // would hand the remaining listeners the older state after the newer one,
    // so finish this round first, then apply it.
    this.queue.push(action);
    if (this.notifying) return;
    this.notifying = true;
    try {
      for (let a = this.queue.shift(); a; a = this.queue.shift()) {
        const prev = this.state;
        const next = reduce(prev, a, Date.now());
        if (next === prev) continue;
        this.state = next;
        for (const l of this.listeners) l(next, prev);
      }
    } finally {
      this.notifying = false;
      this.queue.length = 0;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
