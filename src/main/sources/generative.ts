// One generative source: an offscreen page running the sketch
// (renderer/src/gen), driven by the shared clock and this source's look.

import type { GenFrameParams } from '../../shared/gen';
import { IPC } from '../../shared/ipc';
import type { AppState, GenSourceId } from '../../shared/state';
import { loadRendererPage, preloadPath } from '../renderer-page';
import type { Store } from '../store';
import { OffscreenView, type ViewDeps } from './offscreen';

export interface GenDeps extends ViewDeps {
  store: Store;
}

function frameParams(state: AppState, id: GenSourceId): GenFrameParams {
  const { genre, intensity, tint, seed } = state.sources[id];
  return { ...state.clock, genre, intensity, tint, seed };
}

export class GenSource {
  private readonly view: OffscreenView;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly id: GenSourceId,
    private readonly deps: GenDeps,
  ) {
    this.view = new OffscreenView(id, deps, { preload: preloadPath('gen') });
    this.unsubscribe = deps.store.subscribe((next, prev) => this.onChange(next, prev));
  }

  start(): void {
    this.createPage(this.deps.store.get());
    this.syncOutput(this.deps.store.get());
  }

  dispose(): void {
    this.unsubscribe();
    this.view.destroy();
  }

  private onChange(next: AppState, prev: AppState): void {
    if (next.settings !== prev.settings) {
      this.createPage(next);
    } else if (next.clock !== prev.clock || next.sources[this.id] !== prev.sources[this.id]) {
      this.sendParams(next);
    }
    this.syncOutput(next);
  }

  /** "None" outputs black, without passing frames through the engine. */
  private syncOutput(state: AppState): void {
    this.view.setOutput(state.sources[this.id].genre !== 'none');
  }

  private createPage(state: AppState): void {
    const wc = this.view.create(state);
    wc.on('did-finish-load', () => this.sendParams(this.deps.store.get()));
    loadRendererPage(wc, 'gen', { source: this.id });
  }

  private sendParams(state: AppState): void {
    this.view.contents()?.send(IPC.genParams, frameParams(state, this.id));
  }
}
