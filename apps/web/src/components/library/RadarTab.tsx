import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EngineRadarCount, EngineRadarQuery } from "@xtend/contracts";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { at, engineAtom, postOn, radarSurface, toXPost } from "../../state/engine";
import {
  RADAR_URL,
  xGo,
  xNavigate,
  xOverAtom,
  xOverEnded,
  xRadarCreate,
  xRadarDelete,
  xRadarUpsell,
} from "../../state/x";
import { LineChart } from "../analyze/ui";
import { PageHeader } from "../PageHeader";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { PageBody, Stat } from "../ui/layout";
import { DetailSplit } from "../ui/split";
import { OpenOnX } from "../ui/x-link";
import { XEmpty } from "../xnative/XRows";
import { useXPress } from "../xnative/useXPress";
import { PostGrid } from "./PostCard";
import { InspectorGroup, PostInspector } from "./PostInspector";
import { RemixButton, SaveButton, useSavedIds } from "./SaveButton";

const UNTITLED = "Untitled query";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** X's Posts count: the days it has counted. */
const total = (days: ReadonlyArray<EngineRadarCount>) =>
  days.reduce((n, d) => n + (d.count ?? 0), 0);

/** X's own intro for an account without Premium, in X's words. */
const HIGHLIGHTS = [
  ["Monitor keywords", "Focus on any topic using advanced search capability."],
  ["Visualize trends", "Track conversations with daily activity graphs from the past 3 days."],
  ["Real-time metrics", "Get immediate stats on post counts from your queries."],
] as const;

/**
 * X's Radar in the Library (Premium): the queries X watches for the user, each one's daily post
 * counts and posts as its page on X has them, read from X's own pages by the engine. A new query
 * and a delete go through X's own form and buttons. Without Premium, X's own intro shows.
 */
export function RadarTab() {
  const { radar } = useAtomValue(engineAtom);
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [upsell, setUpsell] = useState(false);
  // An account X allows one query: X's Radar page is that query's own page.
  const single = radar.limit !== null && radar.limit <= 1;
  const shown = open ?? (single ? (radar.list?.[0] ?? null) : null);
  const query = shown === null ? undefined : radar.queries.get(shown);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to X's Radar page for what the section shows, and reads whether X shows its Premium upsell there.
  useEffect(() => {
    if (creating) return;
    let live = true;
    const loaded = xGo(open === null ? RADAR_URL : `${RADAR_URL}/${open}`);
    if (open === null) void xRadarUpsell(loaded).then((shows) => live && setUpsell(shows));
    return () => {
      live = false;
      xOverEnded();
    };
  }, [open, creating]);

  const create = async (text: string) => {
    const why = blocked();
    if (why !== null) return void setToast({ text: why });
    const id = await xRadarCreate(text);
    if (id === null) return void setToast({ text: "X did not take the query. Try again." });
    setCreating(false);
    setOpen(id);
  };
  const remove = async (q: EngineRadarQuery) => {
    const why = blocked();
    if (why !== null) return void setToast({ text: why });
    if (!(await xRadarDelete(q, setOver)))
      setToast({ text: "X did not show that query's Delete. Try again in a moment." });
  };
  const newQuery = single ? null : (
    <Button size="xs" variant="ghost" onClick={() => setCreating(true)}>
      <Plus />
      New query
    </Button>
  );

  if (radar.list === null && upsell) return <RadarIntro />;
  // A query X just opened shows even while X's last list had none.
  if (creating || (radar.list?.length === 0 && open === null))
    return (
      <NewQuery
        full={radar.limit !== null && (radar.list?.length ?? 0) >= radar.limit}
        onCreate={create}
        onCancel={radar.list?.length === 0 ? null : () => setCreating(false)}
      />
    );
  if (radar.list === null || (shown !== null && query === undefined))
    return (
      <>
        <PageHeader title="Radar" />
        <XEmpty
          key={shown ?? ""}
          empty={
            isElectron
              ? "Loading Radar from X."
              : "Radar comes from X's own page, in the desktop app."
          }
          onReopen={() => void xNavigate(shown === null ? RADAR_URL : `${RADAR_URL}/${shown}`)}
        />
      </>
    );
  if (query !== undefined)
    return (
      <RadarQueryView
        query={query}
        counts={radar.counts.get(query.id) ?? []}
        back={single ? null : () => setOpen(null)}
        // X's page for a one-query plan has no list and no Delete; X's own controls are there.
        actions={single ? <OpenOnX href={RADAR_URL} /> : newQuery}
      />
    );
  return (
    <>
      <PageHeader title="Radar" actions={newQuery} />
      <PageBody>
        <ul>
          {radar.list.flatMap((id) => {
            const q = radar.queries.get(id);
            if (q === undefined) return [];
            const counts = radar.counts.get(id);
            return [
              <li key={id} className="group flex items-center gap-4 border-b border-border px-6">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 py-3 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => setOpen(id)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-3">
                      <span
                        className={`truncate text-[14px] font-semibold ${q.title === "" ? "text-muted-foreground" : ""}`}
                      >
                        {q.title || UNTITLED}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {day(q.createdAt)}
                      </span>
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {q.query}
                    </span>
                  </span>
                  {counts === undefined ? null : (
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="text-xs text-muted-foreground">Posts</span>
                      <span className="font-mono text-[15px] tabular-nums">
                        {total(counts).toLocaleString("en")}
                      </span>
                    </span>
                  )}
                  <Spark days={q.preview} />
                </button>
                <Button
                  size="icon-xs"
                  variant="ghost-destructive"
                  aria-label={`Delete ${q.title || UNTITLED}`}
                  onClick={() => void remove(q)}
                >
                  <Trash2 />
                </Button>
              </li>,
            ];
          })}
        </ul>
      </PageBody>
    </>
  );
}

/** X's sparkline of a query's days on its list row; nothing until X sends two. */
function Spark({ days }: { readonly days: ReadonlyArray<EngineRadarCount> }) {
  if (days.length < 2) return null;
  const max = Math.max(1, ...days.map((d) => d.count ?? 0));
  const points = days
    .map((d, i) => `${(i / (days.length - 1)) * 100},${30 - ((d.count ?? 0) / max) * 28}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-8 w-24 shrink-0 text-muted-foreground"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** One query as its page on X has it: X's Posts count, its days, and its Top posts. */
function RadarQueryView({
  query,
  counts,
  back,
  actions,
}: {
  readonly query: EngineRadarQuery;
  readonly counts: ReadonlyArray<EngineRadarCount>;
  readonly back: (() => void) | null;
  readonly actions: ReactNode;
}) {
  const engine = useAtomValue(engineAtom);
  const saved = useSavedIds();
  const [selected, setSelected] = useState<string | null>(null);
  const surface = radarSurface(query.query);
  const posts = at(engine.lists, surface).flatMap((id) => {
    const post = postOn(engine, surface, id);
    return post === undefined ? [] : [toXPost(post)];
  });
  const open = posts.find((p) => p.postId === selected);
  const days = counts.flatMap((d) =>
    d.count === null ? [] : [{ label: day(d.at), value: d.count }],
  );
  return (
    <>
      <PageHeader
        title={query.title || UNTITLED}
        leading={
          back === null ? undefined : (
            <Button size="icon-xs" variant="ghost-muted" aria-label="All queries" onClick={back}>
              <ChevronLeft />
            </Button>
          )
        }
        detail={query.query}
        actions={actions}
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
          <div className="flex flex-col gap-4 px-6 pb-4">
            <Stat label="Posts" value={total(counts).toLocaleString("en")} />
            <LineChart points={days} unit="posts" />
            {posts.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No posts from X for this query yet.
              </p>
            ) : (
              <PostGrid
                items={posts.map((post) => ({ key: post.postId, post }))}
                selected={selected}
                onSelect={setSelected}
                className="-mx-6"
              />
            )}
          </div>
        }
      />
    </>
  );
}

/**
 * X's new-query form in Xtend: what the user types goes into X's own form and X's own Submit.
 * At X's limit it says so, as X's page does.
 */
function NewQuery({
  full,
  onCreate,
  onCancel,
}: {
  readonly full: boolean;
  readonly onCreate: (query: string) => Promise<void>;
  readonly onCancel: (() => void) | null;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const all =
    onCancel === null ? null : (
      <Button size="xs" variant="ghost" onClick={onCancel}>
        All queries
      </Button>
    );
  return (
    <>
      <PageHeader title="Radar" actions={all} />
      <PageBody>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-6 pt-16 text-center">
          {full ? (
            <p className="text-[15px] font-semibold">
              You have reached the maximum number of queries
            </p>
          ) : (
            <>
              <h2 className="text-xl font-bold text-balance">
                Create a query and let Radar track real-time updates
              </h2>
              <form
                className="flex w-full items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim() === "" || pending) return;
                  setPending(true);
                  void onCreate(text.trim()).finally(() => setPending(false));
                }}
              >
                <input
                  aria-label="Query"
                  className={inputClass}
                  placeholder="$NVDA (sell OR buy)"
                  value={text}
                  onChange={(e) => setText(e.currentTarget.value)}
                />
                <Button type="submit" disabled={text.trim() === "" || pending}>
                  {pending ? "Creating on X" : "Create"}
                </Button>
              </form>
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}

/** X's Radar page for an account without Premium: X's intro and its Subscribe link. */
function RadarIntro() {
  return (
    <>
      <PageHeader title="Radar" />
      <PageBody>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 pt-12 text-center">
          <h2 className="text-xl font-bold text-balance">
            Be the very first to spot trends with Radar
          </h2>
          <p className="text-[15px] text-muted-foreground">
            Introducing the most powerful search tool on X.
          </p>
          <p className="text-[15px] text-muted-foreground">
            Monitor keywords, visualize trend activity, and filter conversations. In real-time.
          </p>
          <OpenOnX href="https://x.com/i/premium_sign_up" label="Subscribe to Premium" />
          <dl className="mt-8 grid gap-6 text-left @lg:grid-cols-3">
            {HIGHLIGHTS.map(([title, text]) => (
              <div key={title} className="flex flex-col gap-1">
                <dt className="text-[15px] font-semibold">{title}</dt>
                <dd className="text-[13px] text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </PageBody>
    </>
  );
}
