/** "● ikvj-A 60fps · 受信中" — the state of one Syphon/Spout output. */
export function OutputStatus({
  name,
  on,
  fps,
  clients,
}: {
  name: string;
  on: boolean;
  fps: number;
  /** undefined while off; null when the protocol can't tell (Spout). */
  clients: boolean | null | undefined;
}) {
  return (
    <span className="status">
      <span className={on ? 'dot on' : 'dot'} />
      <span className={on ? '' : 'muted'}>{name}</span>
      <span className="num muted">{fps}fps</span>
      {on && clients != null && <span className="muted">· {clients ? '受信中' : '受信なし'}</span>}
    </span>
  );
}
