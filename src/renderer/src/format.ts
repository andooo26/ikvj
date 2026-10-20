/** m:ss, or h:mm:ss past an hour. */
export function formatTime(sec: number): string {
  const t = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
