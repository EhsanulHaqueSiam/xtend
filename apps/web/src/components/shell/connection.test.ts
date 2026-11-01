import type { XtendEvent } from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";
import * as Registry from "effect/reactivity/AtomRegistry";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { connectionAtom, eventsAtom } from "../../state/shell";

afterEach(() => vi.useRealTimers());

it("expires before the first event, recovers on a beat and expires again after silence", () => {
  const start = Date.parse("2026-10-31T12:00:00.000Z");
  vi.useFakeTimers({ now: start });
  const registry = Registry.make({
    initialValues: [Atom.initialValue(eventsAtom, AsyncResult.success([]))],
  });
  try {
    registry.mount(connectionAtom);
    expect(registry.get(connectionAtom)).toBe("connecting");
    vi.advanceTimersByTime(45_000);
    expect(registry.get(connectionAtom)).toBe("disconnected");
    const at = new Date(start + 45_000).toISOString();
    const beat: XtendEvent = { type: "service_state", at, payload: {} };
    registry.ensureNode(eventsAtom).setInitialValue(AsyncResult.success([beat]));
    expect(registry.get(connectionAtom)).toBe("connected");
    vi.advanceTimersByTime(45_000);
    expect(registry.get(connectionAtom)).toBe("disconnected");
  } finally {
    registry.dispose();
  }
});
