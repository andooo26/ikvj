// Entry of an offscreen generative page: draw the sketch every frame with the
// latest parameters from main. The page's paints are the source's output.

import type { GenFrameParams } from '../../../shared/gen';
import type { IkvjGenApi } from '../../../shared/ipc';
import { drawGen } from './sketch';

declare global {
  interface Window {
    ikvjGen: IkvjGenApi;
  }
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
let params: GenFrameParams | null = null;
window.ikvjGen.onParams((p) => {
  params = p;
});

function frame(): void {
  // Draw at device pixels: the page is laid out small and scaled to the output.
  const w = Math.round(innerWidth * devicePixelRatio);
  const h = Math.round(innerHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (params) {
    drawGen(ctx, w, h, Date.now(), params);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
