import { GENRES, MAX_SEED, type Genre } from '../../../shared/gen';
import { PREVIEW_ATTR } from '../../../shared/ipc';
import type { GenSource as GenSourceState, GenSourceId } from '../../../shared/state';
import { dispatch } from '../store';

export function GenSource({ id, source }: { id: GenSourceId; source: GenSourceState }) {
  const set = (patch: Partial<Omit<GenSourceState, 'kind'>>) => dispatch({ type: 'gen/set', source: id, ...patch });
  return (
    <>
      <div className="tile-body">
        <div className="stage">
          <canvas {...{ [PREVIEW_ATTR]: id }} className="preview" />
        </div>
      </div>
      <div className="gen-controls">
        <select
          value={source.genre}
          onChange={(e) => set({ genre: e.target.value as Genre })}
          aria-label="ジャンル"
        >
          {GENRES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <label className="gen-slider">
          <span className="label">Intensity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={source.intensity}
            onChange={(e) => set({ intensity: Number(e.target.value) })}
          />
        </label>
        <label className="gen-slider" title="プリセットの配色を曲げる（中央で元の配色）">
          <span className="label">Tint</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={source.tint}
            onChange={(e) => set({ tint: Number(e.target.value) })}
            onDoubleClick={() => set({ tint: 0 })}
          />
        </label>
        <button
          onClick={() => set({ seed: Math.floor(Math.random() * (MAX_SEED + 1)) })}
          title="構図と配色の乱数を引き直す"
        >
          Shuffle
        </button>
        <span className="num muted seed">#{source.seed}</span>
      </div>
    </>
  );
}
