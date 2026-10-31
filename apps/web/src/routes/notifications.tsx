import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EngineNotification } from "@xtend/contracts";
import { Bell, Heart, Repeat2, Sparkles, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";

import { useOpenPost } from "../components/xnative/Timeline";
import { XColumn, XTabs, XTitle } from "../components/xnative/XColumn";
import { xAge } from "../components/xnative/format";
import { RichText } from "../components/xnative/RichText";
import { XRows } from "../components/xnative/XRows";
import { Avatar, Verified, XPostView } from "../components/xnative/XPostView";
import { at, engineAtom, postOn, type Surface } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

// X shows Verified only to Premium accounts; All and Mentions are everyone's.
const TABS = [
  { id: "all", label: "All", path: "/notifications", surface: "notifications" },
  {
    id: "mentions",
    label: "Mentions",
    path: "/notifications/mentions",
    surface: "notifications:mentions",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; path: string; surface: Surface }>;
type Tab = (typeof TABS)[number]["id"];

/** X's icon for an event, in X's colours. */
function EventIcon({ icon }: { readonly icon: string }) {
  if (icon.startsWith("heart")) return <Heart className="size-7 fill-[#f91880] text-[#f91880]" />;
  if (icon.startsWith("retweet")) return <Repeat2 className="size-7 text-[#00ba7c]" />;
  if (icon.startsWith("person"))
    return <UserRound className="size-7 fill-[#1d9bf0] text-[#1d9bf0]" />;
  if (icon.startsWith("bell")) return <Bell className="size-7 fill-[#1d9bf0] text-[#1d9bf0]" />;
  if (icon.startsWith("communities"))
    return <Users className="size-7 fill-[#1d9bf0] text-[#1d9bf0]" />;
  return <Sparkles className="size-7 text-[#a855f7]" />;
}

/** The event's line with the people it names in bold, as X sets it. */
function boldNames(
  text: string,
  people: ReadonlyArray<{
    readonly name: string;
    readonly verified: boolean;
    readonly verifiedType: string | null;
  }>,
): ReactNode {
  const named = people.map((p) => p.name).filter((n) => n !== "" && text.includes(n));
  if (named.length === 0) return text;
  const pattern = new RegExp(
    `(${named.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  );
  // Each part is keyed by where it starts in the line, which never changes for this line.
  let offset = 0;
  return text.split(pattern).map((part) => {
    const at = offset;
    offset += part.length;
    const who = named.includes(part) ? people.find((p) => p.name === part) : undefined;
    return who !== undefined ? (
      <b key={at} className="font-bold">
        {part}
        {who.verified ? (
          <Verified className="ml-0.5 inline size-[18px] align-[-3px]" type={who.verifiedType} />
        ) : null}
      </b>
    ) : (
      part
    );
  });
}

/** "Theo and 23 others liked your post", with the faces and the post it is about. */
function EventRow({ n }: { readonly n: EngineNotification }) {
  const navigate = useNavigate();
  const openPost = useOpenPost();
  const engine = useAtomValue(engineAtom);
  const post = n.postIds[0] === undefined ? undefined : engine.posts.get(n.postIds[0]);
  const first = n.users[0];
  return (
    <button
      type="button"
      data-x="notification"
      className="grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)_auto] gap-x-3 border-b border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={() => {
        if (post !== undefined) openPost(post);
        else if (first !== undefined)
          void navigate({ to: "/u/$handle", params: { handle: first.handle } });
      }}
    >
      <span className="flex justify-end">
        <EventIcon icon={n.icon} />
      </span>
      <span className="flex min-w-0 flex-col gap-2">
        {n.users.length === 0 ? null : (
          <span className="flex gap-1">
            {n.users.slice(0, 8).map((u) => (
              <Avatar key={u.userId} url={u.avatarUrl} size={32} />
            ))}
          </span>
        )}
        <span className="text-[15px] leading-5">
          {boldNames(
            n.text,
            // X marks verified people in the line; the full user carries the mark's colour.
            n.users.map((u) => {
              const full = engine.users.get(u.userId);
              return {
                name: u.name,
                verified: full?.verified ?? false,
                verifiedType: full?.verifiedType ?? null,
              };
            }),
          )}
          {n.at === null ? null : <span className="text-[#71767b]"> · {xAge(n.at)}</span>}
        </span>
        {post === undefined ? null : (
          <span className="line-clamp-3 text-[15px] leading-5 text-[#71767b]">
            <RichText text={post.text} entities={post.entities} />
          </span>
        )}
      </span>
      {post?.media[0] === undefined ? null : (
        <img
          src={post.media[0].url}
          alt=""
          loading="lazy"
          className="col-start-3 row-start-1 size-16 rounded-xl object-cover"
        />
      )}
    </button>
  );
}

/**
 * X's notifications, drawn by Xtend from the engine on x.com/notifications: events grouped as X
 * groups them, and replies and mentions as posts you can answer from here.
 */
function NotificationsScreen() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const openPost = useOpenPost();
  const current = TABS.find((t) => t.id === tab)!;
  const open = useCallback(() => void xGo(`https://x.com${current.path}`), [current.path]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(`https://x.com${current.path}`);

  useEffect(open, [open]);
  const rows = at(engine.notifications, current.surface);
  return (
    <XColumn
      header={
        <>
          <XTitle title="Notifications" />
          <XTabs
            label="Notifications"
            tabs={TABS}
            value={tab}
            onChange={(next) => void navigate({ to: "/notifications", search: { tab: next } })}
          />
        </>
      }
    >
      <XRows
        waitKey={current.surface}
        onReopen={reload}
        items={rows}
        rowKey={(n) => n.id}
        empty="Loading your notifications from X."
        row={(n) => {
          const post =
            n.kind === "post" && n.postIds[0] !== undefined
              ? postOn(engine, current.surface, n.postIds[0])
              : undefined;
          return post === undefined ? (
            <EventRow n={n} />
          ) : (
            <XPostView
              post={post}
              quoted={post.quotedId === null ? undefined : engine.posts.get(post.quotedId)}
              onOpen={openPost}
            />
          );
        }}
      />
    </XColumn>
  );
}

export const Route = createFileRoute("/notifications")({
  validateSearch: (s: Record<string, unknown>): { tab: Tab } => ({
    tab: s.tab === "mentions" ? s.tab : "all",
  }),
  component: NotificationsScreen,
});
