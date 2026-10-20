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
});
