import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  postCostUsd,
  type Person,
  type PeoplePage,
  type Stage,
  type XPost,
} from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactElement, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { PERSON_TYPE } from "../../lib/drag";
import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { useQuoteLabel, useRates } from "../../state/costs";
import {
  draftDmAtom,
  draftReplyAtom,
  latestPostAtom,
  peopleAtom,
  peopleQueryAtom,
  listRemovePersonAtom,
  listsAtom,
  personAtom,
  personProfileAtom,
  sendDmAtom,
  sendReplyAtom,
  updatePersonAtom,
} from "../../state/leads";
import { errorText, fmt } from "../analyze/ui";
import { useWorkBy } from "../engage/ReplyBox";
import { ago, ErrorLine, pill, pillSolid } from "../engage/triage";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { inputClass } from "../ui/field";
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

type View = "table" | "stages";

/** What the user did for one person here: the DM and reply drafts, their latest post, what went out. */
interface Outreach {
  readonly dm: string;
  readonly dmSent: boolean;
  readonly dmBusy: "draft" | "send" | null;
  readonly dmError: string | null;
  /** Their latest post once loaded, null when they have none. */
  readonly post: XPost | null | undefined;
  readonly reply: string;
  readonly replied: boolean;
  readonly replyBusy: "load" | "draft" | "send" | null;
  readonly replyError: string | null;
}

type OutreachPatch = (change: Partial<Outreach>) => void;

const idle: Outreach = {
  dm: "",
  dmSent: false,
  dmBusy: null,
  dmError: null,
  post: undefined,
  reply: "",
  replied: false,
  replyBusy: null,
  replyError: null,
};

/** Everyone the screens have found, as a table by stage or a board of stages, with the selected person beside. */
export function PeopleSection() {
  const people = useAtomValue(peopleAtom(null));
  const query = useAtomValue(peopleQueryAtom(null));
  const setQuery = useAtomSet(peopleQueryAtom(null));
  const stage = query.stage ?? "all";
  const [view, setView] = useState<View>("table");
  const page = AsyncResult.getOrElse(people, () => null);
  const tabs = [
    {
      id: "all" as const,
      label: "All",
      count: page === null ? 0 : Object.values(page.counts).reduce((sum, n) => sum + n, 0),
    },
    ...STAGES.map((s) => ({
      id: s,
      label: s[0]!.toUpperCase() + s.slice(1),
      count: page?.counts[s] ?? 0,
    })),
  ];
  return (
    <>
      <PageHeader
        title="People"
        tabs={
          view === "stages" ? undefined : (
            <HeaderTabs
              label="Stage"
              tabs={tabs}
              value={stage}
              onChange={(stage) =>
                setQuery({ ...query, stage: stage === "all" ? undefined : stage, offset: 0 })
              }
            />
          )
        }
        actions={
          <div role="group" aria-label="View" className="flex items-center gap-1">
            {(["table", "stages"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={cn(pill, "aria-pressed:border-foreground")}
                onClick={() => {
                  setView(v);
                  if (v === "stages") setQuery({ ...query, stage: undefined, offset: 0 });
                }}
              >
                {v === "table" ? "Table" : "Stages"}
              </button>
            ))}
          </div>
        }
      />
      <PeopleSplit
        listId={null}
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
  board = false,
  aside = null,
  onPick,
  onClose,
  empty,
}: {
  readonly listId: number | null;
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
  const query = useAtomValue(peopleQueryAtom(listId));
  const setQuery = useAtomSet(peopleQueryAtom(listId));
  const page = AsyncResult.getOrElse(result, () => null);
  const people = page?.people ?? [];
  const { selected, select } = useSelection(people.map((p) => p.id));
  const current = people.find((p) => p.id === selected) ?? null;
  // Kept here, not in the panel: picking someone else remounts it, and a paid result still in
  // flight lands on the person it was for.
  const outreach = useWorkBy<number, Outreach>(idle);

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-6 py-2">
        <input
          className={cn(inputClass, "h-8 max-w-64")}
          aria-label="Search people"
          placeholder="Search people"
          value={query.search ?? ""}
          maxLength={200}
          onChange={(e) => setQuery({ ...query, search: e.target.value, offset: 0 })}
        />
      </div>
      {AsyncResult.match(result, {
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
              <>
                {people.length === 0 ? (
                  query.search ? (
                    <Empty>No matching people.</Empty>
                  ) : (
                    empty
                  )
                ) : board ? (
                  <StagesBoard
                    people={people}
                    counts={page!.counts}
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
                )}
                <PeoplePager
                  total={page!.total}
                  offset={page!.offset}
                  onPage={(offset) => setQuery({ ...query, offset })}
                />
              </>
            }
            detail={
              aside !== null ? (
                aside
              ) : current === null ? null : (
                <PersonPanel
                  key={current.id}
                  listed={current}
                  listId={listId}
                  onChanged={refreshList}
                  work={outreach.get(current.id)}
                  patch={outreach.patch(current.id)}
                />
              )
            }
          />
        ),
      })}
    </>
  );
}

export function PeoplePager({
  total,
  disabled = false,
  offset,
  onPage,
}: {
  readonly total: number;
  readonly disabled?: boolean;
  readonly offset: number;
  readonly onPage: (offset: number) => void;
}) {
  return (
    <nav
      aria-label="People pages"
      className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background px-6 py-2 text-xs"
    >
      <span className="mr-auto font-mono tabular-nums">
        {total === 0 ? 0 : offset + 1}-{Math.min(offset + 50, total)} of {total}
      </span>
      <button
        type="button"
        className={pill}
        disabled={disabled || offset === 0}
        onClick={() => onPage(Math.max(0, offset - 50))}
      >
        Previous
      </button>
      <button
        type="button"
        className={pill}
        disabled={disabled || offset + 50 >= total}
        onClick={() => onPage(offset + 50)}
      >
        Next
      </button>
    </nav>
  );
}

/** People as stage columns. Drop a card on a column to move them; the toast undoes it. */
function StagesBoard({
  people,
  counts,
  selected,
  onSelect,
  onMoved,
}: {
  readonly people: ReadonlyArray<Person>;
  readonly counts: PeoplePage["counts"];
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
              <span className="font-mono text-2xs font-normal tabular-nums">{counts[stage]}</span>
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
  onChanged,
  work,
  patch,
}: {
  readonly listed: Person;
  readonly listId: number | null;
  readonly onChanged: () => void;
  readonly work: Outreach;
  readonly patch: OutreachPatch;
}) {
  const { id } = listed;
  const rates = useRates();
  const data = useAtomValue(personAtom(id));
  const refresh = useAtomRefresh(personAtom(id));
  const update = useAtomSet(updatePersonAtom, { mode: "promise" });
  const fetchProfile = useAtomSet(personProfileAtom, { mode: "promise" });
  const remove = useAtomSet(listRemovePersonAtom, { mode: "promise" });
  const refreshLists = useAtomRefresh(listsAtom);
  const membership = useAction();
  const profile = useAction();
  const edit = useAction();
  const [notes, setNotes] = useState<string | null>(null);
  const loaded = AsyncResult.getOrElse(data, () => null);
  const person = loaded?.person ?? listed;
  const refreshBoth = () => {
    refresh();
    onChanged();
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
          {listId === null ? null : (
            <button
              type="button"
              className={pill}
              disabled={membership.busy}
              onClick={() =>
                void membership.run(() =>
                  remove({ listId, personId: id }).then(() => {
                    onChanged();
                    refreshLists();
                  }),
                )
              }
            >
              Remove from list
              <Cost label="free" />
            </button>
          )}
        </div>
        {membership.error === null ? null : (
          <p role="alert" className="mt-2 text-xs text-error-foreground">
            {membership.error}
          </p>
        )}
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

/** A DM through the X connection. Without their user id the service reads the profile first, priced in. */
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
  const { dm, dmSent, dmBusy, dmError } = work;
  // The draft reads their recent posts first, then one model call.
  const postsQuote = useQuoteLabel({ kind: "userPosts", handle: person.handle });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const sendUsd =
    rates === null ? null : rates.dm + (person.userId === null ? rates.scraperProfile : 0);

  const onSend = async () => {
    patch({ dmBusy: "send", dmError: null });
    const exit = await sendDm(dm);
    if (Exit.isFailure(exit)) return patch({ dmBusy: null, dmError: errorText(exit.cause) });
    patch({ dmBusy: null, dm: "", dmSent: true });
    onSent();
  };
  const onDraft = async () => {
    patch({ dmBusy: "draft", dmError: null });
    const exit = await draftDm();
    patch(
      Exit.isFailure(exit)
        ? { dmBusy: null, dmError: errorText(exit.cause) }
        : { dmBusy: null, dm: exit.value, dmSent: false },
    );
  };

  return (
    <Section title="Direct message">
      <textarea
        className={cn(inputClass, "min-h-20 resize-y leading-relaxed")}
        placeholder="Write a DM, or draft one"
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
          {sendUsd === null ? <Cost tone="solid" label="…" /> : <Cost tone="solid" usd={sendUsd} />}
        </button>
        <button
          type="button"
          className={pill}
          disabled={dmBusy !== null || postsQuote === "…" || assistQuote === "…"}
          onClick={() => void onDraft()}
        >
          <TextMorph duration={250}>{dmBusy === "draft" ? "Drafting…" : "Draft with AI"}</TextMorph>
          <Cost label={`${postsQuote} + ${assistQuote}`} />
        </button>
      </div>
      {dmError !== null ? <p className="mt-2 text-xs text-error-foreground">{dmError}</p> : null}
    </Section>
  );
}

/** Their latest post, an AI draft, and a reply through the X connection; every paid step is priced on its button. */
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
  const { post, reply, replied, replyBusy, replyError } = work;
  const busy = replyBusy !== null;
  const postQuote = useQuoteLabel({ kind: "userPosts", handle });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  // Priced here from the rate card: a quote rpc per keystroke would flash "…" on the button.
  const rates = useRates();

  const load = async () => {
    patch({ replyBusy: "load", replyError: null });
    const exit = await loadPost();
    if (Exit.isFailure(exit)) return patch({ replyBusy: null, replyError: errorText(exit.cause) });
    // A reply written for one post must not go to another: a new post starts a new reply.
    patch(
      exit.value?.postId === post?.postId
        ? { replyBusy: null, post: exit.value }
        : { replyBusy: null, post: exit.value, reply: "", replied: false },
    );
  };
  const onDraft = async () => {
    patch({ replyBusy: "draft", replyError: null });
    const exit = await draft();
    if (Exit.isFailure(exit)) return patch({ replyBusy: null, replyError: errorText(exit.cause) });
    patch({ replyBusy: null, post: exit.value.post, reply: exit.value.text, replied: false });
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
            Load again
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
            {replyBusy === "load" ? "Loading…" : "Load their latest post"}
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
          <textarea
            className={cn(inputClass, "mt-3 min-h-20 resize-y leading-relaxed")}
            placeholder="Write a reply, or draft one"
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
              {rates === null ? (
                <Cost tone="solid" label="…" />
              ) : (
                <Cost tone="solid" usd={postCostUsd(rates, reply)} />
              )}
            </button>
            <button
              type="button"
              className={pill}
              disabled={busy || postQuote === "…" || assistQuote === "…"}
              onClick={() => void onDraft()}
            >
              Draft with AI
              {/* The draft reads their latest post again, then one model call. */}
              <Cost label={`${postQuote} + ${assistQuote}`} />
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
