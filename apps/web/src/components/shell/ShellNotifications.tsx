import { useAtomValue } from "@effect/atom-react";
import type { XtendEvent } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef } from "react";

import { usd } from "../../state/costs";
import { eventsAtom } from "../../state/shell";

/** What the OS notification for an event says; null for events that only update screens. */
const notice = (event: XtendEvent): { title: string; body: string } | null => {
  const p = event.payload;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  if (event.type === "mention_arrived") {
    const count = typeof p.count === "number" ? p.count : 1;
    return { title: "Xtend", body: count === 1 ? "New mention" : `${count} new mentions` };
  }
  if (event.type === "lead_found")
    return { title: "Xtend", body: `Lead found: @${str("handle") ?? "unknown"}` };
  if (event.type !== "rule_fired") return null;
  // An automation's notify action carries its own text; an ask-first rule waits for Approve.
  const notify = p.notify;
  if (typeof notify === "object" && notify !== null && "title" in notify && "body" in notify)
    return { title: String(notify.title), body: String(notify.body) };
  if (p.pending === true)
    return {
      title: str("ruleName") ?? "Xtend",
      body: `Needs you: ${str("description") ?? "a rule is waiting"}${typeof p.costUsd === "number" ? ` (${usd(p.costUsd)})` : ""}`,
    };
  return null;
};

/**
 * Mentions, leads, automation notify actions and ask-first requests become OS notifications;
 * the desktop grants the permission, a browser asks once.
 */
export function ShellNotifications() {
  const events = useAtomValue(eventsAtom);
  // The list is capped, so remember the last event itself rather than an index.
  const last = useRef<XtendEvent | undefined>(undefined);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- shows system Notifications for new service events.
  useEffect(() => {
    if (typeof Notification === "undefined" || !AsyncResult.isSuccess(events)) return;
    const all = events.value;
    const fresh = last.current === undefined ? all : all.slice(all.lastIndexOf(last.current) + 1);
    last.current = all.at(-1);
    if (Notification.permission === "default") void Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    for (const event of fresh) {
      const shown = notice(event);
      if (shown === null) continue;
      const note = new Notification(shown.title, { body: shown.body });
      note.addEventListener("click", () => window.focus());
    }
  }, [events]);
  return null;
}
