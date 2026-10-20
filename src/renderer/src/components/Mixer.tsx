import { useState } from 'react';
import { moveOnto } from '../../../shared/mixer';
import { OUTPUT_NAMES, type AppState, type SourceId, type Stats } from '../../../shared/state';
import { dispatch } from '../store';
import { OutputStatus } from './OutputStatus';

/**
 * 4ch layer mixer. Channels are shown top layer first (left), i.e. the reverse
 * of `mixer.order`, so what is on the left covers what is on the right.
 * Drag a channel by its handle to change the stacking.
 */
export function Mixer({ state, stats }: { state: AppState; stats: Stats | null }) {
  const { order, opacity } = state.mixer;
  const shown = [...order].reverse();
  const [dragging, setDragging] = useState<SourceId | null>(null);

  const dropOn = (target: SourceId) => {
    if (!dragging || dragging === target) return;
    dispatch({ type: 'mixer/reorder', order: moveOnto(shown, dragging, target).reverse() });
  };

  return (
    <footer className="mixer">
      <div className="mixer-out">
        <span className="label">MIX</span>
        <OutputStatus
          name={OUTPUT_NAMES.MIX}
          on
          fps={stats?.mixFps ?? 0}
          clients={stats?.clients.MIX}
        />
      </div>
      <ol className="channels">
        {shown.map((id, i) => (
          <li
            key={id}
            className={dragging === id ? 'channel dragging' : 'channel'}
            onDragOver={(e) => dragging && e.preventDefault()}
            onDrop={() => dropOn(id)}
          >
            <span
              className="handle"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragging(id);
              }}
              onDragEnd={() => setDragging(null)}
              title="ドラッグして重ね順を変更"
            >
              ≡
            </span>
            <span className="channel-id">{id}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={opacity[id]}
              aria-label={`${id} の不透明度`}
              onChange={(e) =>
                dispatch({ type: 'mixer/setOpacity', source: id, value: Number(e.target.value) })
              }
            />
            <span className="num muted value">{Math.round(opacity[id] * 100)}</span>
            {i === 0 && <span className="muted layer-hint">最前面</span>}
          </li>
        ))}
      </ol>
    </footer>
  );
}
