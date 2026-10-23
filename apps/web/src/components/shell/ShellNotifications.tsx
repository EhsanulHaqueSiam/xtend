import { useAtomValue } from "@effect/atom-react";
import type { XtendEvent } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef } from "react";

import { eventsAtom } from "../../state/shell";

const text = (event: XtendEvent): string | null => {
  const p = event.payload;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  if (event.type === "mention_arrived")
    return `@${str("handle") ?? "someone"}: ${str("text") ?? "mentioned you"}`;
  if (event.type === "lead_found") return `Lead found: @${str("handle") ?? "unknown"}`;
  return null;
};

/** Mentions and leads become OS notifications; the desktop grants the permission, a browser asks once. */
export function ShellNotifications() {
  const events = useAtomValue(eventsAtom);
  // The list is capped, so remember the last event itself rather than an index.
  const last = useRef<XtendEvent | undefined>(undefined);
  useEffect(() => {
    if (typeof Notification === "undefined" || !AsyncResult.isSuccess(events)) return;
    const all = events.value;
    const fresh = last.current === undefined ? all : all.slice(all.lastIndexOf(last.current) + 1);
    last.current = all.at(-1);
    if (Notification.permission === "default") void Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    for (const event of fresh) {
      const body = text(event);
      if (body === null) continue;
      const note = new Notification("Xtend", { body });
      note.addEventListener("click", () => window.focus());
    }
  }, [events]);
  return null;
}
