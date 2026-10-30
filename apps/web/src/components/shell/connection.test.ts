import type { XtendEvent } from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";
import * as Registry from "effect/reactivity/AtomRegistry";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { connectionAtom, eventsAtom } from "../../state/shell";

afterEach(() => vi.useRealTimers());

it("expires before the first event, recovers on a beat and expires again after silence", () => {
  vi.useFakeTimers();
  const registry = Registry.make({
    initialValues: [Atom.initialValue(eventsAtom, AsyncResult.success([]))],
  });
  try {
    registry.mount(connectionAtom);
    expect(registry.get(connectionAtom)).toBe("connecting");
    vi.advanceTimersByTime(45_000);
    expect(registry.get(connectionAtom)).toBe("disconnected");
    const beat: XtendEvent = { type: "service_state", at: new Date().toISOString(), payload: {} };
    registry.ensureNode(eventsAtom).setInitialValue(AsyncResult.success([beat]));
    expect(registry.get(connectionAtom)).toBe("connected");
    vi.advanceTimersByTime(45_000);
    expect(registry.get(connectionAtom)).toBe("disconnected");
  } finally {
    registry.dispose();
  }
});
