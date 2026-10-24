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
import { ReplyBox, useWork } from "./ReplyBox";
import { ago, ErrorLine, pill, PostHead } from "./triage";

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
    if (Exit.isFailure(exit)) setError(errorText(exit.cause));
    else refresh();
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
        <button type="button" className={pill} disabled={fetching} onClick={() => void runFetch()}>
          <TextMorph duration={250}>{fetching ? "Fetching…" : "Fetch new"}</TextMorph>
          <Cost label={quote} />
        </button>
      }
      empty={
        isElectron
          ? "No mentions yet. They appear as you browse x.com, or fetch new ones from X."
          : "No mentions yet. The desktop app collects them as you browse x.com."
      }
    />
  );
}

/** Open or every mention in a list, the selected one beside it with Mark handled and a reply. */
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
  const all = AsyncResult.getOrElse(result, () => []);
  const open = all.filter((m) => !m.handled);
  const shown = filter === "open" ? open : all;
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
        actions={actions}
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
            top={top}
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
  top,
  empty,
}: {
  readonly mentions: ReadonlyArray<Mention>;
  readonly kind: (m: Mention) => string;
  readonly top: ReactNode;
  readonly empty: ReactNode;
}) {
  const { selected, select } = useSelection(mentions.map((m) => m.post.postId));
  const work = useWork();
  const current = mentions.find((m) => m.post.postId === selected) ?? null;
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
              <ListHead label="Post" columns={COLUMNS} />
              {mentions.map((m) => (
                <ListRow
                  key={m.post.postId}
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
  const markHandled = useAtomSet(markHandledAtom, { mode: "promise" });
  const refreshMentions = useAtomRefresh(mentionsAtom);
  const refreshInbox = useAtomRefresh(inboxAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onHandled = async () => {
    setBusy(true);
    setError(null);
    try {
      await markHandled(post.postId);
      // Both lists read the same handled flag, and the sidebar counts open mentions.
      refreshMentions();
      refreshInbox();
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
            <button
              type="button"
              className={pill}
              disabled={busy || mention.handled}
              onClick={() => void onHandled()}
            >
              <TextMorph duration={250}>{mention.handled ? "Handled" : "Mark handled"}</TextMorph>
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
