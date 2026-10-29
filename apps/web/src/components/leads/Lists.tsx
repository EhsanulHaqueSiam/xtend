import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Candidate, EngagementVia, LeadList } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { cn, parsePostId } from "../../lib/utils";
import { useRates, usd } from "../../state/costs";
import {
  createListAtom,
  engagersAtom,
  engagersQuoteAtom,
  listAddAllAtom,
  listPreviewAtom,
  listsAtom,
  listPeopleAtom,
  listPeopleQueryAtom,
  listAddPeopleAtom,
  peopleAtom,
} from "../../state/leads";
import { errorText, fmt } from "../analyze/ui";
import { ErrorLine, pill, pillSolid } from "../engage/triage";
import { PageHeader } from "../PageHeader";
import { Field, inputClass } from "../ui/field";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import { Popover } from "../ui/popover";
import { xIconButton } from "../x";
import { PeoplePager, PeopleSplit } from "./People";
import { useAction } from "./ui";

type Builder = "search" | "engagement" | "people";

/** One list's people, a switcher for the others in the header, and the builders that fill it. */
export function ListsSection() {
  const result = useAtomValue(listsAtom);
  const lists = AsyncResult.getOrElse(result, () => []);
  const [picked, setPicked] = useState<number | null>(null);
  const [builder, setBuilder] = useState<Builder | null>(null);
  const current = lists.find((l) => l.id === picked) ?? lists[0] ?? null;

  return (
    <>
      <PageHeader
        title="Lists"
        tabs={
          current === null ? undefined : (
            <ListSwitcher
              lists={lists}
              current={current}
              onPick={(id) => {
                setPicked(id);
                setBuilder(null);
              }}
            />
          )
        }
        actions={
          current === null ? undefined : (
            <button
              type="button"
              className={cn(pill, "aria-pressed:bg-white/[0.06]")}
              aria-pressed={builder !== null}
              onClick={() => setBuilder((b) => (b === null ? "search" : null))}
            >
              Add people
            </button>
          )
        }
      />
      {AsyncResult.match(result, {
        onInitial: () => (
          <PageBody>
            <Empty>Loading lists…</Empty>
          </PageBody>
        ),
        onFailure: (f) => (
          <PageBody>
            <ErrorLine>{errorText(f.cause)}</ErrorLine>
          </PageBody>
        ),
        onSuccess: () =>
          current === null ? (
            <PageBody>
              <Empty action={<NewList onCreated={setPicked} />}>
                No lists yet. Name one, then fill it from People, a search or a post's engagement.
              </Empty>
            </PageBody>
          ) : (
            <PeopleSplit
              key={current.id}
              listId={current.id}
              aside={
                builder === null ? null : (
                  <BuilderPanel
                    listId={current.id}
                    listName={current.name}
                    mode={builder}
                    onMode={setBuilder}
                    onClose={() => setBuilder(null)}
                  />
                )
              }
              onPick={() => setBuilder(null)}
              onClose={() => setBuilder(null)}
              empty={
                <Empty
                  action={
                    builder === null ? (
                      <button type="button" className={pill} onClick={() => setBuilder("search")}>
                        Add people
                      </button>
                    ) : undefined
                  }
                >
                  No one in {current.name} yet.
                </Empty>
              }
            />
          ),
      })}
    </>
  );
}

/** The open list's name in the header; its popover lists the others and makes new ones. */
function ListSwitcher({
  lists,
  current,
  onPick,
}: {
  readonly lists: ReadonlyArray<LeadList>;
  readonly current: LeadList;
  readonly onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-64 p-1"
      trigger={
        <button
          type="button"
          className="no-drag flex min-w-0 cursor-pointer items-baseline gap-1.5 rounded-[var(--control-radius)] text-[13.5px] text-foreground outline-hidden transition-colors duration-150 hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{current.name}</span>
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            {current.members}
          </span>
          <ChevronDown className="size-3.5 self-center text-muted-foreground" />
        </button>
      }
    >
      <div className="max-h-72 overflow-y-auto">
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            data-active={l.id === current.id}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[calc(var(--radius)-4px)] px-2 py-1.5 text-left text-sm text-muted-foreground outline-hidden hover:bg-white/7 hover:text-foreground focus-visible:bg-white/7 data-[active=true]:text-foreground"
            onClick={() => {
              onPick(l.id);
              setOpen(false);
            }}
          >
            <span className="truncate">{l.name}</span>
            <span className="ml-auto font-mono text-2xs text-muted-foreground tabular-nums">
              {l.members}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1 border-t border-border p-1 pt-2">
        <NewList
          onCreated={(id) => {
            onPick(id);
            setOpen(false);
          }}
        />
      </div>
    </Popover>
  );
}

/** A name and Enter: lists are free, only filling them costs. */
function NewList({ onCreated }: { readonly onCreated: (id: number) => void }) {
  const refresh = useAtomRefresh(listsAtom);
  const create = useAtomSet(createListAtom, { mode: "promise" });
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="flex w-full max-w-72 flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() === "") return;
        void run(() =>
          create(name.trim()).then((l) => {
            setName("");
            refresh();
            onCreated(l.id);
          }),
        );
      }}
    >
      <div className="flex gap-1.5">
        <input
          className={cn(inputClass, "h-7 flex-1 py-0")}
          placeholder="New list"
          aria-label="New list name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className={pill} disabled={busy || name.trim() === ""}>
          Create
        </button>
      </div>
      {error !== null ? <p className="text-xs text-error-foreground">{error}</p> : null}
    </form>
  );
}

/** The detail column while adding people: a search, or who engaged with one post. */
function BuilderPanel({
  listId,
  listName,
  mode,
  onMode,
  onClose,
}: {
  readonly listId: number;
  readonly listName: string;
  readonly mode: Builder;
  readonly onMode: (mode: Builder) => void;
  readonly onClose: () => void;
}) {
  const modes = [
    { id: "search", label: "From a search" },
    { id: "engagement", label: "From a post" },
    { id: "people", label: "From people" },
  ] as const;
  return (
    <div className={mode === "people" ? "flex h-full flex-col" : undefined}>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <div
          className="flex min-w-0 flex-1 items-center gap-3"
          role="group"
          aria-label="Add people"
        >
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === mode}
              className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground"
              onClick={() => onMode(m.id)}
            >
              {m.label}
              {m.id === "people" ? <Cost label="free" /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={cn(xIconButton, "-mr-2")}
          aria-label="Close"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {mode === "search" ? (
        <SearchBuilder key="search" listId={listId} />
      ) : mode === "people" ? (
        <PeopleBuilder listId={listId} listName={listName} />
      ) : (
        <EngagementBuilder key="engagement" listId={listId} />
      )}
    </div>
  );
}

/** Pick up to a page of existing people; membership changes never call X. */
function PeopleBuilder({
  listId,
  listName,
}: {
  readonly listId: number;
  readonly listName: string;
}) {
  const query = useAtomValue(listPeopleQueryAtom(listId));
  const setQuery = useAtomSet(listPeopleQueryAtom(listId));
  const result = useAtomValue(listPeopleAtom(listId));
  const refresh = useAtomRefresh(listPeopleAtom(listId));
  const refreshMembers = useAtomRefresh(peopleAtom(listId));
  const refreshLists = useAtomRefresh(listsAtom);
  const add = useAtomSet(listAddPeopleAtom, { mode: "promise" });
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [added, setAdded] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 py-3">
        <input
          className={inputClass}
          aria-label="Search existing people"
          placeholder="Search people"
          maxLength={200}
          value={query.search ?? ""}
          disabled={busy}
          onChange={(e) => setQuery({ ...query, search: e.target.value, offset: 0 })}
        />
      </div>
      {AsyncResult.match(result, {
        onInitial: () => <Empty>Loading people…</Empty>,
        onFailure: (f) => <ErrorLine>{errorText(f.cause)}</ErrorLine>,
        onSuccess: ({ value }) => (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="px-6 pb-2 text-xs text-muted-foreground">
              {value.total} not in {listName}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {value.people.length === 0 ? (
                <Empty>No matching people to add.</Empty>
              ) : (
                value.people.map((person) => (
                  <label
                    key={person.id}
                    className="flex cursor-pointer items-center gap-3 border-t border-border px-6 py-2 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select @${person.handle}`}
                      checked={selected.has(person.id)}
                      disabled={busy || (!selected.has(person.id) && selected.size >= 50)}
                      onChange={(e) => {
                        setAdded(null);
                        setSelected((current) => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(person.id);
                          else next.delete(person.id);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      @{person.handle} <span className="text-muted-foreground">{person.stage}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums">{fmt(person.followers)}</span>
                  </label>
                ))
              )}
            </div>
            <PeoplePager
              total={value.total}
              offset={value.offset}
              disabled={busy}
              onPage={(offset) => setQuery({ ...query, offset })}
            />
          </div>
        ),
      })}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <button
          type="button"
          className={pillSolid}
          disabled={busy || selected.size === 0 || !AsyncResult.isSuccess(result)}
          onClick={() =>
            void run(() =>
              add({ listId, personIds: [...selected] }).then(({ added }) => {
                setAdded(added);
                setSelected(new Set());
                refresh();
                refreshMembers();
                refreshLists();
              }),
            )
          }
        >
          Add {selected.size} to {listName}
          <Cost label="free" />
        </button>
        {added === null ? null : (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Added {added}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-2 text-xs text-error-foreground">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

type Found = { readonly matches: ReadonlyArray<Candidate>; readonly costUsd: number };

/** What a builder found, what it cost, and one click to put everyone in the list. */
function Matches({ listId, found }: { readonly listId: number; readonly found: Found }) {
  const addAll = useAtomSet(listAddAllAtom, { mode: "promise" });
  const refreshPeople = useAtomRefresh(peopleAtom(listId));
  const refreshLists = useAtomRefresh(listsAtom);
  const { busy, error, run } = useAction();
  const [added, setAdded] = useState<number | null>(null);
  return (
    <Section
      title={`${found.matches.length} found`}
      aside={
        <>
          <span className="font-mono text-2xs text-muted-foreground">
            spent {usd(found.costUsd)}
          </span>
          <button
            type="button"
            className={pillSolid}
            disabled={busy || found.matches.length === 0 || added !== null}
            onClick={() =>
              void run(() =>
                addAll({ listId, people: found.matches }).then((r) => {
                  setAdded(r.added);
                  refreshPeople();
                  refreshLists();
                }),
              )
            }
          >
            <TextMorph duration={250}>
              {added === null ? "Add all to list" : `Added ${added}`}
            </TextMorph>
          </button>
        </>
      }
    >
      {error !== null ? <p className="mb-2 text-xs text-error-foreground">{error}</p> : null}
      <ul className="max-h-96 overflow-y-auto border-t border-border">
        {found.matches.map((m) => (
          <li key={m.handle} className="border-b border-border py-1.5 text-[13px]">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">@{m.handle}</span>
              <span className="font-mono text-xs tabular-nums">{fmt(m.followers)}</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{m.bio || m.name}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Search criteria, a paid preview, then everyone it matched into the list. */
function SearchBuilder({ listId }: { readonly listId: number }) {
  const rates = useRates();
  const preview = useAtomSet(listPreviewAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [query, setQuery] = useState("");
  const [minFollowers, setMin] = useState("");
  const [bioKeyword, setBio] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A bio keyword needs a profile read per author; the preview quotes the worst case.
  const quote =
    rates === null
      ? "…"
      : bioKeyword.trim() === ""
        ? usd(rates.searchPage)
        : `up to ${usd(rates.searchPage + 50 * rates.scraperProfile)}`;

  return (
    <>
      <Section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Enter submits too: what disables the button stops it here.
            if (busy || query.trim() === "" || rates === null) return;
            void run(() =>
              preview({
                query,
                ...(minFollowers === "" ? {} : { minFollowers: Number(minFollowers) }),
                ...(bioKeyword.trim() === "" ? {} : { bioKeyword }),
              }).then((r) => {
                setFound(r);
                setAttempt((n) => n + 1);
              }),
            );
          }}
        >
          <Field label="Search">
            <input
              className={inputClass}
              placeholder='"typefully alternative"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Field label="Min followers">
            <input
              className={inputClass}
              placeholder="any"
              inputMode="numeric"
              value={minFollowers}
              onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Bio contains">
            <input
              className={inputClass}
              placeholder="anything"
              value={bioKeyword}
              onChange={(e) => setBio(e.target.value)}
            />
          </Field>
          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="submit"
              className={pill}
              disabled={busy || query.trim() === "" || rates === null}
            >
              <TextMorph duration={250}>{busy ? "Searching…" : "Preview"}</TextMorph>
              <Cost label={quote} />
            </button>
          </div>
          {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
        </form>
      </Section>
      {/* A new result starts with its own Add all. */}
      {found !== null ? <Matches key={attempt} listId={listId} found={found} /> : null}
    </>
  );
}

/** Who reposted or liked one post, priced by the service before the fetch, then into the list. */
function EngagementBuilder({ listId }: { readonly listId: number }) {
  const fetchEngagers = useAtomSet(engagersAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [post, setPost] = useState("");
  const [via, setVia] = useState<EngagementVia>("repost");
  const quote = AsyncResult.getOrElse(useAtomValue(engagersQuoteAtom(via)), () => null);
  const [found, setFound] = useState<Found | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Null until it is a post id or a post's URL: a profile URL's digits are not a post.
  const postId = parsePostId(post);
  return (
    <>
      <Section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || postId === null || quote === null) return;
            void run(() =>
              fetchEngagers({ postId, via }).then((r) => {
                setFound(r);
                setAttempt((n) => n + 1);
              }),
            );
          }}
        >
          <Field label="Post">
            <input
              className={inputClass}
              placeholder="Post URL or id"
              value={post}
              onChange={(e) => setPost(e.target.value)}
            />
          </Field>
          <Field label="Who">
            <select
              className={cn(inputClass, "bg-background")}
              value={via}
              onChange={(e) => setVia(e.target.value === "like" ? "like" : "repost")}
            >
              <option value="repost">reposted it (scraper)</option>
              <option value="like">liked it (X API, first 20)</option>
            </select>
          </Field>
          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="submit"
              className={pill}
              disabled={busy || postId === null || quote === null}
            >
              <TextMorph duration={250}>{busy ? "Fetching…" : "Fetch"}</TextMorph>
              {quote === null ? <Cost label="…" /> : <Cost usd={quote} />}
            </button>
          </div>
          {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
        </form>
      </Section>
      {/* A new result starts with its own Add all. */}
      {found !== null ? <Matches key={attempt} listId={listId} found={found} /> : null}
    </>
  );
}
