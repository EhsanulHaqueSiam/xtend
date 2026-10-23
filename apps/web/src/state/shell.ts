import {
  Compose_METHODS,
  Events_METHODS,
  Leads_METHODS,
  WS_METHODS,
  type XtendEvent,
  type XtendEventType,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import type { SlotState } from "../desktopBridge";
import { clientRuntime, XtendClient } from "../rpc/client";

const KEEP = 200;
/** The service beats every 30 s; a longer silence means the socket is gone. */
const HEARTBEAT_TIMEOUT_MS = 45_000;
const RETRY = Schedule.spaced("5 seconds");

/** The last 200 live events; resubscribes after a socket drop, keeping what it had. */
export const eventsAtom = Atom.keepAlive(
  clientRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* XtendClient;
        return client[Events_METHODS.subscribe]({});
      }),
    ).pipe(
      Stream.retry(RETRY),
      Stream.repeat(RETRY),
      Stream.scan(
        () => [] as ReadonlyArray<XtendEvent>,
        (events, event) => [...events.slice(-(KEEP - 1)), event],
      ),
    ),
    { initialValue: [] as ReadonlyArray<XtendEvent> },
  ),
);

const EMPTY: ReadonlyArray<XtendEvent> = [];
const eventsOf = (get: Atom.AtomContext) => AsyncResult.getOrElse(get(eventsAtom), () => EMPTY);

/**
 * Live events of one type, for screens that react to their own area's changes.
 * @public consumed by the area screens, not only here
 */
export const eventsOfTypeAtom = Atom.family((type: XtendEventType) =>
  Atom.make((get) => eventsOf(get).filter((e) => e.type === type)),
);

export type ConnectionState = "connecting" | "connected" | "disconnected";

/** Derived from the event heartbeat; every event counts as a beat. */
export const connectionAtom = Atom.make((get): ConnectionState => {
  const events = get(eventsAtom);
  if (AsyncResult.isFailure(events)) return "disconnected";
  if (eventsOf(get).length === 0) return "connecting";
  const timer = setTimeout(() => get.setSelf("disconnected"), HEARTBEAT_TIMEOUT_MS);
  get.addFinalizer(() => clearTimeout(timer));
  return "connected";
});

/** Standalone only: the ⌘K palette as an overlay. In a slot, the palette is its own slot. */
export const paletteOpenAtom = Atom.make(false);

/** The slot main put the view in; without a bridge the app is standalone and never in one. */
export const slotAtom = Atom.keepAlive(
  Atom.make((get): SlotState => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) return { kind: null, route: "/" };
    get.addFinalizer(bridge.onSlot((slot) => get.setSelf(slot)));
    return bridge.slot;
  }),
);

/** The x.com URL the window shows; main resends it whenever a slot opens. */
export const sessionUrlAtom = Atom.keepAlive(
  Atom.make((get): string => {
    const bridge = window.desktopBridge;
    if (bridge !== undefined) get.addFinalizer(bridge.onSessionUrl((url) => get.setSelf(url)));
    return "";
  }),
);

/** Drafts waiting in the queue; refetched whenever a draft changes status. */
export const queuedDraftsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("draft_status_changed"));
    const client = yield* XtendClient;
    const { drafts } = yield* client[Compose_METHODS.draftsList]({});
    return drafts.filter((d) => d.status === "queued");
  }),
);

export const queuedCountAtom = Atom.make((get) =>
  AsyncResult.map(get(queuedDraftsAtom), (drafts) => drafts.length),
);

/** Spend summary that follows spend_changed events. */
export const spendLiveAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("spend_changed"));
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.spendSummary]({});
  }),
);

export const agentsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.agentsList]({});
  }),
);

export const runAgentAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.agentRun]({ id });
  }),
);
