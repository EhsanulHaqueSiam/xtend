import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { ReplyTarget } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useState, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { quoteAtom, useQuote, costLabels, useQuoteLabel } from "../../state/costs";
import {
  addKeywordsAtom,
  findKeywordsAtom,
  nicheAtom,
  rebuildNicheAtom,
  targetsAtom,
} from "../../state/engage";
import { settingsAtom } from "../../state/settings";
import { errorText, fmt } from "../analyze/ui";
import { PageHeader } from "../PageHeader";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import { NoHandle } from "../ui/no-handle";
import {
  type Column,
  DetailSplit,
  ListHead,
  ListRow,
  Props,
  RowText,
  RowTitle,
  useSelection,
} from "../ui/split";
import { OpenOnX } from "../ui/x-link";
import { xAction } from "../x";
import { type Patch, ReplyBox, useWork, type Work } from "./ReplyBox";
import { ErrorLine, pill, PostHead } from "./triage";

const age = (minutes: number) =>
  minutes < 60 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1)}h`;

const COLUMNS: ReadonlyArray<Column<ReplyTarget>> = [
  { label: "Views/h", className: "w-16", cell: (t) => fmt(t.viewsPerHour) },
  {
    label: "Replies",
    className: "hidden w-16 @lg:block",
    cell: (t) => fmt(t.post.metrics.replies),
  },
  {
    label: "Followers",
    className: "hidden w-18 @xl:block",
    cell: (t) => fmt(t.post.author.followers),
  },
  { label: "Age", className: "w-12", cell: (t) => age(t.ageMinutes) },
];

type Suggestions = { keywords: ReadonlyArray<string>; handles: ReadonlyArray<string> };

/** Posts worth replying to, ranked by the service; the selected one opens with its numbers and a reply. */
export function Targets() {
  const result = useAtomValue(targetsAtom);
  const load = useAtomSet(targetsAtom);
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const find = useAtomSet(findKeywordsAtom, { mode: "promiseExit" });
  const finding = useAtomValue(findKeywordsAtom).waiting;
  const findQuote = useQuoteLabel({ kind: "findKeywords" });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const targetsQuote = useQuoteLabel({ kind: "engageTargets" });
  const free = useQuote({ kind: "engageTargets" })?.cached === true;
  const initial = AsyncResult.isInitial(result);
  // Opening the page only shows what the cache already holds; a paid search waits for the click.
  useEffect(() => {
    if (free && initial) load();
  }, [free, initial, load]);
  const [found, setFound] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Skipping only hides a target for this visit, as it always has.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());

  const targets = AsyncResult.getOrElse(
    AsyncResult.map(result, (all) => all.filter((t) => !skipped.has(t.post.postId))),
    () => [],
  );
  const noHandle = settings !== null && settings.handle === null;

  const runFind = async () => {
    setError(null);
    const exit = await find();
    if (Exit.isFailure(exit)) setError(errorText(exit.cause));
    else setFound(exit.value);
  };
  const skip = (id: string) => setSkipped((s) => new Set(s).add(id));

  const top = (
    <>
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      {found !== null ? (
        <Found
          found={found}
          onAdded={() => setFound(null)}
          onError={setError}
          onDismiss={() => setFound(null)}
        />
      ) : null}
      <NicheLine />
    </>
  );
  // With no keywords there is nothing to search, whatever the targets result says.
  const noKeywords =
    settings === null || settings.keywords.length > 0 ? null : noHandle ? (
      <NoHandle subject="Finding keywords needs" />
    ) : (
      <Empty
        action={
          <Link to="/settings" search={{ tab: "writing" }} className={pill}>
            Set keywords
          </Link>
        }
      >
        No keywords yet. Find keywords from your posts above, or type your own in Settings.
      </Empty>
    );

  return (
    <>
      <PageHeader
        title="Targets"
        detail={
          result.waiting && AsyncResult.isSuccess(result)
            ? "refreshing"
            : AsyncResult.isSuccess(result)
              ? `${targets.length} targets`
              : undefined
        }
        actions={
          <>
            <button
              type="button"
              className={pill}
              disabled={finding || noHandle || findQuote === "…" || assistQuote === "…"}
              title={noHandle ? "Needs your handle, from your X session or Settings" : undefined}
              onClick={() => void runFind()}
            >
              <TextMorph duration={250}>{finding ? "Finding…" : "Find keywords"}</TextMorph>
              {/* One page of your posts, then one model call over it. */}
              <Cost label={costLabels(findQuote, assistQuote)} />
            </button>
            <button
              type="button"
              className={pill}
              disabled={result.waiting || noKeywords !== null || targetsQuote === "…"}
              title={noKeywords !== null ? "Add keywords first" : undefined}
              onClick={() => load()}
            >
              <TextMorph duration={250}>{result.waiting ? "Searching…" : "Refresh"}</TextMorph>
              <Cost label={targetsQuote} />
            </button>
          </>
        }
      />
      {AsyncResult.match(result, {
        onInitial: ({ waiting }) => (
          <TargetsBody
            targets={[]}
            top={top}
            empty={
              noKeywords ?? (
                <Empty>
                  {waiting
                    ? "Searching your keywords…"
                    : "Refresh to search your keywords for posts worth a reply."}
                </Empty>
              )
            }
            onSkip={skip}
          />
        ),
        onFailure: (f) => (
          <PageBody>
            {top}
            <ErrorLine>{errorText(f.cause)}</ErrorLine>
          </PageBody>
        ),
        onSuccess: () => (
          <TargetsBody
            targets={targets}
            top={top}
            empty={
              noKeywords ?? (
                <Empty
                  action={
                    <Link to="/settings" search={{ tab: "writing" }} className={pill}>
                      Edit keywords
                    </Link>
                  }
                >
                  Nothing matches your keywords right now.
                </Empty>
              )
            }
            onSkip={skip}
          />
        ),
      })}
    </>
  );
}

function TargetsBody({
  targets,
  top,
  empty,
  onSkip,
}: {
  readonly targets: ReadonlyArray<ReplyTarget>;
  readonly top: ReactNode;
  readonly empty: ReactNode;
  readonly onSkip: (postId: string) => void;
}) {
  const { selected, select } = useSelection(targets.map((t) => t.post.postId));
  const work = useWork();
  const current = targets.find((t) => t.post.postId === selected) ?? null;
  return (
    <DetailSplit
      detailKey={selected}
      list={
        <>
          {top}
          {targets.length === 0 ? (
            empty
          ) : (
            <>
              <ListHead label="Post" columns={COLUMNS} />
              {targets.map((t) => {
                const replied = t.replied || work.get(t.post.postId).replied;
                return (
                  <ListRow
                    key={t.post.postId}
                    selected={t.post.postId === selected}
                    onSelect={() => select(t.post.postId)}
                    item={t}
                    columns={COLUMNS}
                  >
                    <RowTitle
                      name={t.post.author.name}
                      meta={`@${t.post.author.handle} · ${t.keyword}`}
                      mark={
                        replied ? (
                          <span className="text-success-foreground">replied</span>
                        ) : undefined
                      }
                    />
                    <RowText>{t.post.text}</RowText>
                  </ListRow>
                );
              })}
            </>
          )}
        </>
      }
      detail={
        current === null ? null : (
          <TargetDetail
            key={current.post.postId}
            target={current}
            work={work.get(current.post.postId, { replied: current.replied })}
            patch={work.patch(current.post.postId, { replied: current.replied })}
            onSkip={() => onSkip(current.post.postId)}
          />
        )
      }
    />
  );
}

function TargetDetail({
  target,
  work,
  patch,
  onSkip,
}: {
  readonly target: ReplyTarget;
  readonly work: Work;
  readonly patch: Patch;
  readonly onSkip: () => void;
}) {
  const { post } = target;
  return (
    <>
      <PostHead
        post={post}
        meta={`${age(target.ageMinutes)} · ${target.keyword}`}
        actions={
          <>
            <OpenOnX href={post.url} />
            <button type="button" className={xAction} onClick={onSkip}>
              Skip
            </button>
          </>
        }
      />
      <Section title="Numbers">
        <Props
          rows={[
            ["Views per hour", fmt(target.viewsPerHour)],
            ["Reach", target.reach],
            ["Views", fmt(post.metrics.views)],
            ["Likes", fmt(post.metrics.likes)],
            ["Replies", fmt(post.metrics.replies)],
            ["Author followers", fmt(post.author.followers)],
            ["Author score", target.authorScore === null ? "–" : Math.round(target.authorScore)],
            ["Your replies to them", target.repliesToAuthor],
          ]}
        />
      </Section>
      <ReplyBox post={post} work={work} patch={patch} />
    </>
  );
}

/** Keywords and handles the model suggested from the user's posts, one click into Settings. */
function Found({
  found,
  onAdded,
  onError,
  onDismiss,
}: {
  readonly found: Suggestions;
  readonly onAdded: () => void;
  readonly onError: (message: string) => void;
  readonly onDismiss: () => void;
}) {
  const addKeywords = useAtomSet(addKeywordsAtom, { mode: "promise" });
  const adding = useAtomValue(addKeywordsAtom).waiting;
  const refreshTargetsQuote = useAtomRefresh(quoteAtom([{ kind: "engageTargets" }]));
  const refreshSettings = useAtomRefresh(settingsAtom);
  // New keywords are searches the cache has not seen: requote, and let the priced Refresh run them.
  const add = async () => {
    try {
      await addKeywords(found.keywords);
      onAdded();
      refreshTargetsQuote();
      refreshSettings();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Section
      title="Suggested keywords"
      aside={
        <>
          <button type="button" className={pill} disabled={adding} onClick={() => void add()}>
            Add all
          </button>
          <button type="button" className={xAction} onClick={onDismiss}>
            Dismiss
          </button>
        </>
      }
    >
      <p className="font-mono text-xs">{found.keywords.join(" · ")}</p>
      {found.handles.length > 0 ? (
        <p className="mt-1 font-mono text-2xs text-muted-foreground">
          {found.handles.map((h) => `@${h}`).join(" ")}
        </p>
      ) : null}
    </Section>
  );
}

/** Who the user replies to and about what; rebuilt nightly at 03:00 or on demand. */
function NicheLine() {
  const result = useAtomValue(nicheAtom);
  const refresh = useAtomRefresh(nicheAtom);
  const rebuild = useAtomSet(rebuildNicheAtom, { mode: "promiseExit" });
  const state = useAtomValue(rebuildNicheAtom);
  const rebuilding = state.waiting;
  const niche = AsyncResult.getOrElse(result, () => null);
  if (niche === null) return null;
  return (
    <div className="flex h-10 items-center gap-3 border-b border-border px-6 text-xs">
      <span className="shrink-0 font-medium text-foreground/80">Niche</span>
      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
        {niche.handles.length === 0
          ? "no reply history yet"
          : niche.handles.map((h) => `@${h.handle} ${h.replies}`).join(" · ")}
        {niche.topics.length > 0 ? `  ·  ${niche.topics.join(", ")}` : ""}
      </span>
      {AsyncResult.isFailure(state) ? (
        <span className="shrink-0 truncate text-2xs text-error-foreground">
          {errorText(state.cause)}
        </span>
      ) : null}
      <button
        type="button"
        className={xAction}
        disabled={rebuilding}
        onClick={() => void rebuild().then(refresh)}
      >
        {rebuilding ? "Rebuilding…" : "Rebuild"}
      </button>
    </div>
  );
}
