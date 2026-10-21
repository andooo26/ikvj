import { useEffect, useState } from 'react';
import { FADE_PRESETS, isFading, liveOpacity, moveOnto } from '../../../shared/mixer';
import { OUTPUT_NAMES, SOURCE_IDS, type AppState, type SourceId, type Stats } from '../../../shared/state';
import { dispatch } from '../store';
import { OutputStatus } from './OutputStatus';

/** What is on air right now; re-renders every frame while a fade runs. */
function useLiveOpacity(mixer: AppState['mixer']): Record<SourceId, number> {
  const [now, setNow] = useState(Date.now);
  const fading = isFading(mixer, Date.now());
  useEffect(() => {
    if (!fading) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      if (isFading(mixer, Date.now())) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mixer, fading]);
  return liveOpacity(mixer, Math.max(now, Date.now()));
}

/** The channel a Solo is holding (target is it alone at full), if any. */
function soloed(target: Record<SourceId, number>): SourceId | null {
  const up = SOURCE_IDS.filter((s) => target[s] > 0);
  return up.length === 1 && target[up[0]!] === 1 ? up[0]! : null;
}

const fadeLabel = (ms: number) => (ms === 0 ? 'Cut' : `${ms / 1000}s`);

/**
 * 4ch layer mixer. Channels are shown top layer first (left), i.e. the reverse
 * of `mixer.order`, so what is on the left covers what is on the right.
 * Drag a channel by its handle to change the stacking; Solo fades one
 * channel up and the others out over the chosen fade length.
 */
export function Mixer({ state, stats }: { state: AppState; stats: Stats | null }) {
  const { order, fadeMs } = state.mixer;
  const opacity = useLiveOpacity(state.mixer);
  const solo = soloed(state.mixer.opacity);
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
            <button
              className={solo === id ? 'solo toggle on' : 'solo toggle'}
              aria-pressed={solo === id}
              onClick={() => dispatch({ type: 'mixer/solo', source: id })}
              title={`${id} だけにする（${fadeLabel(fadeMs)}）`}
            >
              S
            </button>
            {i === 0 && <span className="muted layer-hint">最前面</span>}
          </li>
        ))}
      </ol>
      <label className="group" title="Solo のフェード時間">
        <span className="label">Fade</span>
        <select
          value={fadeMs}
          onChange={(e) => dispatch({ type: 'mixer/setFadeMs', ms: Number(e.target.value) })}
        >
          {FADE_PRESETS.map((ms) => (
            <option key={ms} value={ms}>
              {fadeLabel(ms)}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
