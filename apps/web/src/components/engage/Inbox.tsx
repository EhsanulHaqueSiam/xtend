import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { FollowUp, SentReply } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactElement } from "react";

import { isElectron } from "../../env";
import { fmtWhen } from "../../lib/time";
import { closeFollowUpAtom, inboxAtom } from "../../state/engage";
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
import { toastAtom } from "../ui/toast";
import { OpenOnX } from "../ui/x-link";
import { MentionTriage } from "./Mentions";
import { ReplyBox, useWork } from "./ReplyBox";
import { ago, ErrorLine, pill, PostHead } from "./triage";

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

const SENT_AGE: Column<SentReply> = { label: "Sent", className: "w-12", cell: (r) => ago(r.at) };

const SENT_COLUMNS: ReadonlyArray<Column<SentReply>> = [
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
  SENT_AGE,
];

// A follow-up is always a reply X accepted, with nothing credited yet: only its age says anything.
const FOLLOW_UP_COLUMNS = [SENT_AGE];

/** Replies sent from here, or the ones worth a second touch: older than two days, nothing since. */
export function SentReplies({ view }: { readonly view: "sent" | "followUps" }) {
  const result = useAtomValue(inboxAtom);
  const work = useWork();
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
        onSuccess: ({ value }) =>
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
          ) : view === "sent" ? (
            <ReplyList
              rows={value.sent}
              columns={SENT_COLUMNS}
              detail={(r) => <ReplyDetail reply={r} />}
            />
          ) : (
            <ReplyList
              rows={value.followUps}
              columns={FOLLOW_UP_COLUMNS}
              detail={(r) => <FollowUpDetail key={r.id} reply={r} work={work} />}
            />
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

function ReplyList<R extends SentReply>({
  rows,
  columns,
  detail,
}: {
  readonly rows: ReadonlyArray<R>;
  readonly columns: ReadonlyArray<Column<R>>;
  readonly detail: (reply: R) => ReactElement;
}) {
  const { selected, select } = useSelection(rows.map((r) => r.id));
  const current = rows.find((r) => r.id === selected) ?? null;
  return (
    <DetailSplit
      detailKey={selected}
      list={
        <>
          <ListHead label="Reply" columns={columns} />
          {rows.map((r) => (
            <ListRow
              key={r.id}
              selected={r.id === selected}
              onSelect={() => select(r.id)}
              item={r}
              columns={columns}
            >
              <RowTitle name={`@${r.targetHandle}`} meta={fmtWhen(r.at)} />
              <RowText>{r.text}</RowText>
            </ListRow>
          ))}
        </>
      }
      detail={current === null ? null : detail(current)}
    />
  );
}

function ReplyDetail({ reply }: { readonly reply: SentReply }) {
  return (
    <>
      <Section>
        <p className="truncate text-sm font-semibold">To @{reply.targetHandle}</p>
        <p className="text-[12.5px] text-muted-foreground">{fmtWhen(reply.at)}</p>
        <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{reply.text}</p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <OpenOnX href={reply.targetUrl} label="Their post" />
          <YourReply reply={reply} />
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

function YourReply({ reply }: { readonly reply: SentReply }) {
  return reply.postId === null ? null : (
    <OpenOnX href={`https://x.com/i/status/${reply.postId}`} label="Your reply" />
  );
}

/**
 * The post the user answered, their reply, and a second reply in place. Done or Dismiss takes it
 * off the due list in the service, for a follow-up made on X or one not worth making.
 */
function FollowUpDetail({
  reply,
  work,
}: {
  readonly reply: FollowUp;
  readonly work: ReturnType<typeof useWork>;
}) {
  const close = useAtomSet(closeFollowUpAtom, { mode: "promise" });
  const refreshInbox = useAtomRefresh(inboxAtom);
  const setToast = useAtomSet(toastAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { target } = reply;

  const setState = (state: "done" | "dismissed" | null) =>
    close({ id: reply.id, state }).then(refreshInbox);

  const onClose = async (state: "done" | "dismissed") => {
    setBusy(true);
    setError(null);
    try {
      await setState(state);
      // The follow-up leaves the list at once; the toast brings it back.
      setToast({
        text: state === "done" ? "Marked done" : "Dismissed",
        undo: () => setState(null),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const actions = (
    <>
      <button type="button" className={pill} disabled={busy} onClick={() => void onClose("done")}>
        Done
      </button>
      <button
        type="button"
        className={pill}
        disabled={busy}
        onClick={() => void onClose("dismissed")}
      >
        Dismiss
      </button>
      <OpenOnX href={reply.targetUrl} label={target === null ? "Reply again on X" : "Open on X"} />
    </>
  );

  return (
    <>
      {target === null ? (
        <Section>
          <p className="truncate text-sm font-semibold">To @{reply.targetHandle}</p>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">{actions}</div>
        </Section>
      ) : (
        <PostHead post={target} meta={`their post · ${ago(target.createdAt)}`} actions={actions} />
      )}
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <Section title={`You replied ${ago(reply.at)} ago`}>
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{reply.text}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <YourReply reply={reply} />
        </div>
      </Section>
      {target === null ? null : (
        <ReplyBox
          post={target}
          work={work.get(target.postId)}
          patch={(change) => {
            work.patch(target.postId)(change);
            // A second reply settles the follow-up in the service; the list drops it now.
            if (change.replied === true) {
              setToast({ text: `Replied to @${reply.targetHandle}` });
              refreshInbox();
            }
          }}
        />
      )}
    </>
  );
}
