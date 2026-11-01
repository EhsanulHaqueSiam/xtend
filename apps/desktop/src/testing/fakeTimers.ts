import { vi } from "vite-plus/test";

/** Fake timers for one block: `using _timers = fakeTimers()`. Fakes every clock by default. */
export function fakeTimers(config?: Parameters<typeof vi.useFakeTimers>[0]): Disposable {
  vi.useFakeTimers(config);
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}
