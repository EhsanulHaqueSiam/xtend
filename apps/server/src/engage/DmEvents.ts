import type { DmEvent } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as Treg from "../x/Treg.ts";

/** One page asks for this many events, so the quote is the most a page can cost. */
const DM_EVENTS_PAGE = 20;

/** What treg says one `GET /2/dm_events` page costs: $0.01 per event. */
export const DM_EVENTS_QUOTE_USD = DM_EVENTS_PAGE * 0.01;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** One page of the user's DM history through the team's own X tool. Own-account: needs the X connection. */
export const fetchDmEvents = Effect.fn("DmEvents.fetchDmEvents")(function* (purpose: string) {
  const treg = yield* Treg.Treg;
  const response = yield* treg.call({
    endpoint: "x/2/dm_events",
    query: {
      max_results: DM_EVENTS_PAGE,
      "dm_event.fields": "created_at,sender_id,text,event_type",
    },
    purpose,
    expectedCostUsd: DM_EVENTS_QUOTE_USD,
  });
  const data = obj(response.body).data;
  return (Array.isArray(data) ? data : []).map((row): DmEvent => {
    const e = obj(row);
    return {
      id: str(e.id) ?? "",
      eventType: str(e.event_type) ?? "unknown",
      text: str(e.text) ?? "",
      senderId: str(e.sender_id),
      createdAt: str(e.created_at),
    };
  });
});
