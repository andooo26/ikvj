import { useState } from 'react';
import type { PlayerStatus, YouTubeSource as YouTubeSourceState, YouTubeSourceId } from '../../../shared/state';
import { QUALITIES, QUALITY_LABEL, YOUTUBE_HOME, type Quality } from '../../../shared/youtube';
import { formatTime } from '../format';
import { command, dispatch } from '../store';
import { PlayerPreview } from './PlayerPreview';

const SKIPS = [-3, -1, -0.5, 0.5, 1, 3];

function NavBar({ id, status }: { id: YouTubeSourceId; status: PlayerStatus | undefined }) {
  const [input, setInput] = useState('');
  const open = (value: string) => {
    if (value.trim()) dispatch({ type: 'youtube/open', source: id, input: value });
  };
  return (
    <form
      className="navbar"
      onSubmit={(e) => {
        e.preventDefault();
        open(input);
      }}
    >
      <button
        type="button"
        onClick={() => command({ type: 'player/back', source: id })}
        disabled={!status?.canGoBack}
        title="戻る"
        aria-label="戻る"
      >
        ←
      </button>
      <button type="button" onClick={() => open(YOUTUBE_HOME)} title="YouTube のホーム">
        YouTube
      </button>
      <input
        className="url"
        placeholder="YouTube を検索、または URL を貼り付け"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button type="submit" disabled={!input.trim()}>
        開く
      </button>
    </form>
  );
}

function Transport({ id, status }: { id: YouTubeSourceId; status: PlayerStatus | undefined }) {
  const video = status?.video ?? null;
  // While dragging the seek bar, show the drag position instead of playback.
  const [scrub, setScrub] = useState<number | null>(null);
  const time = scrub ?? video?.time ?? 0;
  const duration = video?.duration ?? 0;
  const disabled = !video;
  const commitScrub = () => {
    if (scrub !== null) command({ type: 'player/seek', source: id, time: scrub });
    setScrub(null);
  };

  return (
    <div className="transport">
      {SKIPS.slice(0, 3).map((d) => (
        <button key={d} className="skip num" disabled={disabled} onClick={() => command({ type: 'player/skip', source: id, delta: d })}>
          {d}
        </button>
      ))}
      <button
        className="playpause"
        disabled={disabled}
        onClick={() => command({ type: 'player/togglePlay', source: id })}
        aria-label={video?.paused ? '再生' : '一時停止'}
      >
        {video?.paused ? '▶' : '❚❚'}
      </button>
      {SKIPS.slice(3).map((d) => (
        <button key={d} className="skip num" disabled={disabled} onClick={() => command({ type: 'player/skip', source: id, delta: d })}>
          +{d}
        </button>
      ))}
      <span className="num muted">{formatTime(time)}</span>
      <input
        className="seek"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(time, duration || 1)}
        disabled={disabled || duration <= 0}
        aria-label="再生位置"
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commitScrub}
        onKeyUp={commitScrub}
      />
      <span className="num muted">{formatTime(duration)}</span>
      {video && (
        <span className="num muted" title="今の解像度 / この動画の最大">
          {video.height}p / {video.maxHeight ? `${video.maxHeight}p` : '—'}
        </span>
      )}
    </div>
  );
}

export function YouTubeSource({
  id,
  source,
  status,
}: {
  id: YouTubeSourceId;
  source: YouTubeSourceState;
  status: PlayerStatus | undefined;
}) {
  const browsing = status?.page === 'browse';
  return (
    <>
      <div className="subbar">
        <NavBar id={id} status={status} />
        <select
          value={source.quality}
          onChange={(e) => dispatch({ type: 'youtube/setQuality', source: id, quality: e.target.value as Quality })}
          title="YouTube の再生画質"
          aria-label="画質"
        >
          {QUALITIES.map((q) => (
            <option key={q} value={q}>
              {QUALITY_LABEL[q]}
            </option>
          ))}
        </select>
        <button
          className={source.muted ? 'toggle' : 'toggle on'}
          aria-pressed={!source.muted}
          onClick={() => dispatch({ type: 'youtube/setMuted', source: id, muted: !source.muted })}
          title={source.muted ? '音声: オフ' : '音声: オン'}
        >
          {source.muted ? '🔇' : '🔊'}
        </button>
      </div>
      <div className="tile-body">
        <div className="stage">
          <PlayerPreview id={id} cursor={status?.cursor ?? 'default'} />
          {!source.url && <div className="overlay">検索するか URL を貼り付けてください</div>}
          {source.url && browsing && <div className="badge">閲覧中 · 出力は黒</div>}
          {status?.loading && <div className="badge right">読み込み中…</div>}
        </div>
      </div>
      <Transport id={id} status={status} />
    </>
  );
}
