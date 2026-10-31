import { PreviewCard } from "@base-ui/react/preview-card";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnginePost } from "@xtend/contracts";
import type { ReactElement } from "react";

import { engineAtom, userByHandle } from "../../state/engine";
import { fmt } from "../analyze/ui";
import { RichText } from "./RichText";
import { Affiliate, Avatar, Verified } from "./XPostView";

/** What the card shows: the profile X sent when there is one, else what the post said about them. */
function Card({
  author,
  avatarUrl,
}: {
  readonly author: EnginePost["author"];
  readonly avatarUrl: string | null;
}) {
  const navigate = useNavigate();
  const user = userByHandle(useAtomValue(engineAtom), author.handle);
  const followers = user?.followers ?? author.followers;
  const openProfile = () => void navigate({ to: "/u/$handle", params: { handle: author.handle } });
  return (
    <div className="flex w-[300px] flex-col gap-3 p-4 text-[15px] leading-5">
      <button type="button" className="w-fit cursor-pointer" onClick={openProfile}>
        <Avatar
          url={user?.avatarUrl ?? avatarUrl}
          size={64}
          square={user?.avatarShape === "Square"}
        />
      </button>
      <div>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 font-bold hover:underline"
          onClick={openProfile}
        >
          {user?.name ?? author.name}
          {(user?.verified ?? author.verified) ? (
            <Verified type={user?.verifiedType ?? null} />
          ) : null}
          <Affiliate user={user} />
        </button>
        <p className="flex items-center gap-1.5 text-[#71767b]">
          @{author.handle}
          {user?.followsYou === true ? (
            <span className="rounded bg-white/[0.08] px-1 text-[12px]">Follows you</span>
          ) : null}
        </p>
      </div>
      {user === undefined || user.bio === "" ? null : (
        <p className="line-clamp-4 whitespace-pre-wrap">
          <RichText text={user.bio} />
        </p>
      )}
      <p className="flex gap-4 text-[#71767b]">
        {user?.following == null ? null : (
          <span>
            <b className="font-bold text-foreground">{fmt(user.following)}</b> Following
          </span>
        )}
        {followers === null ? null : (
          <span>
            <b className="font-bold text-foreground">{fmt(followers)}</b> Followers
          </span>
        )}
      </p>
      <button
        type="button"
        className="w-fit cursor-pointer text-[13px] text-[#1d9bf0] hover:underline"
        onClick={() => void navigate({ href: `/scores?tab=report&handle=${author.handle}` })}
      >
        Score report
      </button>
    </div>
  );
}

/**
 * X's hover card on a name or avatar: after 400ms the person's card, from what the engine
 * already received. `children` is the element pointed at.
 */
export function HoverCard({
  author,
  avatarUrl,
  children,
}: {
  readonly author: EnginePost["author"];
  readonly avatarUrl: string | null;
  readonly children: ReactElement;
}) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger delay={400} render={children} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <PreviewCard.Popup
            className="rounded-2xl bg-black shadow-[0_0_15px_rgb(255_255_255/0.2),0_0_3px_1px_rgb(255_255_255/0.15)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Card author={author} avatarUrl={avatarUrl} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
