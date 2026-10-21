// Preload for the offscreen generative pages: they only receive parameters.

import { contextBridge, ipcRenderer } from 'electron';
import type { GenFrameParams } from '../shared/gen';
import { IPC, type IkvjGenApi } from '../shared/ipc';

const api: IkvjGenApi = {
  onParams: (cb) => {
    const listener = (_e: unknown, params: GenFrameParams) => cb(params);
    ipcRenderer.on(IPC.genParams, listener);
    return () => {
      ipcRenderer.removeListener(IPC.genParams, listener);
    };
  },
};

contextBridge.exposeInMainWorld('ikvjGen', api);
