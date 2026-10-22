// Loads the native engine (native/src). Typed here so the rest of main never
// touches the untyped addon directly.

import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface Layer {
  slot: number;
  opacity: number;
}

export interface Engine {
  readonly backend: 'metal' | 'd3d11';
  readonly adapter: string;
  /** Non-blocking; returns a token that `completed()` reports when done. */
  setSource(slot: number, handle: Buffer, pixelFormat: 'bgra' | 'rgba'): number;
  /** Tokens whose texture the GPU has finished reading since the last call. */
  completed(): number[];
  /** Wait for all submitted GPU work. */
  drain(): void;
  fillSource(slot: number, r: number, g: number, b: number): void;
  compose(layers: Layer[]): void;
  createSender(name: string): number;
  publish(senderId: number, target: number): void;
  destroySender(senderId: number): void;
  hasClients(senderId: number): boolean | null;
  sharedHandle(target: number): Buffer;
  dispose(): void;
}

export interface NativeModule {
  Engine: new (width: number, height: number) => Engine;
  /** Target index of the mix (slots are 0..SLOTS-1). */
  MIX: number;
  SLOTS: number;
}

let cached: NativeModule | null = null;

export function loadNative(): NativeModule {
  if (cached) return cached;
  // Packaged: Resources/native (electron-builder extraResources); a .node
  // can't be loaded from inside the asar. Dev: the node-gyp build output.
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'ikvj_native.node')
    : path.join(app.getAppPath(), 'native', 'build', 'Release', 'ikvj_native.node');
  cached = createRequire(import.meta.url)(file) as NativeModule;
  return cached;
}
