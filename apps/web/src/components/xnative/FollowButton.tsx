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
}: {
  readonly user: EngineUser | undefined;
  readonly size?: "sm" | "md";
}) {
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const setToast = useAtomSet(toastAtom);
  const [want, setWant] = useState<{ readonly userId: string; readonly follow: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  // Once X's capture agrees, X's own state is the truth again.
  if (want !== null && want.userId === user?.userId && want.follow === user.youFollow)
    setWant(null);
  if (user === undefined || settings?.handle?.toLowerCase() === user.handle.toLowerCase())
    return null;
  const following = want !== null && want.userId === user.userId ? want.follow : user.youFollow;
  const follow = async () => {
    if (busy === user.userId) return;
    if (settings !== null && !settings.sessionPostingEnabled)
      return setToast({ text: "Session actions are off in Settings, X session." });
    const target = !following;
    setWant({ userId: user.userId, follow: target });
    setBusy(user.userId);
    const ok = await xFollow({ userId: user.userId, handle: user.handle }, target);
    setBusy((b) => (b === user.userId ? null : b));
    if (ok) return;
    // Only this person's request is taken back; the screen may show someone else by now.
    setWant((w) => (w?.userId === user.userId ? null : w));
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
