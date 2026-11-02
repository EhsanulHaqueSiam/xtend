import { vi } from "vite-plus/test";

/** Fake timers for one browser test, as the web app's render module has: `using _t = fakeTimers()`. */
export function fakeTimers(config?: Parameters<typeof vi.useFakeTimers>[0]): Disposable {
  vi.useFakeTimers(config);
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}
