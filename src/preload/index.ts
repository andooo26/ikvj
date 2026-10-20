import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IkvjApi } from '../shared/ipc';
import type { AppState, Stats } from '../shared/state';

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: unknown, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: IkvjApi = {
  dispatch: (action) => ipcRenderer.invoke(IPC.dispatch, action),
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => listen<AppState>(IPC.state, cb),
  onStats: (cb) => listen<Stats>(IPC.stats, cb),
};

contextBridge.exposeInMainWorld('ikvj', api);
