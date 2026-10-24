import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { SentReply } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { isElectron } from "../../env";
import { fmtWhen } from "../../lib/time";
import { inboxAtom } from "../../state/engage";
import { errorText } from "../analyze/ui";
import { PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Empty, PageBody, Section } from "../ui/layout";
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
import { MentionTriage } from "./Mentions";
import { ago, ErrorLine, pill } from "./triage";

/** Replies and quotes to the user's posts that the session saw. */
export function Incoming() {
  const result = useAtomValue(inboxAtom);
  return (
    <MentionTriage
      title="Inbox"
      noHandle="The inbox needs"
      result={AsyncResult.map(result, (v) => v.incoming)}
      kind={(m) => (m.post.isReply ? "reply" : "quote")}
      top={null}
      actions={undefined}
      empty={
        isElectron
          ? "No replies or quotes yet. They arrive as you browse x.com."
          : "No replies or quotes yet. The desktop app collects them as you browse x.com."
      }
    />
  );
}

const COLUMNS: ReadonlyArray<Column<SentReply>> = [
  {
    label: "Followers",
    className: "hidden w-20 @lg:block",
    cell: (r) => (r.attributedFollowers > 0 ? `+${r.attributedFollowers}` : ""),
  },
  {
    label: "Status",
    className: "w-16",
    cell: (r) =>
      r.error !== null ? <span className="text-error-foreground">failed</span> : "sent",
  },
  { label: "Sent", className: "w-12", cell: (r) => ago(r.at) },
];

/** Replies sent from here, or the ones worth a second touch: older than two days, nothing since. */
export function SentReplies({ view }: { readonly view: "sent" | "followUps" }) {
  const result = useAtomValue(inboxAtom);
  const rows = AsyncResult.getOrElse(
    AsyncResult.map(result, (v) => (view === "sent" ? v.sent : v.followUps)),
    () => [],
  );
  const gained = rows.reduce((n, r) => n + r.attributedFollowers, 0);
  return (
    <>
      <PageHeader
        title={view === "sent" ? "Sent" : "Follow-ups"}
        detail={
          !AsyncResult.isSuccess(result)
            ? undefined
            : view === "sent"
              ? `${rows.length} sent${gained > 0 ? ` · +${gained} followers` : ""}`
              : `${rows.length} due`
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
        onSuccess: () =>
          rows.length === 0 ? (
            <PageBody>
              {view === "sent" ? (
                <NothingSent />
              ) : (
                <Empty>
                  Nothing to follow up on. Replies older than two days with nothing from you since
                  show up here.
                </Empty>
              )}
            </PageBody>
          ) : (
            <ReplyList rows={rows} followUp={view === "followUps"} />
          ),
      })}
    </>
  );
}

function NothingSent() {
  const navigate = useNavigate();
  return (
    <Empty
      action={
        <button
          type="button"
          className={pill}
          onClick={() => void navigate({ href: sectionHref("/engage", "targets") })}
        >
          Targets
        </button>
      }
    >
      No replies sent yet. Pick a target and reply from there.
    </Empty>
  );
}

function ReplyList({
  rows,
  followUp,
}: {
  readonly rows: ReadonlyArray<SentReply>;
  readonly followUp: boolean;
}) {
  const { selected, select } = useSelection(rows.map((r) => r.id));
  const current = rows.find((r) => r.id === selected) ?? null;
  return (
    <DetailSplit
      detailKey={selected}
      list={
        <>
          <ListHead label="Reply" columns={COLUMNS} />
          {rows.map((r) => (
            <ListRow
              key={r.id}
              selected={r.id === selected}
              onSelect={() => select(r.id)}
              item={r}
              columns={COLUMNS}
            >
              <RowTitle name={`@${r.targetHandle}`} meta={fmtWhen(r.at)} />
              <RowText>{r.text}</RowText>
            </ListRow>
          ))}
        </>
      }
      detail={current === null ? null : <ReplyDetail reply={current} followUp={followUp} />}
    />
  );
}

function ReplyDetail({
  reply,
  followUp,
}: {
  readonly reply: SentReply;
  readonly followUp: boolean;
}) {
  return (
    <>
      <Section>
        <p className="truncate text-sm font-semibold">To @{reply.targetHandle}</p>
        <p className="text-[12.5px] text-muted-foreground">{fmtWhen(reply.at)}</p>
        <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{reply.text}</p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <OpenOnX href={reply.targetUrl} label={followUp ? "Reply again on X" : "Their post"} />
          {reply.postId !== null ? (
            <OpenOnX href={`https://x.com/i/status/${reply.postId}`} label="Your reply" />
          ) : null}
        </div>
      </Section>
      <Section title="Numbers">
        <Props
          rows={[
            ["Status", reply.error !== null ? "failed" : "sent"],
            [
              "New followers, 24 h",
              reply.attributedFollowers > 0 ? `+${reply.attributedFollowers}` : "0",
            ],
          ]}
        />
        {reply.error !== null ? (
          <p className="mt-3 text-xs break-words text-error-foreground">{reply.error}</p>
        ) : null}
      </Section>
    </>
  );
}
