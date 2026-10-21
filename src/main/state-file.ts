// Saves the persistent part of AppState to userData/state.json and reads it
// back at launch. Writes are debounced and atomic (temp file + rename), so a
// crash mid-write can't leave a truncated file behind.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fromPersisted, toPersisted } from '../shared/persist';
import type { AppState } from '../shared/state';
import type { Store } from './store';

const SAVE_DELAY_MS = 500;

export class StateFile {
  private timer: NodeJS.Timeout | null = null;
  private dirty: AppState | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly file = path.join(app.getPath('userData'), 'state.json')) {}

  /** The saved state on top of `base`, or `base` if there is nothing usable. */
  load(base: AppState): AppState {
    try {
      return fromPersisted(JSON.parse(fs.readFileSync(this.file, 'utf8')), base);
    } catch {
      return base; // first launch, or unreadable: start fresh
    }
  }

  watch(store: Store): void {
    this.unsubscribe = store.subscribe((next) => {
      this.dirty = next;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    });
  }

  /** Write any pending change now (also called on quit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const state = this.dirty;
    if (!state) return;
    this.dirty = null;
    try {
      const tmp = `${this.file}.tmp`;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(toPersisted(state), null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[ikvj] could not save state:', err);
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.flush();
  }
}
