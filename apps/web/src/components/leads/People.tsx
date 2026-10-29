import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { postCostUsd, type Person, type ReplyTone, type Stage, type XPost } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactElement, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { PERSON_TYPE } from "../../lib/drag";
import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { useQuoteLabel, useRates } from "../../state/costs";
import { useSessionLane } from "../../state/settings";
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
import { seenByAtom } from "../../state/observations";
import { errorText, fmt } from "../analyze/ui";
import { useWorkBy } from "../engage/ReplyBox";
import { ago, ErrorLine, pill, pillSolid } from "../engage/triage";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Candidates, ToneRow } from "../ui/assist-choice";
import { inputClass } from "../ui/field";
import { observedToXPost } from "../../lib/observed";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import { toastAtom } from "../ui/toast";
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
import { STAGES, StageText, TierText, useAction } from "./ui";

const COLUMNS: ReadonlyArray<Column<Person>> = [
  { label: "Score", className: "w-10", cell: (p) => fmt(p.score) },
  {
    label: "Tier",
    className: "hidden w-20 @xl:block",
    cell: (p) => (
      <span className="text-muted-foreground">
        <TierText tier={p.tier} />
      </span>
    ),
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
type View = "table" | "stages";

/** What the user did for one person here: the DM and reply drafts, their latest post, what went out. */
interface Outreach {
  readonly dm: string;
  readonly dmSent: boolean;
  readonly dmBusy: "draft" | "send" | null;
  readonly dmError: string | null;
  /** The pressed tone chip and the drafts it brought: null is the user's own words. */
  readonly dmTone: ReplyTone | null;
  readonly dmDrafts: ReadonlyArray<string>;
  /** Their latest post once loaded, null when they have none. */
  readonly post: XPost | null | undefined;
  readonly reply: string;
  readonly replied: boolean;
  readonly replyBusy: "load" | "draft" | "send" | null;
  readonly replyError: string | null;
  readonly replyTone: ReplyTone | null;
  readonly replyDrafts: ReadonlyArray<string>;
}

type OutreachPatch = (change: Partial<Outreach>) => void;

const idle: Outreach = {
  dm: "",
  dmSent: false,
  dmBusy: null,
  dmError: null,
  dmTone: null,
  dmDrafts: [],
  post: undefined,
  reply: "",
  replied: false,
  replyBusy: null,
  replyError: null,
  replyTone: null,
  replyDrafts: [],
};

/** Everyone the screens have found, as a table by stage or a board of stages, with the selected person beside. */
export function PeopleSection() {
  const people = useAtomValue(peopleAtom(null));
  const [stage, setStage] = useState<StageFilter>("all");
  const [view, setView] = useState<View>("table");
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
          all.length === 0 || view === "stages" ? undefined : (
            <HeaderTabs label="Stage" tabs={tabs} value={stage} onChange={setStage} />
          )
        }
        actions={
          all.length === 0 ? undefined : (
            <div role="group" aria-label="View" className="flex items-center gap-1">
              {(["table", "stages"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  className={cn(pill, "aria-pressed:border-foreground")}
                  onClick={() => setView(v)}
                >
                  {v === "table" ? "Table" : "Stages"}
                </button>
              ))}
            </div>
          )
        }
      />
      <PeopleSplit
        listId={null}
        stage={view === "stages" ? "all" : stage}
        board={view === "stages"}
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
  board = false,
  aside = null,
  onPick,
  onClose,
  empty,
}: {
  readonly listId: number | null;
  readonly stage?: StageFilter;
  /** Stages as columns instead of the table; a card dragged to a column moves there. */
  readonly board?: boolean;
  readonly aside?: ReactElement | null;
  readonly onPick?: () => void;
  /** Escape closes the aside; the split hands focus back to what opened it. */
  readonly onClose?: () => void;
  readonly empty: ReactNode;
}) {
  const result = useAtomValue(peopleAtom(listId));
  const refreshList = useAtomRefresh(peopleAtom(listId));
  const all = AsyncResult.getOrElse(result, () => []);
  const people = stage === "all" ? all : all.filter((p) => p.stage === stage);
  const { selected, select } = useSelection(people.map((p) => p.id));
  const current = people.find((p) => p.id === selected) ?? null;
  // Kept here, not in the panel: picking someone else remounts it, and a paid result still in
  // flight lands on the person it was for.
  const outreach = useWorkBy<number, Outreach>(idle);

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
        onClose={aside === null ? undefined : onClose}
        list={
          people.length === 0 ? (
            empty
          ) : board ? (
            <StagesBoard
              people={people}
              selected={aside === null ? selected : null}
              onSelect={(id) => {
                select(id);
                onPick?.();
              }}
              onMoved={refreshList}
            />
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
            <PersonPanel
              key={current.id}
              listed={current}
              listId={listId}
              work={outreach.get(current.id)}
              patch={outreach.patch(current.id)}
            />
          )
        }
      />
    ),
  });
}

/** People as stage columns. Drop a card on a column to move them; the toast undoes it. */
function StagesBoard({
  people,
  selected,
  onSelect,
  onMoved,
}: {
  readonly people: ReadonlyArray<Person>;
  readonly selected: number | null;
  readonly onSelect: (id: number) => void;
  readonly onMoved: () => void;
}) {
  const update = useAtomSet(updatePersonAtom, { mode: "promise" });
  const setToast = useAtomSet(toastAtom);
  const [over, setOver] = useState<Stage | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const move = (person: Person, stage: Stage) => {
    if (person.stage === stage) return;
    void update({ id: person.id, stage })
      .then(() => {
        onMoved();
        setToast({
          text: `@${person.handle} moved to ${stage}`,
          undo: () => update({ id: person.id, stage: person.stage }).then(onMoved),
        });
      })
      .catch((e: unknown) => setToast({ text: e instanceof Error ? e.message : String(e) }));
  };

  return (
    <div className="grid grid-cols-2 gap-4 px-6 py-5 @3xl:grid-cols-5">
      {STAGES.map((stage) => {
        const cards = people.filter((p) => p.stage === stage);
        return (
          <section
            key={stage}
            aria-label={stage}
            data-over={over === stage || undefined}
            className={cn(
              "flex min-h-40 flex-col gap-2 rounded-2xl border border-border bg-card p-3 transition-colors duration-150",
              dragging !== null && "border-white/15",
              over === stage && "border-white/40",
            )}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(PERSON_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== stage) setOver(stage);
            }}
            onDragLeave={() => setOver((o) => (o === stage ? null : o))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const id = Number(event.dataTransfer.getData(PERSON_TYPE));
              const person = people.find((p) => p.id === id);
              if (person !== undefined) move(person, stage);
            }}
          >
            <h3 className="flex items-baseline gap-2 px-1 text-xs font-semibold text-muted-foreground">
              {stage}
              <span className="font-mono text-2xs font-normal tabular-nums">{cards.length}</span>
            </h3>
            {cards.map((p) => (
              <button
                key={p.id}
                type="button"
                draggable
                aria-pressed={p.id === selected}
                className={cn(
                  "flex cursor-grab flex-col gap-1 rounded-xl border border-border bg-background px-3 py-2 text-left outline-hidden transition-[border-color,opacity] duration-150 hover:border-white/15 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing aria-pressed:border-white/40",
                  dragging === p.id && "opacity-40",
                )}
                onClick={() => onSelect(p.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(PERSON_TYPE, String(p.id));
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(p.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <span className="truncate text-[13px] font-medium">@{p.handle}</span>
                <span className="truncate text-xs text-muted-foreground">{p.name}</span>
                {/* Each figure wraps as a whole, so a narrow column never pairs "score" with the follower count. */}
                <span className="flex flex-wrap gap-x-2 font-mono text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {p.score === null ? null : <span>score {p.score}</span>}
                  <span>{fmt(p.followers)} followers</span>
                  <span>{ago(p.lastActivity)}</span>
                </span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One person: who they are, their stage and notes, a DM, a reply to their
 * latest post and what happened so far. The row they were picked from shows
 * at once; the full record (activity) follows.
 */
function PersonPanel({
  listed,
  listId,
  work,
  patch,
}: {
  readonly listed: Person;
  readonly listId: number | null;
  readonly work: Outreach;
  readonly patch: OutreachPatch;
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
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Stage">
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === person.stage}
              disabled={edit.busy}
              className={cn(
                pill,
                "text-muted-foreground aria-pressed:border-foreground aria-pressed:text-foreground",
              )}
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
              person.score === null ? (
                "–"
              ) : (
                <>
                  {person.score} <TierText tier={person.tier} />
                </>
              ),
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
      <DirectMessage person={person} work={work} patch={patch} onSent={refreshBoth} />
      <Reply id={id} handle={person.handle} work={work} patch={patch} onSent={refreshBoth} />
      <Section title="Activity">
        {loaded === null ? (
          AsyncResult.isFailure(data) ? (
            <p className="text-xs text-error-foreground">{errorText(data.cause)}</p>
          ) : (
            <p className="text-[13px] text-muted-foreground">Loading…</p>
          )
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

/**
 * A DM through the user's own session while that lane is on, else the X connection. The service
 * needs their user id: known, or seen on a post the session saw, is free; else it reads the
 * profile first, priced in.
 */
function DirectMessage({
  person,
  work,
  patch,
  onSent,
}: {
  readonly person: Person;
  readonly work: Outreach;
  readonly patch: OutreachPatch;
  readonly onSent: () => void;
}) {
  const rates = useRates();
  const draftDm = useAtomSet(draftDmAtom(person.id), { mode: "promiseExit" });
  const sendDm = useAtomSet(sendDmAtom(person.id), { mode: "promiseExit" });
  const { dm, dmSent, dmBusy, dmError, dmTone, dmDrafts } = work;
  // The drafts read only what the session saw them post, then one model call.
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const viaSession = useSessionLane();
  const seen = useAtomValue(seenByAtom(person.handle));
  const lookup =
    person.userId === null &&
    AsyncResult.getOrElse(
      AsyncResult.map(seen, ({ posts }) => posts.length === 0),
      () => true,
    );
  const sendUsd =
    rates === null ? null : (viaSession ? 0 : rates.dm) + (lookup ? rates.scraperProfile : 0);

  const onSend = async () => {
    patch({ dmBusy: "send", dmError: null });
    const exit = await sendDm(dm);
    if (Exit.isFailure(exit)) return patch({ dmBusy: null, dmError: errorText(exit.cause) });
    patch({ dmBusy: null, dm: "", dmSent: true });
    onSent();
  };
  const onTone = async (next: ReplyTone | null) => {
    patch({ dmTone: next, dmDrafts: [] });
    if (next === null) return;
    patch({ dmBusy: "draft", dmError: null });
    const exit = await draftDm(next);
    patch(
      Exit.isFailure(exit)
        ? { dmBusy: null, dmError: errorText(exit.cause) }
        : { dmBusy: null, dmDrafts: exit.value, dm: exit.value[0] ?? dm, dmSent: false },
    );
  };
  return (
    <Section title="Direct message" aside={<Cost label={`3 drafts · ${assistQuote}`} />}>
      <div className="mb-2 flex flex-col gap-2">
        <ToneRow
          tone={dmTone}
          busy={dmBusy === "draft" ? dmTone : undefined}
          disabled={dmBusy !== null}
          assistDisabled={assistQuote === "…"}
          onTone={(next) => void onTone(next)}
        />
        <Candidates
          drafts={dmDrafts}
          picked={dm}
          onPick={(text) => patch({ dm: text, dmSent: false })}
        />
      </div>
      <textarea
        className={cn(inputClass, "min-h-20 resize-y leading-relaxed")}
        aria-label="DM text"
        placeholder={dmTone === null ? "Write a DM" : "Pick a draft above, or edit it here"}
        value={dm}
        // Locked while sending: success clears the box, which would take text typed meanwhile.
        disabled={dmBusy === "send"}
        onChange={(e) => patch({ dm: e.target.value, dmSent: false })}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={pillSolid}
          disabled={dmBusy !== null || dm.trim() === "" || sendUsd === null}
          onClick={() => void onSend()}
        >
          <TextMorph duration={250}>
            {dmBusy === "send" ? "Sending…" : dmSent ? "Sent" : "Send DM"}
          </TextMorph>
          {viaSession && sendUsd === 0 ? (
            <Cost tone="solid" label="free · your session" />
          ) : sendUsd === null ? (
            <Cost tone="solid" label="…" />
          ) : (
            <Cost tone="solid" usd={sendUsd} />
          )}
        </button>
      </div>
      {dmError !== null ? <p className="mt-2 text-xs text-error-foreground">{dmError}</p> : null}
    </Section>
  );
}

/**
 * Their latest post, drafts, and a reply. The post is what the session saw them post, free and
 * already there; X is read only when the user asks for a fresher one, priced on the button.
 */
function Reply({
  id,
  handle,
  work,
  patch,
  onSent,
}: {
  readonly id: number;
  readonly handle: string;
  readonly work: Outreach;
  readonly patch: OutreachPatch;
  readonly onSent: () => void;
}) {
  const loadPost = useAtomSet(latestPostAtom(id), { mode: "promiseExit" });
  const draft = useAtomSet(draftReplyAtom(id), { mode: "promiseExit" });
  const send = useAtomSet(sendReplyAtom(id), { mode: "promiseExit" });
  const { reply, replied, replyBusy, replyError, replyTone, replyDrafts } = work;
  const busy = replyBusy !== null;
  const seen = useAtomValue(seenByAtom(handle));
  // A repost is someone else's post wearing this handle; a reply of theirs beats it.
  const seenLatest = AsyncResult.getOrElse(
    AsyncResult.map(seen, ({ posts }) => {
      const own = posts.filter((p) => !p.isRepost).map(observedToXPost);
      return own.find((p) => !p.isReply) ?? own[0];
    }),
    () => undefined,
  );
  const post = work.post === undefined ? seenLatest : work.post;
  const postQuote = useQuoteLabel({ kind: "userPosts", handle });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  // Priced here from the rate card: a quote rpc per keystroke would flash "…" on the button.
  const viaSession = useSessionLane();
  const rates = useRates();

  const load = async () => {
    patch({ replyBusy: "load", replyError: null });
    const exit = await loadPost();
    if (Exit.isFailure(exit)) return patch({ replyBusy: null, replyError: errorText(exit.cause) });
    // A reply written for one post must not go to another: a new post starts a new reply.
    patch(
      exit.value?.postId === post?.postId
        ? { replyBusy: null, post: exit.value }
        : { replyBusy: null, post: exit.value, reply: "", replied: false, replyDrafts: [] },
    );
  };
  const onTone = async (next: ReplyTone | null, to: XPost) => {
    patch({ replyTone: next, replyDrafts: [] });
    if (next === null) return;
    patch({ replyBusy: "draft", replyError: null });
    const exit = await draft({ post: to, tone: next });
    patch(
      Exit.isFailure(exit)
        ? { replyBusy: null, replyError: errorText(exit.cause) }
        : {
            replyBusy: null,
            replyDrafts: exit.value.drafts,
            reply: exit.value.drafts[0] ?? reply,
            replied: false,
          },
    );
  };
  const onSend = async (to: XPost) => {
    patch({ replyBusy: "send", replyError: null });
    const exit = await send({ postId: to.postId, text: reply });
    if (Exit.isFailure(exit)) return patch({ replyBusy: null, replyError: errorText(exit.cause) });
    patch({ replyBusy: null, reply: "", replied: true });
    onSent();
  };
  return (
    <Section
      title="Reply to their latest post"
      aside={
        post === undefined ? undefined : (
          <button
            type="button"
            className="flex cursor-pointer items-baseline gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
            disabled={busy || postQuote === "…"}
            onClick={() => void load()}
          >
            From X
            <Cost label={postQuote} />
          </button>
        )
      }
    >
      {post === undefined ? (
        <button
          type="button"
          className={pill}
          disabled={busy || postQuote === "…"}
          onClick={() => void load()}
        >
          <TextMorph duration={250}>
            {replyBusy === "load" ? "Loading…" : "Load their latest post from X"}
          </TextMorph>
          <Cost label={postQuote} />
        </button>
      ) : post === null ? (
        <p className="text-[13px] text-muted-foreground">No recent post found.</p>
      ) : (
        <>
          <p className="line-clamp-4 border-l border-white/13 pl-3 text-[13px] leading-relaxed text-foreground/80">
            {post.text}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <ToneRow
              tone={replyTone}
              busy={replyBusy === "draft" ? replyTone : undefined}
              disabled={busy}
              assistDisabled={assistQuote === "…"}
              cost={<Cost label={`3 drafts · ${assistQuote}`} />}
              onTone={(next) => void onTone(next, post)}
            />
            <Candidates
              drafts={replyDrafts}
              picked={reply}
              onPick={(text) => patch({ reply: text, replied: false })}
            />
          </div>
          <textarea
            className={cn(inputClass, "mt-3 min-h-20 resize-y leading-relaxed")}
            placeholder={
              replyTone === null ? "Write a reply" : "Pick a draft above, or edit it here"
            }
            value={reply}
            maxLength={280}
            // Locked while sending: success clears the box, which would take text typed meanwhile.
            disabled={replyBusy === "send"}
            onChange={(e) => patch({ reply: e.target.value, replied: false })}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={pillSolid}
              disabled={busy || reply.trim() === "" || rates === null}
              onClick={() => void onSend(post)}
            >
              <TextMorph duration={250}>{replied ? "Replied" : "Reply"}</TextMorph>
              {viaSession ? (
                <Cost tone="solid" label="free · your session" />
              ) : rates === null ? (
                <Cost tone="solid" label="…" />
              ) : (
                <Cost tone="solid" usd={postCostUsd(rates, reply)} />
              )}
            </button>
          </div>
        </>
      )}
      {replyError !== null ? (
        <p className="mt-2 text-xs text-error-foreground">{replyError}</p>
      ) : null}
    </Section>
  );
}
