import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { Person, Stage, XPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactElement, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { useQuoteLabel, useRates } from "../../state/costs";
import {
  draftDmAtom,
  draftReplyAtom,
  latestPostAtom,
  peopleAtom,
  personAtom,
  personProfileAtom,
  sendDmAtom,
  sendReplyAtom,
  updatePersonAtom,
} from "../../state/leads";
import { errorText, fmt } from "../analyze/ui";
import { ago, ErrorLine, pill, pillSolid } from "../engage/triage";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { inputClass } from "../ui/field";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import {
  type Column,
  DetailSplit,
  ListHead,
  ListRow,
  Props,
  RowTitle,
  useSelection,
} from "../ui/split";
import { OpenOnX, profileUrl } from "../ui/x-link";
import { STAGES, StageText, useAction } from "./ui";

const COLUMNS: ReadonlyArray<Column<Person>> = [
  { label: "Score", className: "w-10", cell: (p) => fmt(p.score) },
  {
    label: "Tier",
    className: "hidden w-20 @xl:block",
    cell: (p) => <span className="text-muted-foreground">{p.tier ?? ""}</span>,
  },
  { label: "Followers", className: "w-18", cell: (p) => fmt(p.followers) },
  {
    label: "Source",
    className: "hidden w-32 @2xl:block",
    cell: (p) => <span className="text-muted-foreground">{p.source}</span>,
  },
  {
    label: "Stage",
    className: "hidden w-20 @lg:block",
    cell: (p) => <StageText stage={p.stage} />,
  },
  {
    label: "Last",
    className: "w-12",
    cell: (p) => <span className="text-muted-foreground">{ago(p.lastActivity)}</span>,
  },
];

type StageFilter = "all" | Stage;

/** Everyone the screens have found, filtered by stage, with the selected person beside the table. */
export function PeopleSection() {
  const people = useAtomValue(peopleAtom(null));
  const [stage, setStage] = useState<StageFilter>("all");
  const all = AsyncResult.getOrElse(people, () => []);
  const tabs = [
    { id: "all" as const, label: "All", count: all.length },
    ...STAGES.map((s) => ({
      id: s,
      label: s[0]!.toUpperCase() + s.slice(1),
      count: all.filter((p) => p.stage === s).length,
    })),
  ];
  return (
    <>
      <PageHeader
        title="People"
        tabs={
          all.length === 0 ? undefined : (
            <HeaderTabs label="Stage" tabs={tabs} value={stage} onChange={setStage} />
          )
        }
      />
      <PeopleSplit
        listId={null}
        stage={stage}
        empty={stage === "all" ? <NoPeople /> : <Empty>No one at {stage} yet.</Empty>}
      />
    </>
  );
}

function NoPeople() {
  const navigate = useNavigate();
  return (
    <Empty
      action={
        <button
          type="button"
          className={pill}
          onClick={() => void navigate({ href: sectionHref("/leads", "lists") })}
        >
          Build a list
        </button>
      }
    >
      No people yet. Build a list, run an agent or check new followers.
    </Empty>
  );
}

/**
 * A people table and, beside it, the selected person, or `aside` when the
 * caller opened something else there (the list builder). Picking a row calls
 * `onPick` so the caller can put the person back.
 */
export function PeopleSplit({
  listId,
  stage = "all",
  aside = null,
  onPick,
  empty,
}: {
  readonly listId: number | null;
  readonly stage?: StageFilter;
  readonly aside?: ReactElement | null;
  readonly onPick?: () => void;
  readonly empty: ReactNode;
}) {
  const result = useAtomValue(peopleAtom(listId));
  const all = AsyncResult.getOrElse(result, () => []);
  const people = stage === "all" ? all : all.filter((p) => p.stage === stage);
  const { selected, select } = useSelection(people.map((p) => p.id));
  const current = people.find((p) => p.id === selected) ?? null;

  return AsyncResult.match(result, {
    onInitial: () => (
      <PageBody>
        <Empty>Loading people…</Empty>
      </PageBody>
    ),
    onFailure: (f) => (
      <PageBody>
        <ErrorLine>{errorText(f.cause)}</ErrorLine>
      </PageBody>
    ),
    onSuccess: () => (
      <DetailSplit
        detailKey={aside !== null ? "aside" : selected}
        list={
          people.length === 0 ? (
            empty
          ) : (
            <>
              <ListHead label="Person" columns={COLUMNS} />
              {people.map((p) => (
                <ListRow
                  key={p.id}
                  selected={aside === null && p.id === selected}
                  onSelect={() => {
                    select(p.id);
                    onPick?.();
                  }}
                  muted={p.stage === "ignored"}
                  item={p}
                  columns={COLUMNS}
                >
                  <RowTitle name={`@${p.handle}`} meta={p.name} />
                </ListRow>
              ))}
            </>
          )
        }
        detail={
          aside !== null ? (
            aside
          ) : current === null ? null : (
            <PersonPanel key={current.id} listed={current} listId={listId} />
          )
        }
      />
    ),
  });
}

/**
 * One person: who they are, their stage and notes, a DM, a reply to their
 * latest post and what happened so far. The row they were picked from shows
 * at once; the full record (activity) follows.
 */
function PersonPanel({
  listed,
  listId,
}: {
  readonly listed: Person;
  readonly listId: number | null;
}) {
  const { id } = listed;
  const rates = useRates();
  const data = useAtomValue(personAtom(id));
  const refresh = useAtomRefresh(personAtom(id));
  const refreshList = useAtomRefresh(peopleAtom(listId));
  const update = useAtomSet(updatePersonAtom, { mode: "promise" });
  const fetchProfile = useAtomSet(personProfileAtom, { mode: "promise" });
  const profile = useAction();
  const edit = useAction();
  const [notes, setNotes] = useState<string | null>(null);
  const loaded = AsyncResult.getOrElse(data, () => null);
  const person = loaded?.person ?? listed;
  const refreshBoth = () => {
    refresh();
    refreshList();
  };

  const setStage = (stage: Stage) => edit.run(() => update({ id, stage }).then(refreshBoth));

  return (
    <>
      <Section>
        <p className="truncate text-sm font-semibold">@{person.handle}</p>
        <p className="truncate text-[12.5px] text-muted-foreground">{person.name}</p>
        <p
          className={cn(
            "mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap",
            person.bio === "" && "text-muted-foreground",
          )}
        >
          {person.bio || "No bio loaded."}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={pill}
            disabled={profile.busy || rates === null}
            onClick={() => void profile.run(() => fetchProfile(id).then(refreshBoth))}
          >
            <TextMorph duration={250}>{profile.busy ? "Fetching…" : "Fetch profile"}</TextMorph>
            {rates === null ? <Cost label="…" /> : <Cost usd={rates.scraperProfile} />}
          </button>
          <OpenOnX href={profileUrl(person.handle)} />
        </div>
        {profile.error !== null ? (
          <p className="mt-2 text-xs text-error-foreground">{profile.error}</p>
        ) : null}
      </Section>
      <Section title="Stage">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1"
          role="group"
          aria-label="Stage"
        >
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === person.stage}
              disabled={edit.busy}
              className="cursor-pointer text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground aria-pressed:font-medium"
              onClick={() => void setStage(s)}
            >
              {s}
            </button>
          ))}
        </div>
        {edit.error !== null ? (
          <p className="mt-2 text-xs text-error-foreground">{edit.error}</p>
        ) : null}
      </Section>
      <Section title="Numbers">
        <Props
          rows={[
            [
              "Score",
              person.score === null
                ? "–"
                : `${person.score}${person.tier === null ? "" : ` ${person.tier}`}`,
            ],
            ["Followers", fmt(person.followers)],
            ["Source", person.source],
            ["First seen", fmtWhen(person.firstSeen)],
            ["Last activity", fmtWhen(person.lastActivity)],
          ]}
        />
      </Section>
      <Section title="Notes">
        <textarea
          className={cn(inputClass, "min-h-16 resize-y leading-relaxed")}
          placeholder="What you know about them"
          value={notes ?? person.notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== null && notes !== person.notes)
              void edit.run(() => update({ id, notes }).then(refresh));
          }}
        />
      </Section>
      <DirectMessage person={person} onSent={refreshBoth} />
      <Reply id={id} handle={person.handle} onSent={refreshBoth} />
      <Section title="Activity">
        {loaded === null ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : loaded.activity.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="border-t border-border">
            {loaded.activity.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[2.5rem_4.5rem_minmax(0,1fr)] gap-2 border-b border-border py-1.5 text-xs"
              >
                <span className="font-mono text-muted-foreground tabular-nums">{ago(a.at)}</span>
                <span className="font-mono">{a.kind}</span>
                <span className="truncate text-muted-foreground">{a.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/** A DM through the X connection. X needs their user id, which a profile fetch fills. */
function DirectMessage({
  person,
  onSent,
}: {
  readonly person: Person;
  readonly onSent: () => void;
}) {
  const rates = useRates();
  const draftDm = useAtomSet(draftDmAtom, { mode: "promise" });
  const sendDm = useAtomSet(sendDmAtom, { mode: "promise" });
  const draft = useAction();
  const send = useAction();
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  // The draft reads their recent posts first.
  const postsQuote = useQuoteLabel({ kind: "userPosts", handle: person.handle });
  const noUserId = person.userId === null;
  return (
    <Section
      title="Direct message"
      aside={
        noUserId ? (
          <span className="text-xs text-muted-foreground">fetch the profile first</span>
        ) : undefined
      }
    >
      <textarea
        className={cn(inputClass, "min-h-20 resize-y leading-relaxed")}
        placeholder="Write a DM, or draft one"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={pillSolid}
          disabled={send.busy || draft.busy || text.trim() === "" || noUserId || rates === null}
          onClick={() =>
            void send.run(() =>
              sendDm({ id: person.id, text }).then(() => {
                setText("");
                setSent(true);
                onSent();
              }),
            )
          }
        >
          <TextMorph duration={250}>{send.busy ? "Sending…" : sent ? "Sent" : "Send DM"}</TextMorph>
          {rates === null ? <Cost tone="solid" label="…" /> : <Cost tone="solid" usd={rates.dm} />}
        </button>
        <button
          type="button"
          className={pill}
          disabled={send.busy || draft.busy}
          onClick={() => void draft.run(() => draftDm(person.id).then(setText))}
        >
          <TextMorph duration={250}>{draft.busy ? "Drafting…" : "Draft with AI"}</TextMorph>
          <Cost label={postsQuote} />
        </button>
      </div>
      {(send.error ?? draft.error) ? (
        <p className="mt-2 text-xs text-error-foreground">{send.error ?? draft.error}</p>
      ) : null}
    </Section>
  );
}

/** Their latest post, an AI draft, and a reply through the X connection; every paid step is priced on its button. */
function Reply({
  id,
  handle,
  onSent,
}: {
  readonly id: number;
  readonly handle: string;
  readonly onSent: () => void;
}) {
  const loadPost = useAtomSet(latestPostAtom, { mode: "promise" });
  const draft = useAtomSet(draftReplyAtom, { mode: "promise" });
  const send = useAtomSet(sendReplyAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [post, setPost] = useState<XPost | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const postQuote = useQuoteLabel({ kind: "userPosts", handle });
  const replyQuote = useQuoteLabel({ kind: "post", text });
  const load = () => run(() => loadPost(id).then(setPost));
  return (
    <Section
      title="Reply to their latest post"
      aside={
        post === undefined ? undefined : (
          <button
            type="button"
            className="flex cursor-pointer items-baseline gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => void load()}
          >
            Load again
            <Cost label={postQuote} />
          </button>
        )
      }
    >
      {post === undefined ? (
        <button type="button" className={pill} disabled={busy} onClick={() => void load()}>
          <TextMorph duration={250}>{busy ? "Loading…" : "Load their latest post"}</TextMorph>
          <Cost label={postQuote} />
        </button>
      ) : post === null ? (
        <p className="text-[13px] text-muted-foreground">No recent post found.</p>
      ) : (
        <>
          <p className="line-clamp-4 border-l border-white/13 pl-3 text-[13px] leading-relaxed text-foreground/80">
            {post.text}
          </p>
          <textarea
            className={cn(inputClass, "mt-3 min-h-20 resize-y leading-relaxed")}
            placeholder="Write a reply, or draft one"
            value={text}
            maxLength={280}
            onChange={(e) => {
              setText(e.target.value);
              setSentId(null);
            }}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={pillSolid}
              disabled={busy || text.trim() === ""}
              onClick={() =>
                void run(() =>
                  send({ id, postId: post.postId, text }).then((r) => {
                    setSentId(r.postId);
                    setText("");
                    onSent();
                  }),
                )
              }
            >
              <TextMorph duration={250}>{sentId !== null ? "Replied" : "Reply"}</TextMorph>
              <Cost tone="solid" label={replyQuote} />
            </button>
            <button
              type="button"
              className={pill}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  draft(id).then((d) => {
                    setPost(d.post);
                    setText(d.text);
                  }),
                )
              }
            >
              Draft with AI
              {/* The draft reads their latest post again. */}
              <Cost label={postQuote} />
            </button>
          </div>
        </>
      )}
      {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
    </Section>
  );
}
