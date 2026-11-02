import { useAtomValue } from "@effect/atom-react";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isElectron } from "../../env";
import {
  at,
  engineAtom,
  type Inspiration,
  inspirationSurface,
  postOn,
  toXPost,
} from "../../state/engine";
import { INSPIRATION_URL, xGo, xNavigate, xOverEnded, xPickInspiration } from "../../state/x";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { Menu, MenuItem } from "../ui/menu";
import { DetailSplit } from "../ui/split";
import { XEmpty } from "../xnative/XRows";
import { PostGrid } from "./PostCard";
import { InspectorGroup, PostInspector } from "./PostInspector";
import { RemixButton, SaveButton, useSavedIds } from "./SaveButton";

/** X's filters in X's order: the label X's button draws, and the value its timelineId carries. */
const FILTERS = {
  period: [
    { id: "Daily", label: "Last 24h" },
    { id: "Weekly", label: "Last 7d" },
    { id: "Monthly", label: "Last 30d" },
  ],
  engagement: [
    { id: "Likes", label: "Most Likes" },
    { id: "Replies", label: "Most Replies" },
    { id: "Quotes", label: "Most Quotes" },
    { id: "Bookmarks", label: "Most Bookmarks" },
    { id: "Shares", label: "Most Shares" },
    { id: "VideoQualityViews", label: "Most Video Views" },
  ],
} as const;
type Filter = keyof typeof FILTERS;

/**
 * X's Inspiration in the Library: the top posts for X's period and engagement, read from X's own
 * page by the engine and filtered as X's page is now. A pick presses X's own button there and
 * shows until X answers. X's language shows; changing it stays on x.com.
 */
export function InspirationTab() {
  const engine = useAtomValue(engineAtom);
  const saved = useSavedIds();
  const x = engine.inspiration;
  // The user's picks X has not answered yet: any answer from X since ends them.
  const [asked, setAsked] = useState<{
    readonly since: Inspiration | null;
    readonly period?: string;
    readonly engagement?: string;
  } | null>(null);
  const waiting = asked?.since === x ? asked : null;
  const shown = {
    period: waiting?.period ?? x?.period ?? "Daily",
    engagement: waiting?.engagement ?? x?.engagement ?? "Likes",
  };
  const surface = x === null ? null : inspirationSurface({ ...shown, language: x.language });
  const posts =
    surface === null
      ? []
      : at(engine.lists, surface).flatMap((id) => {
          const post = postOn(engine, surface, id);
          return post === undefined ? [] : [toXPost(post)];
        });
  const [selected, setSelected] = useState<string | null>(null);
  const open = posts.find((p) => p.postId === selected);

  const loaded = useRef<Promise<unknown>>(Promise.resolve());
  const live = useRef(new AbortController());
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to X's Inspiration while this section is open, and ends a pick still waiting there after.
  useEffect(() => {
    const mine = new AbortController();
    live.current = mine;
    loaded.current = xGo(INSPIRATION_URL);
    return () => {
      mine.abort();
      xOverEnded();
    };
  }, []);

  const pick = (filter: Filter, id: string) => {
    const label = FILTERS[filter].find((f) => f.id === id)?.label;
    if (label === undefined || shown[filter] === id) return;
    // A list X sent before stays: X may show it again from its own cache, sending nothing.
    setAsked({ ...waiting, since: x, [filter]: id });
    void xPickInspiration(filter, label, loaded.current, live.current.signal);
  };

  return (
    <>
      <PageHeader
        title="Inspiration"
        tabs={
          <HeaderTabs
            label="Period"
            tabs={FILTERS.period}
            value={shown.period}
            onChange={(id) => pick("period", id)}
          />
        }
        detail={x === null ? undefined : `💬 ${x.language.toUpperCase()}`}
        actions={
          <Menu
            align="end"
            trigger={
              <button
                type="button"
                className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--control-radius)] px-2 text-[13px] text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[popup-open]:text-foreground"
              >
                {FILTERS.engagement.find((f) => f.id === shown.engagement)?.label}
                <ChevronDown className="size-3.5" />
              </button>
            }
          >
            {FILTERS.engagement.map((f) => (
              <MenuItem key={f.id} onClick={() => pick("engagement", f.id)}>
                {f.label}
                {f.id === shown.engagement ? <Check className="ml-auto size-3.5" /> : null}
              </MenuItem>
            ))}
          </Menu>
        }
      />
      <DetailSplit
        closable
        label="Selected post"
        detailKey={selected}
        detail={
          open === undefined ? null : (
            <PostInspector key={open.postId} post={open} onClose={() => setSelected(null)}>
              <InspectorGroup title="Act">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SaveButton post={open} saved={saved.has(open.postId)} />
                  <RemixButton post={open} />
                </div>
              </InspectorGroup>
            </PostInspector>
          )
        }
        list={
          posts.length === 0 ? (
            <XEmpty
              key={surface ?? ""}
              empty={
                isElectron
                  ? "Loading X's top posts."
                  : "Inspiration comes from X's own page, in the desktop app."
              }
              onReopen={() => {
                loaded.current = xNavigate(INSPIRATION_URL);
              }}
            />
          ) : (
            <PostGrid
              items={posts.map((post) => ({ key: post.postId, post }))}
              selected={selected}
              onSelect={setSelected}
            />
          )
        }
      />
    </>
  );
}
