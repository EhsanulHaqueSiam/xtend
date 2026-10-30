import {
  Compose_METHODS,
  Events_METHODS,
  WS_METHODS,
  type XtendEvent,
  type XtendEventType,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

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
  // Every heartbeat and observation batch filters to a new array; only a new event of this
  // type is a change, or each one would refetch everything that reacts to the type.
  Atom.withEquality(
    Atom.make((get) => eventsOf(get).filter((e) => e.type === type)),
    (a, b) => a.at(-1) === b.at(-1),
  ),
);

export type ConnectionState = "connecting" | "connected" | "disconnected";

/** Derived from the event heartbeat; every event counts as a beat. */
export const connectionAtom = Atom.make((get): ConnectionState => {
  const events = get(eventsAtom);
  if (AsyncResult.isFailure(events)) return "disconnected";
  const timer = setTimeout(() => get.setSelf("disconnected"), HEARTBEAT_TIMEOUT_MS);
  get.addFinalizer(() => clearTimeout(timer));
  return eventsOf(get).length === 0 ? "connecting" : "connected";
});

/** Whether the ⌘K palette is open. */
export const paletteOpenAtom = Atom.make(false);

/** Drafts waiting in the queue; refetched whenever a draft changes status. */
export const queuedDraftsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("draft_status_changed"));
    const client = yield* XtendClient;
    const { drafts } = yield* client[Compose_METHODS.draftsList]({});
    return drafts.filter((d) => d.status === "queued");
  }),
);

/** Spend summary that follows spend_changed events. */
export const spendLiveAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("spend_changed"));
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.spendSummary]({});
  }),
);
