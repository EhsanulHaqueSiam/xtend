import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Mention } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { isElectron } from "../../env";
import { useQuoteLabel } from "../../state/costs";
import { inboxAtom, markHandledAtom, mentionsAtom, refreshMentionsAtom } from "../../state/engage";
import { settingsAtom } from "../../state/settings";
import { errorText, fmt } from "../analyze/ui";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import { NoHandle } from "../ui/no-handle";
import { FreeOnX } from "../ui/x-link";
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
import { toastAtom } from "../ui/toast";
import { OpenOnX } from "../ui/x-link";
import { ReplyBox, useWork } from "./ReplyBox";
import { ago, ErrorLine, pill, pillSolid, PostHead } from "./triage";

const COLUMNS: ReadonlyArray<Column<Mention>> = [
  { label: "Likes", className: "w-14", cell: (m) => fmt(m.post.metrics.likes) },
  {
    label: "Replies",
    className: "hidden w-16 @lg:block",
    cell: (m) => fmt(m.post.metrics.replies),
  },
  { label: "Views", className: "hidden w-16 @xl:block", cell: (m) => fmt(m.post.metrics.views) },
  { label: "Age", className: "w-12", cell: (m) => ago(m.post.createdAt) },
];

type Filter = "open" | "all";

/** Mentions of the user: what the session saw (free) plus what a paid fetch brought in. */
export function Mentions() {
  const result = useAtomValue(mentionsAtom);
  const refresh = useAtomRefresh(mentionsAtom);
  const fetch = useAtomSet(refreshMentionsAtom, { mode: "promiseExit" });
  const fetching = useAtomValue(refreshMentionsAtom).waiting;
  const quote = useQuoteLabel({ kind: "mentions" });
  const [error, setError] = useState<string | null>(null);

  const runFetch = async () => {
    setError(null);
    const exit = await fetch();
    if (Exit.isFailure(exit)) return setError(errorText(exit.cause));
    // X refusing the read comes back in the result; the free list refetched below never carries it.
    setError(exit.value.apiError);
    refresh();
  };

  return (
    <MentionTriage
      title="Mentions"
      noHandle="Mentions need"
      result={AsyncResult.map(result, (v) => v.mentions)}
      kind={(m) => m.source}
      top={
        <>
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          {AsyncResult.isSuccess(result) && result.value.apiError !== null ? (
            <ErrorLine>{result.value.apiError}</ErrorLine>
          ) : null}
        </>
      }
      actions={
        <>
          <FreeOnX href="https://x.com/notifications/mentions" label="Notifications on X" />
          <button
            type="button"
            className={pill}
            disabled={fetching || quote === "…"}
            onClick={() => void runFetch()}
          >
            <TextMorph duration={250}>{fetching ? "Fetching…" : "Fetch new"}</TextMorph>
            <Cost label={quote} />
          </button>
        </>
      }
      empty={
        isElectron
          ? "No mentions yet. They appear as you browse x.com, or fetch new ones from X."
          : "No mentions yet. The desktop app collects them as you browse x.com."
      }
    />
  );
}

/**
 * Open or every mention in a list, the selected one beside it with Mark handled and a reply.
 * Checked rows swap the header actions for one Mark handled over all of them.
 */
export function MentionTriage({
  title,
  noHandle,
  result,
  kind,
  top,
  actions,
  empty,
}: {
  readonly title: string;
  /** How the no-handle line starts, e.g. "Mentions need". */
  readonly noHandle: string;
  readonly result: AsyncResult.AsyncResult<ReadonlyArray<Mention>, unknown>;
  readonly kind: (m: Mention) => string;
  readonly top: ReactNode;
  readonly actions: ReactNode;
  readonly empty: string;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [picks, setPicks] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setHandled = useSetHandled();
  const setToast = useAtomSet(toastAtom);
  const all = AsyncResult.getOrElse(result, () => []);
  const open = all.filter((m) => !m.handled);
  const shown = filter === "open" ? open : all;
  // Only rows on screen count: a pick that left the list (handled, other filter) is not marked.
  const picked = shown.filter((m) => picks.has(m.post.postId)).map((m) => m.post.postId);
  const pick = (ids: ReadonlyArray<string>, on: boolean) =>
    setPicks((prev) => {
      const next = new Set(prev);
      for (const id of ids)
        if (on) next.add(id);
        else next.delete(id);
      return next;
    });

  const onMarkPicked = async () => {
    setBusy(true);
    setError(null);
    try {
      await setHandled(picked, true);
      setPicks(new Set());
      setToast({ text: `${picked.length} marked handled`, undo: () => setHandled(picked, false) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const tabs = [
    { id: "open", label: "Open", count: open.length },
    { id: "all", label: "All", count: all.length },
  ] as const;

  return (
    <>
      <PageHeader
        title={title}
        tabs={<HeaderTabs label="Show" tabs={tabs} value={filter} onChange={setFilter} />}
        actions={
          picked.length === 0 ? (
            actions
          ) : (
            <>
              <button
                type="button"
                className={pillSolid}
                disabled={busy}
                onClick={() => void onMarkPicked()}
              >
                Mark {picked.length} handled
              </button>
              <button type="button" className={pill} onClick={() => setPicks(new Set())}>
                Clear
              </button>
            </>
          )
        }
      />
      {AsyncResult.match(result, {
        onInitial: () => (
          <PageBody>
            <Empty>Loading…</Empty>
          </PageBody>
        ),
        onFailure: (f) => (
          <PageBody>
            <ErrorLine>{errorText(f.cause)}</ErrorLine>
          </PageBody>
        ),
        onSuccess: () => (
          <MentionList
            mentions={shown}
            kind={kind}
            picks={picks}
            pick={pick}
            top={
              <>
                {top}
                {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
              </>
            }
            empty={
              settings !== null && settings.handle === null ? (
                <NoHandle subject={noHandle} />
              ) : filter === "open" && all.length > 0 ? (
                <Empty>All handled.</Empty>
              ) : (
                <Empty>{empty}</Empty>
              )
            }
          />
        ),
      })}
    </>
  );
}

function MentionList({
  mentions,
  kind,
  picks,
  pick,
  top,
  empty,
}: {
  readonly mentions: ReadonlyArray<Mention>;
  readonly kind: (m: Mention) => string;
  readonly picks: ReadonlySet<string>;
  readonly pick: (ids: ReadonlyArray<string>, on: boolean) => void;
  readonly top: ReactNode;
  readonly empty: ReactNode;
}) {
  const { selected, select } = useSelection(mentions.map((m) => m.post.postId));
  const work = useWork();
  const current = mentions.find((m) => m.post.postId === selected) ?? null;
  const pickedCount = mentions.filter((m) => picks.has(m.post.postId)).length;
  return (
    <DetailSplit
      detailKey={selected}
      list={
        <>
          {top}
          {mentions.length === 0 ? (
            empty
          ) : (
            <>
              {/* The checks sit in the rows' left padding, beside the row buttons rather than
                  inside them: a control inside a button is not reachable on its own. */}
              <div className="sticky top-0 z-10">
                <input
                  type="checkbox"
                  aria-label="Pick all"
                  className={check}
                  checked={pickedCount > 0 && pickedCount === mentions.length}
                  ref={(el) => {
                    if (el !== null)
                      el.indeterminate = pickedCount > 0 && pickedCount < mentions.length;
                  }}
                  onChange={(e) =>
                    pick(
                      mentions.map((m) => m.post.postId),
                      e.target.checked,
                    )
                  }
                />
                <ListHead label="Post" columns={COLUMNS} />
              </div>
              {mentions.map((m) => (
                <div key={m.post.postId} className="relative">
                  <input
                    type="checkbox"
                    aria-label={`Pick ${m.post.author.name}`}
                    className={check}
                    checked={picks.has(m.post.postId)}
                    onChange={(e) => pick([m.post.postId], e.target.checked)}
                  />
                  <ListRow
                    selected={m.post.postId === selected}
                    onSelect={() => select(m.post.postId)}
                    muted={m.handled}
                    item={m}
                    columns={COLUMNS}
                  >
                    <RowTitle
                      name={m.post.author.name}
                      meta={`@${m.post.author.handle} · ${kind(m)}`}
                      mark={m.handled ? "handled" : undefined}
                    />
                    <RowText>{m.post.text}</RowText>
                  </ListRow>
                </div>
              ))}
            </>
          )}
        </>
      }
      detail={
        current === null ? null : (
          <MentionDetail
            key={current.post.postId}
            mention={current}
            kind={kind(current)}
            reply={
              <ReplyBox
                post={current.post}
                work={work.get(current.post.postId)}
                patch={work.patch(current.post.postId)}
              />
            }
          />
        )
      }
    />
  );
}

const check =
  "absolute top-1/2 left-[5px] z-20 size-3.5 -translate-y-1/2 cursor-pointer accent-foreground";

/** Marks mentions handled or reopens them, then refetches every list that reads the flag. */
function useSetHandled() {
  const markHandled = useAtomSet(markHandledAtom, { mode: "promise" });
  const refreshMentions = useAtomRefresh(mentionsAtom);
  const refreshInbox = useAtomRefresh(inboxAtom);
  // Both lists read the same handled flag, and the sidebar counts open mentions.
  return (postIds: ReadonlyArray<string>, handled: boolean) =>
    markHandled({ postIds, handled }).then(() => {
      refreshMentions();
      refreshInbox();
    });
}

function MentionDetail({
  mention,
  kind,
  reply,
}: {
  readonly mention: Mention;
  readonly kind: string;
  readonly reply: ReactNode;
}) {
  const { post } = mention;
  const setHandled = useSetHandled();
  const setToast = useAtomSet(toastAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onToggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const handled = !mention.handled;
      await setHandled([post.postId], handled);
      // Under Open the mention leaves the list at once; the toast brings it back.
      if (handled)
        setToast({ text: "Marked handled", undo: () => setHandled([post.postId], false) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PostHead
        post={post}
        meta={`${ago(post.createdAt)} · ${kind}`}
        actions={
          <>
            <button type="button" className={pill} disabled={busy} onClick={() => void onToggle()}>
              <TextMorph duration={250}>{mention.handled ? "Reopen" : "Mark handled"}</TextMorph>
            </button>
            <OpenOnX href={post.url} />
          </>
        }
      />
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <Section title="Numbers">
        <Props
          rows={[
            ["Views", fmt(post.metrics.views)],
            ["Likes", fmt(post.metrics.likes)],
            ["Reposts", fmt(post.metrics.reposts)],
            ["Replies", fmt(post.metrics.replies)],
            ["Quotes", fmt(post.metrics.quotes)],
            ["Author followers", fmt(post.author.followers)],
          ]}
        />
      </Section>
      {reply}
    </>
  );
}
