import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import type { Stats } from '../shared/state';
import { Pipeline } from './pipeline';
import { Store } from './store';

const store = new Store();
let pipeline: Pipeline | null = null;
let mainWindow: BrowserWindow | null = null;

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0e0e10',
    title: 'ikvj',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
}

ipcMain.handle(IPC.dispatch, (_e, action: unknown) => store.dispatchUnknown(action));
ipcMain.handle(IPC.getState, () => store.get());
store.subscribe((next) => send(IPC.state, next));

app.whenReady().then(() => {
  pipeline = new Pipeline(store, (stats: Stats) => send(IPC.stats, stats));
  pipeline.start();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // The app is its windows plus the outputs; with no UI left there is no way
  // to control the outputs, so quit on every platform.
  app.quit();
});

app.on('will-quit', () => {
  pipeline?.dispose();
  pipeline = null;
});
