import { contextBridge, ipcRenderer, sharedTexture } from 'electron';
import { IPC, PREVIEW_ATTR, type IkvjApi, type LoginState } from '../shared/ipc';
import type { AppState, PlayerStatus, Stats, YouTubeSourceId } from '../shared/state';

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: unknown, ...args: T) => cb(...args);
  ipcRenderer.on(channel, listener as never);
  return () => {
    ipcRenderer.removeListener(channel, listener as never);
  };
}

const api: IkvjApi = {
  dispatch: (action) => ipcRenderer.invoke(IPC.dispatch, action),
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => listen<[AppState]>(IPC.state, cb),
  onStats: (cb) => listen<[Stats]>(IPC.stats, cb),
  command: (command) => ipcRenderer.invoke(IPC.command, command),
  input: (input) => ipcRenderer.send(IPC.input, input),
  onPlayer: (cb) => listen<[YouTubeSourceId, PlayerStatus]>(IPC.player, cb),
  login: () => ipcRenderer.invoke(IPC.login),
  logout: () => ipcRenderer.invoke(IPC.logout),
  getLogin: () => ipcRenderer.invoke(IPC.getLogin),
  onLogin: (cb) => listen<[LoginState]>(IPC.loginState, cb),
};

contextBridge.exposeInMainWorld('ikvj', api);

// Draw each preview frame into its canvas. Runs in preload because a
// VideoFrame can't cross the context bridge, but the DOM is shared.
sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, ...args: unknown[]) => {
  try {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[${PREVIEW_ATTR}="${String(args[0])}"]`);
    if (!canvas) return;
    const frame = importedSharedTexture.getVideoFrame();
    try {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      canvas.getContext('2d')?.drawImage(frame, 0, 0);
    } finally {
      frame.close();
    }
  } finally {
    importedSharedTexture.release();
  }
});
