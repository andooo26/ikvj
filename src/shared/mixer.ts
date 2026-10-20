/**
 * Move `item` so it ends up at the position `target` occupied, shifting the
 * rest. Dropping a dragged layer onto another one means "take its place",
 * whichever direction it came from.
 */
export function moveOnto<T>(list: readonly T[], item: T, target: T): T[] {
  const to = list.indexOf(target);
  if (to < 0 || !list.includes(item) || item === target) return [...list];
  const next = list.filter((x) => x !== item);
  next.splice(to, 0, item);
  return next;
}
