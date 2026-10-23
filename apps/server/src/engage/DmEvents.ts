import type { DmEvent, XApiError } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as Treg from "../x/Treg.ts";

/** What treg says one `GET /2/dm_events` page costs: $0.01 per event, about 20 per page. */
export const DM_EVENTS_QUOTE_USD = 0.2;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** One page of the user's DM history through the team's own X tool. Own-account: needs the X connection. */
export const fetchDmEvents = (
  purpose: string,
): Effect.Effect<ReadonlyArray<DmEvent>, XApiError, Treg.Treg> =>
  Effect.gen(function* () {
    const treg = yield* Treg.Treg;
    const response = yield* treg.call({
      endpoint: "x/2/dm_events",
      query: { max_results: 50, "dm_event.fields": "created_at,sender_id,text,event_type" },
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
