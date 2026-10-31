/**
 * A channel that holds what arrives while nobody listens and hands it to the first listener.
 * The engine needs it: X sends its first pages while the app page is still mounting, and once X
 * holds a page it shows it again without fetching, so a batch dropped then never comes back.
 * shortcut: holds at most `limit` messages; raise it if a cold start ever sends more first.
 */
export function holdUntilHeard<T>(limit: number) {
  const held: Array<T> = [];
  const listeners = new Set<(value: T) => void>();
  return {
    /** Every message from the other side. */
    push: (value: T) => {
      if (listeners.size > 0) for (const cb of listeners) cb(value);
      else if (held.length < limit) held.push(value);
    },
    /** Subscribes `cb`, first replaying what was held; returns the unsubscribe. */
    listen: (cb: (value: T) => void) => {
      listeners.add(cb);
      for (const value of held.splice(0)) cb(value);
      return () => void listeners.delete(cb);
    },
  };
}
