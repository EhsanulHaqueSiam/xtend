import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";

import { glanceOf } from "../../lib/glance";
import { mentionsAtom } from "../../state/engage";
import { slotsAtom } from "../../state/plan";
import { settingsAtom } from "../../state/settings";
import { connectionAtom, queuedDraftsAtom, spendLiveAtom } from "../../state/shell";

const MINUTE_MS = 60_000;

const or = <A, B>(result: AsyncResult.AsyncResult<A, unknown>, fallback: B): A | B =>
  AsyncResult.getOrElse(result, () => fallback);

/**
 * Pushes the composer chip's data (best time, queue) to main whenever it changes.
 * Everything here is free: queued drafts, slots, stored mentions and the
 * spend summary; nothing is fetched from X for a widget.
 */
export function GlanceSync() {
  const queued = or(useAtomValue(queuedDraftsAtom), []);
  const slots = or(useAtomValue(slotsAtom), []);
  const mentions = or(useAtomValue(mentionsAtom), null);
  const spend = or(useAtomValue(spendLiveAtom), null);
  const settings = or(useAtomValue(settingsAtom), null);
  const connected = useAtomValue(connectionAtom) !== "disconnected";
  const openMentions = mentions?.mentions.filter((m) => !m.handled).length ?? 0;
  const spendTodayUsd = spend?.todayUsd ?? 0;
  const zone = settings?.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  // "18:00" and "Tomorrow 09:00" are relative to now: without a tick they outlive the slot they name.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);
  const glance = glanceOf({ queued, slots, openMentions, spendTodayUsd, connected, zone, now });
  // Only a changed card crosses to main; most ticks change nothing.
  const sent = useRef("");
  useEffect(() => {
    const key = JSON.stringify(glance);
    if (key === sent.current) return;
    sent.current = key;
    window.desktopBridge?.pushGlance(glance);
  });
  return null;
}
