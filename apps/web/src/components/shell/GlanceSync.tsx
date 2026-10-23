import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect } from "react";

import { glanceOf } from "../../lib/glance";
import { mentionsAtom } from "../../state/engage";
import { slotsAtom } from "../../state/plan";
import { settingsAtom } from "../../state/settings";
import { connectionAtom, queuedDraftsAtom, spendLiveAtom } from "../../state/shell";
import { shellBridge } from "./bridge";

const or = <A, B>(result: AsyncResult.AsyncResult<A, unknown>, fallback: B): A | B =>
  AsyncResult.getOrElse(result, () => fallback);

/**
 * Pushes the Today card and composer chip data to main whenever it changes.
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
  useEffect(() => {
    shellBridge()?.pushGlance(
      glanceOf({ queued, slots, openMentions, spendTodayUsd, connected, zone, now: new Date() }),
    );
  }, [queued, slots, openMentions, spendTodayUsd, connected, zone]);
  return null;
}
