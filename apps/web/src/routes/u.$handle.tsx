import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { fmt } from "../components/analyze/ui";
import { Timeline } from "../components/xnative/Timeline";
import { XTitle } from "../components/xnative/XColumn";
import { Avatar, Verified } from "../components/xnative/XPostView";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { xNavigate } from "../state/x";

/** A profile's posts, drawn by Xtend from the engine on x.com/<handle>; Xtend's tools sit beside them. */
function ProfileScreen() {
  const { handle } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const open = useCallback(() => void xNavigate(`https://x.com/${handle}`), [handle]);
  useEffect(() => {
    setEngine(updateEngine((s) => resetSurface(s, "profile")));
    open();
  }, [open, setEngine]);
  // Who they are, from any post of theirs the engine has seen.
  const seen = [...engine.posts.values()].find(
    (p) => p.author.handle.toLowerCase() === handle.toLowerCase(),
  );
  const a = seen?.author;
  const posts = engine.lists.profile.length;
  return (
    <Timeline
      surface="profile"
      header={
        <XTitle
          title={a?.name ?? `@${handle}`}
          detail={posts === 0 ? undefined : `${posts} posts loaded`}
          onBack={() => router.history.back()}
        />
      }
      top={
        <div data-x="profile" className="border-b border-border px-4 pt-4 pb-3">
          <div className="flex items-start justify-between">
            <Avatar url={seen?.avatarUrl ?? null} size={88} />
            <div className="flex gap-2">
              <button
                type="button"
                className="h-9 cursor-pointer rounded-full border border-white/[0.18] px-4 text-[15px] font-bold transition-colors duration-150 hover:bg-white/[0.06]"
                onClick={() => void navigate({ href: `/scores?tab=report&handle=${handle}` })}
              >
                Score report
              </button>
              <button
                type="button"
                className="h-9 cursor-pointer rounded-full border border-white/[0.18] px-4 text-[15px] font-bold transition-colors duration-150 hover:bg-white/[0.06]"
                onClick={() => window.desktopBridge?.openExternal(`https://x.com/${handle}`)}
              >
                Open in browser
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[20px] leading-6 font-extrabold">
            {a?.name ?? handle}
            {a?.verified === true ? <Verified className="size-5" /> : null}
          </div>
          <p className="text-[15px] text-[#71767b]">@{a?.handle ?? handle}</p>
          {a === undefined || a.followers === null ? null : (
            <p className="mt-3 text-[15px] text-[#71767b]">
              <b className="font-bold text-foreground">{fmt(a.followers)}</b> Followers
            </p>
          )}
        </div>
      }
      empty={`Loading @${handle}'s posts from X.`}
      onReopen={open}
    />
  );
}

export const Route = createFileRoute("/u/$handle")({ component: ProfileScreen });
