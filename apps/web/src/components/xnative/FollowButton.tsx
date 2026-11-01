import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EngineUser } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { askFollow, engineAtom, updateEngine, youFollow } from "../../state/engine";
import { settingsAtom } from "../../state/settings";
import { xFollow, xOverAtom, xSubscribe } from "../../state/x";
import { toastAtom } from "../ui/toast";

/**
 * X's Follow / Following (Unfollow on hover) for one person, pressing X's own button for the
 * user's click. What X took holds until X's capture agrees (`youFollow`), for that person only.
 * Draws nothing for the user's own account or someone X has not described yet.
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
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  // What is in flight, per person: the button stays mounted while its person changes (one
  // profile to the next), so requests must not touch each other. Once X takes one, the store
  // keeps it until X's capture agrees, across rows that scroll away and back.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  if (user === undefined || settings?.handle?.toLowerCase() === user.handle.toLowerCase())
    return null;
  const following = pending.get(user.userId) ?? youFollow(engine, user);
  const follow = async () => {
    const id = user.userId;
    if (pending.has(id)) return;
    if (settings !== null && !settings.sessionPostingEnabled)
      return setToast({ text: "Session actions are off in Settings, X session." });
    const target = !following;
    setPending((p) => new Map(p).set(id, target));
    const ok = await xFollow({ userId: id, handle: user.handle }, target);
    if (ok) setEngine(updateEngine((s) => askFollow(s, id, target)));
    setPending((p) => new Map([...p].filter(([x]) => x !== id)));
    if (ok) return onFollowed?.(id, target);
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

/**
 * X's Subscribe for a creator, as X's Follow page lists them: presses X's own button for the
 * user's click, and X's subscribe dialog (its price, its checkout) shows over the main area.
 */
export function SubscribeButton({ user }: { readonly user: EngineUser }) {
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const setToast = useAtomSet(toastAtom);
  const setOver = useAtomSet(xOverAtom);
  const subscribe = async () => {
    if (settings !== null && !settings.sessionPostingEnabled)
      return setToast({ text: "Session actions are off in Settings, X session." });
    if (!(await xSubscribe(user, setOver)))
      setToast({ text: "X did not open its subscribe dialog. Try again in a moment." });
  };
  return (
    <button
      type="button"
      className="h-8 shrink-0 cursor-pointer rounded-full bg-foreground px-3.5 text-[14px] font-bold text-background transition-opacity duration-150 hover:opacity-90"
      onClick={(e) => {
        e.stopPropagation();
        void subscribe();
      }}
    >
      Subscribe
    </button>
  );
}
