// Owns the GPU engine and the Syphon/Spout senders, and runs the mix loop.
// Nothing here is driven by commands: on every state change the pipeline
// reconciles its native resources with what the state says should exist.

import type { TextureInfo } from 'electron';
import {
  OUTPUT_NAMES,
  RESOLUTIONS,
  SLOT,
  SOURCE_IDS,
  type AppState,
  type SourceId,
  type Stats,
} from '../shared/state';
import { loadNative, type Engine, type NativeModule } from './native';
import type { Store } from './store';

type OutputId = SourceId | 'MIX';

const zeroCounts = (): Record<SourceId, number> => ({ A: 0, B: 0, C: 0, D: 0 });

export class Pipeline {
  private native: NativeModule | null = null;
  private engine: Engine | null = null;
  private readonly senders = new Map<OutputId, number>();
  private mixTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private sourceFrames = zeroCounts();
  private mixFrames = 0;
  /** setSource token -> callback once the GPU no longer reads that texture. */
  private readonly pending = new Map<number, () => void>();
  private error: string | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: Store,
    private readonly onStats: (stats: Stats) => void,
  ) {
    this.unsubscribe = store.subscribe((next, prev) => this.onChange(next, prev));
  }

  start(): void {
    this.createEngine(this.store.get());
    this.statsTimer = setInterval(() => this.reportStats(), 1000);
  }

  dispose(): void {
    this.unsubscribe();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.destroyEngine();
  }

  /**
   * Draw one offscreen paint into a source slot. Returns at once; `done` is
   * called when the GPU has finished reading the texture (or right away if it
   * was not used), and only then may the caller release it.
   */
  submitFrame(source: SourceId, info: TextureInfo, done: () => void): void {
    this.releaseCompleted();
    const handle = info.handle.ioSurface ?? info.handle.ntHandle;
    if (!this.engine || !handle || info.pixelFormat === 'rgbaf16') {
      done();
      return;
    }
    try {
      this.pending.set(this.engine.setSource(SLOT[source], handle, info.pixelFormat), done);
      this.sourceFrames[source]++;
    } catch (err) {
      this.error = String(err instanceof Error ? err.message : err);
      done();
    }
  }

  /** Show black in a slot (no source, or a page that must not be output). */
  clearSource(source: SourceId): void {
    try {
      this.engine?.fillSource(SLOT[source], 0, 0, 0);
    } catch (err) {
      this.error = String(err instanceof Error ? err.message : err);
    }
  }

  private releaseCompleted(): void {
    if (!this.engine) return;
    for (const token of this.engine.completed()) {
      this.pending.get(token)?.();
      this.pending.delete(token);
    }
  }

  private onChange(next: AppState, prev: AppState): void {
    if (next.settings !== prev.settings) {
      // Size or rate changed: every target and sender has to be rebuilt.
      this.destroyEngine();
      this.createEngine(next);
    } else if (next.outputs !== prev.outputs) {
      this.reconcileSenders(next);
    }
  }

  private createEngine(state: AppState): void {
    const { width, height } = RESOLUTIONS[state.settings.resolution];
    try {
      this.native ??= loadNative();
      this.engine = new this.native.Engine(width, height);
      this.error = null;
    } catch (err) {
      this.engine = null;
      this.error = `GPU engine unavailable: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    this.reconcileSenders(state);
    this.mixTimer = setInterval(() => this.mixTick(), 1000 / state.settings.fps);
  }

  private destroyEngine(): void {
    if (this.mixTimer) clearInterval(this.mixTimer);
    this.mixTimer = null;
    // Nothing may still be reading a source texture once its owner gets it back.
    this.engine?.drain();
    for (const done of this.pending.values()) done();
    this.pending.clear();
    for (const id of this.senders.values()) this.engine?.destroySender(id);
    this.senders.clear();
    this.engine?.dispose();
    this.engine = null;
  }

  private reconcileSenders(state: AppState): void {
    const engine = this.engine;
    if (!engine) return;
    const wanted = new Set<OutputId>(['MIX', ...SOURCE_IDS.filter((s) => state.outputs[s])]);
    for (const [output, id] of this.senders) {
      if (wanted.has(output)) continue;
      engine.destroySender(id);
      this.senders.delete(output);
    }
    for (const output of wanted) {
      if (this.senders.has(output)) continue;
      try {
        this.senders.set(output, engine.createSender(OUTPUT_NAMES[output]));
      } catch (err) {
        this.error = String(err instanceof Error ? err.message : err);
      }
    }
  }

  private mixTick(): void {
    const engine = this.engine;
    const native = this.native;
    if (!engine || !native) return;
    this.releaseCompleted();
    const { mixer } = this.store.get();
    try {
      engine.compose(mixer.order.map((s) => ({ slot: SLOT[s], opacity: mixer.opacity[s] })));
      for (const [output, id] of this.senders) {
        engine.publish(id, output === 'MIX' ? native.MIX : SLOT[output]);
      }
      this.mixFrames++;
    } catch (err) {
      this.error = String(err instanceof Error ? err.message : err);
    }
  }

  private reportStats(): void {
    const engine = this.engine;
    const clients: Stats['clients'] = {};
    for (const [output, id] of this.senders) clients[output] = engine?.hasClients(id) ?? null;
    this.onStats({
      sourceFps: this.sourceFrames,
      mixFps: this.mixFrames,
      clients,
      engine: engine ? `${engine.backend} · ${engine.adapter}` : 'unavailable',
      error: this.error,
    });
    this.sourceFrames = zeroCounts();
    this.mixFrames = 0;
  }
}
