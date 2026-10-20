import type { IkvjApi } from '../../shared/ipc';

declare global {
  interface Window {
    ikvj: IkvjApi;
  }
}
