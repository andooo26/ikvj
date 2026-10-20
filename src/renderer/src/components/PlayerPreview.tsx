import { useRef } from 'react';
import type { PointerInput } from '../../../shared/commands';
import { PREVIEW_ATTR } from '../../../shared/ipc';
import type { YouTubeSourceId } from '../../../shared/state';

const BUTTONS: PointerInput['button'][] = ['left', 'middle', 'right'];

function toInput(
  id: YouTubeSourceId,
  e: React.MouseEvent<HTMLCanvasElement>,
  kind: PointerInput['kind'],
): PointerInput {
  const r = e.currentTarget.getBoundingClientRect();
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const modifiers: PointerInput['modifiers'] = [];
  if (e.shiftKey) modifiers.push('shift');
  if (e.ctrlKey) modifiers.push('control');
  if (e.altKey) modifiers.push('alt');
  if (e.metaKey) modifiers.push('meta');
  return {
    source: id,
    kind,
    x: clamp((e.clientX - r.left) / r.width),
    y: clamp((e.clientY - r.top) / r.height),
    button: BUTTONS[e.button] ?? 'left',
    clickCount: e.detail,
    deltaX: 0,
    deltaY: 0,
    modifiers,
  };
}

/**
 * The live page of an offscreen player. Preload draws the frames into the
 * canvas; this component forwards the pointer to the page, so the preview can
 * be clicked, scrolled and hovered like the page itself.
 */
export function PlayerPreview({ id, cursor }: { id: YouTubeSourceId; cursor: string }) {
  // Moves are coalesced to one per animation frame; the page needs no more.
  const latestMove = useRef<PointerInput | null>(null);
  const moveScheduled = useRef(false);

  const flushMove = () => {
    moveScheduled.current = false;
    if (latestMove.current) window.ikvj.input(latestMove.current);
    latestMove.current = null;
  };

  return (
    <canvas
      {...{ [PREVIEW_ATTR]: id }}
      className="preview"
      style={{ cursor }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        window.ikvj.input(toInput(id, e, 'down'));
      }}
      onPointerUp={(e) => window.ikvj.input(toInput(id, e, 'up'))}
      onPointerMove={(e) => {
        latestMove.current = toInput(id, e, 'move');
        if (!moveScheduled.current) {
          moveScheduled.current = true;
          requestAnimationFrame(flushMove);
        }
      }}
      onPointerLeave={(e) => window.ikvj.input(toInput(id, e, 'leave'))}
      onWheel={(e) => window.ikvj.input({ ...toInput(id, e, 'wheel'), deltaX: e.deltaX, deltaY: e.deltaY })}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
