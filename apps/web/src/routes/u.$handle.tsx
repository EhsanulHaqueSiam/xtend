import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { CalendarDays, Link2, MapPin } from "lucide-react";
import { useCallback, useEffect } from "react";

import { fmt } from "../components/analyze/ui";
import { RichText } from "../components/xnative/RichText";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs, XTitle } from "../components/xnative/XColumn";
import { FollowButton } from "../components/xnative/FollowButton";
import { Avatar, Verified } from "../components/xnative/XPostView";
import { engineAtom, type ProfileTab, profileSurface, userByHandle } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

const TABS = [
  { id: "posts", label: "Posts", path: "" },
  { id: "replies", label: "Replies", path: "/with_replies" },
  { id: "highlights", label: "Highlights", path: "/highlights" },
  { id: "articles", label: "Articles", path: "/articles" },
  { id: "media", label: "Media", path: "/media" },
  // X shows Likes on the user's own profile only.
  { id: "likes", label: "Likes", path: "/likes" },
] as const satisfies ReadonlyArray<{ id: ProfileTab | "likes"; label: string; path: string }>;
type Tab = (typeof TABS)[number]["id"];
const TAB_IDS: ReadonlySet<string> = new Set(TABS.map((t) => t.id));

const JOINED = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

/**
 * A profile, drawn by Xtend from the engine on x.com/<handle>: X's header (banner, bio, counts)
 * from the user X sent, and the chosen tab's posts. Xtend's score sits one click away.
 */
function ProfileScreen() {
  const { handle } = Route.useParams();
  const tab = Route.useSearch().tab ?? "posts";
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const current = TABS.find((t) => t.id === tab)!;
  const open = useCallback(
    () => void xGo(`https://x.com/${handle}${current.path}`),
    [handle, current.path],
  );
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(`https://x.com/${handle}${current.path}`);

  useEffect(open, [open]);
  const user = userByHandle(engine, handle);
  // Before X sends the profile, any post of theirs gives a name and a face.
  const seen = [...engine.posts.values()].find(
    (p) => p.author.handle.toLowerCase() === handle.toLowerCase(),
  );
  // A tab's posts sit under the person's id. Until X names them the list stays empty (keyed by the
  // handle, which nothing fills) rather than showing whoever the engine fetched last.
  const userId = user?.userId ?? seen?.author.userId ?? `@${handle.toLowerCase()}`;
  const own = engine.viewer?.handle.toLowerCase() === handle.toLowerCase();
  const tabs = own ? TABS : TABS.filter((t) => t.id !== "likes");
  const surface = current.id === "likes" ? "likes" : profileSurface(current.id, userId);
  const name = user?.name ?? seen?.author.name ?? handle;

  const pill =
    "h-9 cursor-pointer rounded-full px-4 text-[15px] font-bold transition-colors duration-150";
  return (
    <Timeline
      surface={surface}
      header={
        <XTitle
          title={
            <span className="flex items-center gap-1">
              {name}
              {(user?.verified ?? seen?.author.verified) === true ? (
                <Verified className="size-5" type={user?.verifiedType ?? null} />
              ) : null}
            </span>
          }
          detail={user?.posts == null ? undefined : `${fmt(user.posts)} posts`}
          onBack={() => router.history.back()}
        />
      }
      top={
        <div data-x="profile">
          {user?.bannerUrl == null ? (
            <div className="aspect-[3/1] bg-[#333639]" />
          ) : (
            <img src={user.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" />
          )}
          <div className="px-4 pb-3">
            <div className="flex items-start justify-between">
              <span className="-mt-[15%] block rounded-full border-4 border-black bg-black">
                <Avatar
                  url={user?.avatarUrl ?? seen?.avatarUrl ?? null}
                  size={133}
                  square={user?.avatarShape === "Square"}
                />
              </span>
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  className={`${pill} border border-white/[0.35] hover:bg-white/[0.06]`}
                  onClick={() => void navigate({ href: `/scores?tab=report&handle=${handle}` })}
                >
                  Score
                </button>
                <FollowButton user={user} />
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1 text-[20px] leading-6 font-extrabold">
              {name}
              {(user?.verified ?? seen?.author.verified) === true ? (
                <Verified className="size-5" type={user?.verifiedType ?? null} />
              ) : null}
            </p>
            <p className="flex items-center gap-1.5 text-[15px] text-[#71767b]">
              @{user?.handle ?? handle}
              {user?.followsYou === true ? (
                <span className="rounded bg-white/[0.08] px-1 text-[12px]">Follows you</span>
              ) : null}
            </p>
            {user === undefined || user.bio === "" ? null : (
              <p className="mt-3 text-[15px] leading-5 whitespace-pre-wrap">
                <RichText text={user.bio} />
              </p>
            )}
            {user === undefined ? null : (
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[15px] text-[#71767b]">
                {user.location === null || user.location === "" ? null : (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-[18px]" />
                    {user.location}
                  </span>
                )}
                {user.website === null ? null : (
                  <a
                    href={user.website.url}
                    className="flex items-center gap-1 text-[#1d9bf0] hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      window.desktopBridge?.openExternal(user.website!.url);
                    }}
                  >
                    <Link2 className="size-[18px] text-[#71767b]" />
                    {user.website.display}
                  </a>
                )}
                {user.joinedAt === null ? null : (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-[18px]" />
                    Joined {JOINED.format(new Date(user.joinedAt))}
                  </span>
                )}
              </p>
            )}
            {(user?.followers ?? seen?.author.followers) == null ? null : (
              <p className="mt-3 flex gap-5 text-[15px] text-[#71767b]">
                {user?.following == null ? null : (
                  <span>
                    <b className="font-bold text-foreground">{fmt(user.following)}</b> Following
                  </span>
                )}
                <span>
                  <b className="font-bold text-foreground">
                    {fmt(user?.followers ?? seen?.author.followers)}
                  </b>{" "}
                  Followers
                </span>
              </p>
            )}
          </div>
          <div className="border-b border-border">
            <XTabs
              label="Profile"
              tabs={tabs}
              value={tab}
              onChange={(next) =>
                void navigate({ to: "/u/$handle", params: { handle }, search: { tab: next } })
              }
            />
          </div>
        </div>
      }
      empty={`Loading @${handle} from X.`}
      onReopen={reload}
    />
  );
}

export const Route = createFileRoute("/u/$handle")({
  // Optional, so a link to a profile needs no tab: Posts is the default.
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    typeof s.tab === "string" && s.tab !== "posts" && TAB_IDS.has(s.tab)
      ? { tab: s.tab as Tab }
      : {},
  component: ProfileScreen,
});
