import type { WebContents } from 'electron';
import path from 'node:path';

/** Load one of the renderer's HTML entries (dev server in dev, files when built). */
export function loadRendererPage(
  wc: WebContents,
  page: 'index' | 'gen',
  query: Record<string, string> = {},
): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const qs = new URLSearchParams(query).toString();
    void wc.loadURL(`${devUrl}/${page}.html${qs ? `?${qs}` : ''}`).catch(() => {});
  } else {
    void wc
      .loadFile(path.join(import.meta.dirname, `../renderer/${page}.html`), { query })
      .catch(() => {});
  }
}

export function preloadPath(name: 'index' | 'gen'): string {
  return path.join(import.meta.dirname, `../preload/${name}.cjs`);
}
