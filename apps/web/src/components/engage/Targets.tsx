import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { ReplyTarget } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { useQuoteLabel } from "../../state/costs";
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
import { xAction } from "../x";
import { type Patch, ReplyBox, useWork, type Work } from "./ReplyBox";
import {
  type Column,
  ErrorLine,
  ListHead,
  ListRow,
  NoHandle,
  OpenOnX,
  pill,
  PostHead,
  Props,
  RowText,
  RowTitle,
  Split,
  useSelection,
} from "./triage";

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
  const refresh = useAtomRefresh(targetsAtom);
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const find = useAtomSet(findKeywordsAtom, { mode: "promiseExit" });
  const finding = useAtomValue(findKeywordsAtom).waiting;
  const findQuote = useQuoteLabel({ kind: "findKeywords" });
  const targetsQuote = useQuoteLabel({ kind: "engageTargets" });
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
              disabled={finding || noHandle}
              onClick={() => void runFind()}
            >
              <TextMorph duration={250}>{finding ? "Finding…" : "Find keywords"}</TextMorph>
              <Cost label={`${findQuote} + model`} />
            </button>
            <button type="button" className={pill} disabled={result.waiting} onClick={refresh}>
              Refresh
              <Cost label={targetsQuote} />
            </button>
          </>
        }
      />
      {AsyncResult.match(result, {
        onInitial: () => (
          <PageBody>
            <Empty>Loading targets…</Empty>
          </PageBody>
        ),
        onFailure: (f) => (
          <PageBody>
            <ErrorLine>{errorText(f.cause)}</ErrorLine>
          </PageBody>
        ),
        onSuccess: () => (
          <TargetsBody
            targets={targets}
            top={
              <>
                {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
                {found !== null ? (
                  <Found
                    found={found}
                    onDone={() => {
                      setFound(null);
                      refresh();
                    }}
                    onDismiss={() => setFound(null)}
                  />
                ) : null}
                <NicheLine />
              </>
            }
            empty={
              noHandle && settings.keywords.length === 0 ? (
                <NoHandle subject="Finding keywords needs" />
              ) : settings !== null && settings.keywords.length === 0 ? (
                <Empty
                  action={
                    <Link to="/settings" className={pill}>
                      Settings
                    </Link>
                  }
                >
                  No keywords yet. Find some from your posts, or add your own in Settings.
                </Empty>
              ) : (
                <Empty
                  action={
                    <Link to="/settings" className={pill}>
                      Edit keywords
                    </Link>
                  }
                >
                  Nothing matches your keywords right now.
                </Empty>
              )
            }
            onSkip={(id) => setSkipped((s) => new Set(s).add(id))}
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
    <Split
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
            <OpenOnX url={post.url} />
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
  onDone,
  onDismiss,
}: {
  readonly found: Suggestions;
  readonly onDone: () => void;
  readonly onDismiss: () => void;
}) {
  const addKeywords = useAtomSet(addKeywordsAtom, { mode: "promise" });
  return (
    <Section
      title="Suggested keywords"
      aside={
        <>
          <button
            type="button"
            className={pill}
            onClick={() => void addKeywords(found.keywords).then(onDone)}
          >
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
  const rebuilding = useAtomValue(rebuildNicheAtom).waiting;
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
