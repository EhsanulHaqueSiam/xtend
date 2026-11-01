import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EngineUser } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { settingsAtom } from "../../state/settings";
import { xFollow } from "../../state/x";
import { toastAtom } from "../ui/toast";

/**
 * X's Follow / Following (Unfollow on hover) for one person, pressing X's own button for the
 * user's click. It holds what the user asked for until X's capture agrees, for that person only,
 * and draws nothing for the user's own account or someone X has not described yet.
 */
export function FollowButton({
  user,
  size = "md",
  onFollowed,
}: {
  readonly user: EngineUser | undefined;
  readonly size?: "sm" | "md";
  /** X took a follow or unfollow; its capture may come later. */
  readonly onFollowed?: (userId: string, following: boolean) => void;
}) {
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const setToast = useAtomSet(toastAtom);
  // What the user asked for and what is in flight, per person: the button stays mounted while
  // its person changes (one profile to the next), so requests must not touch each other.
  const [want, setWant] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const without = (m: ReadonlyMap<string, boolean>, k: string) =>
    new Map([...m].filter(([x]) => x !== k));
  // Once X's capture agrees, X's own state is the truth again.
  if (user !== undefined && want.get(user.userId) === user.youFollow)
    setWant((w) => without(w, user.userId));
  if (user === undefined || settings?.handle?.toLowerCase() === user.handle.toLowerCase())
    return null;
  const following = want.get(user.userId) ?? user.youFollow;
  const follow = async () => {
    if (busy.has(user.userId)) return;
    if (settings !== null && !settings.sessionPostingEnabled)
      return setToast({ text: "Session actions are off in Settings, X session." });
    const id = user.userId;
    const target = !following;
    setWant((w) => new Map(w).set(id, target));
    setBusy((b) => new Set(b).add(id));
    const ok = await xFollow({ userId: id, handle: user.handle }, target);
    setBusy((b) => new Set([...b].filter((x) => x !== id)));
    if (ok) return onFollowed?.(id, target);
    // Take back only this request, and only if nothing newer replaced it.
    setWant((w) => (w.get(id) === target ? without(w, id) : w));
    setToast({ text: "X did not take that. Try again in a moment." });
  };
  return (
    <button
      type="button"
      aria-pressed={following}
      className={cn(
        "group shrink-0 cursor-pointer rounded-full font-bold transition-colors duration-150",
        size === "sm" ? "h-8 px-3.5 text-[14px]" : "h-9 px-4 text-[15px]",
        following
          ? "border border-white/[0.35] hover:border-[#f4212e]/60 hover:bg-[#f4212e]/10 hover:text-[#f4212e]"
          : "bg-foreground text-background hover:opacity-90",
      )}
      onClick={(e) => {
        e.stopPropagation();
        void follow();
      }}
    >
      {following ? (
        <>
          <span className="group-hover:hidden">Following</span>
          <span className="hidden group-hover:inline">Unfollow</span>
        </>
      ) : (
        "Follow"
      )}
    </button>
  );
}
