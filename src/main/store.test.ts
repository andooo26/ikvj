import { describe, expect, it, vi } from 'vitest';
import { Store } from './store';

describe('Store', () => {
  it('applies valid input and notifies with next and previous state', () => {
    const store = new Store();
    const listener = vi.fn();
    store.subscribe(listener);
    const prev = store.get();

    expect(store.dispatchUnknown({ type: 'output/set', source: 'A', on: true })).toEqual({ ok: true });
    expect(store.get().outputs.A).toBe(true);
    expect(listener).toHaveBeenCalledWith(store.get(), prev);
  });

  it('rejects invalid input without changing state or notifying', () => {
    const store = new Store();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.get();

    const res = store.dispatchUnknown({ type: 'output/set', source: 'Z', on: true });
    expect(res.ok).toBe(false);
    expect(store.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = new Store();
    const listener = vi.fn();
    store.subscribe(listener)();
    store.dispatchUnknown({ type: 'clock/sync', at: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('applies a dispatch made from a listener after every listener saw the first change', () => {
    const store = new Store();
    const seen: [string, boolean][] = [];
    store.subscribe((next) => {
      seen.push(['first', next.outputs.A]);
      // React to the change by changing something else.
      if (next.outputs.A && !next.outputs.B) store.dispatch({ type: 'output/set', source: 'B', on: true });
    });
    store.subscribe((next) => seen.push(['second', next.outputs.A && next.outputs.B]));

    store.dispatch({ type: 'output/set', source: 'A', on: true });
    expect(seen).toEqual([
      ['first', true],
      ['second', false],
      ['first', true],
      ['second', true],
    ]);
    expect(store.get().outputs.B).toBe(true);
  });
});
