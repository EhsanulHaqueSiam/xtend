import type { EngineCard, EngineContext, EnginePoll } from "@xtend/contracts";
import type { MouseEvent } from "react";
import { Heart, Pin, Repeat2, Users } from "lucide-react";

import { cn } from "../../lib/utils";
import { fmt } from "../analyze/ui";

/** The line X draws above a post: "Pinned", "Theo reposted", "Theo liked". */
export function ContextLine({ context }: { readonly context: EngineContext }) {
  const Icon =
    context.type === "Pin"
      ? Pin
      : context.type === "Like"
        ? Heart
        : context.type === "Retweet"
          ? Repeat2
          : Users;
  return (
    <>
      <span className="flex justify-end pt-0.5 text-[#71767b]">
        <Icon className="size-4" />
      </span>
      <p className="truncate pb-0.5 text-[13px] leading-4 font-bold text-[#71767b]">
        {context.text}
      </p>
    </>
  );
}

/** X's link preview: a large image with the domain over it, or a small one beside the title. */
export function LinkCard({ card }: { readonly card: EngineCard }) {
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    window.desktopBridge?.openExternal(card.url);
  };
  if (card.imageUrl !== null && card.kind === "link")
    return (
      <a
        href={card.url}
        data-x="card"
        className="block overflow-hidden rounded-2xl border border-white/[0.12]"
        onClick={(e) => {
          e.preventDefault();
          open(e);
        }}
      >
        <span className="relative block aspect-[1.91/1] bg-white/[0.04]">
          <img src={card.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
          <span className="absolute bottom-3 left-3 max-w-[calc(100%-24px)] truncate rounded bg-black/75 px-1.5 text-[13px]">
            {card.title}
          </span>
        </span>
        {card.domain === null ? null : (
          <span className="block px-3 py-2 text-[13px] text-[#71767b]">From {card.domain}</span>
        )}
      </a>
    );
  return (
    <a
      href={card.url}
      data-x="card"
      className="flex overflow-hidden rounded-2xl border border-white/[0.12] transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={(e) => {
        e.preventDefault();
        open(e);
      }}
    >
      {card.imageUrl === null ? null : (
        <img
          src={card.imageUrl}
          alt=""
          loading="lazy"
          className="size-[130px] shrink-0 border-r border-white/[0.12] object-cover"
        />
      )}
      <span className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2.5 text-[15px] leading-5">
        <span className="truncate text-[#71767b]">
          {card.kind === "article" ? "Article" : (card.domain ?? "")}
        </span>
        <span className="line-clamp-2">{card.title}</span>
        {card.description === null ? null : (
          <span className="line-clamp-2 text-[#71767b]">{card.description}</span>
        )}
      </span>
    </a>
  );
}

const LEFT = new Intl.RelativeTimeFormat("en", { numeric: "always" });
/** "21 hours left", "2 days left", or "Final results". */
const pollLeft = (poll: EnginePoll, now = Date.now()) => {
  if (poll.final || poll.endsAt === null) return "Final results";
  const hours = (Date.parse(poll.endsAt) - now) / 3_600_000;
  if (hours <= 0) return "Final results";
  const [n, unit] =
    hours >= 24
      ? [Math.round(hours / 24), "day"]
      : hours >= 1
        ? [Math.round(hours), "hour"]
        : [Math.max(1, Math.round(hours * 60)), "minute"];
  return `${LEFT.format(n, unit as Intl.RelativeTimeFormatUnit).replace(/^in /, "")} left`;
};

/**
 * A poll's results as X shows them once you can see counts: a bar per choice, the leader in blue.
 * Voting is a write; it happens on X (Open on X), never from here.
 */
export function Poll({ poll }: { readonly poll: EnginePoll }) {
  const total = poll.choices.reduce((n, c) => n + c.votes, 0);
  const top = Math.max(...poll.choices.map((c) => c.votes));
  return (
    <div data-x="poll" className="flex flex-col gap-1.5">
      {poll.choices.map((c, i) => {
        const share = total === 0 ? 0 : c.votes / total;
        const lead = c.votes === top && total > 0;
        return (
          <div
            key={c.label}
            className="relative flex h-8 items-center justify-between overflow-hidden rounded-md px-3 text-[15px]"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-md",
                lead ? "bg-[#1d9bf0]/40" : "bg-white/[0.12]",
              )}
              style={{ width: `${Math.max(share * 100, 1)}%` }}
            />
            <span className={cn("relative truncate", lead && "font-bold")}>
              {c.label}
              {poll.voted === i + 1 ? " ✓" : ""}
            </span>
            <span className={cn("relative pl-3 tabular-nums", lead && "font-bold")}>
              {Math.round(share * 100)}%
            </span>
          </div>
        );
      })}
      <p className="text-[15px] text-[#71767b]">
        {fmt(total)} votes · {pollLeft(poll)}
      </p>
    </div>
  );
}

/** A Community Note under the post: "Readers added context". */
export function Note({ note }: { readonly note: string }) {
  return (
    <div data-x="note" className="overflow-hidden rounded-2xl border border-white/[0.12]">
      <p className="flex items-center gap-2 border-b border-white/[0.12] bg-white/[0.04] px-3 py-2 text-[15px] font-bold">
        <Users className="size-[18px]" />
        Readers added context
      </p>
      <p className="px-3 py-2 text-[15px] leading-5 whitespace-pre-wrap">{note}</p>
    </div>
  );
}
