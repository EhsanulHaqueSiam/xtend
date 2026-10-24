import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Candidate, EngagementVia, LeadList } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Fragment, useState } from "react";

import { cn, parsePostId } from "../../lib/utils";
import {
  createListAtom,
  engagersAtom,
  engagersQuoteAtom,
  listAddAllAtom,
  listPreviewAtom,
  listsAtom,
  peopleAtom,
} from "../../state/leads";
import { useRates, usd } from "../../state/costs";
import { Empty, ErrorText, errorText, fmt, inputClass, Section } from "../analyze/ui";
import { Button } from "../ui/button";
import { People } from "./People";
import { useAction } from "./ui";

/** Lists on the left, the selected list's people on the right, with a search builder to fill it. */
export function Lists() {
  const lists = useAtomValue(listsAtom);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="flex gap-3">
      <div className="flex w-56 shrink-0 flex-col gap-2">
        {AsyncResult.match(lists, {
          onInitial: () => <Empty>Loading lists…</Empty>,
          onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
          onSuccess: ({ value }) => (
            <ListPicker lists={value} selected={selected} onSelect={setSelected} />
          ),
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {selected === null ? (
          <Empty>Pick a list, or create one.</Empty>
        ) : (
          // Keyed: a preview fetched for one list must not be added to the next one picked.
          <Fragment key={selected}>
            <Builder listId={selected} />
            <EngagementBuilder listId={selected} />
            <People listId={selected} />
          </Fragment>
        )}
      </div>
    </div>
  );
}

function ListPicker({
  lists,
  selected,
  onSelect,
}: {
  readonly lists: ReadonlyArray<LeadList>;
  readonly selected: number | null;
  readonly onSelect: (id: number) => void;
}) {
  const refresh = useAtomRefresh(listsAtom);
  const create = useAtomSet(createListAtom, { mode: "promise" });
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();
  const submit = () =>
    run(() =>
      create(name.trim()).then((l) => {
        setName("");
        refresh();
        onSelect(l.id);
      }),
    );
  return (
    <>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() !== "") void submit();
        }}
      >
        <input
          className={inputClass}
          placeholder="New list"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="xs" variant="outline" type="submit" disabled={busy || name.trim() === ""}>
          Add
        </Button>
      </form>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {lists.length === 0 ? <Empty>No lists yet.</Empty> : null}
      {lists.map((l) => (
        <button
          key={l.id}
          type="button"
          className={cn(
            "flex cursor-pointer items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent/60",
            l.id === selected && "bg-accent",
          )}
          onClick={() => onSelect(l.id)}
        >
          <span className="truncate">{l.name}</span>
          <span className="font-mono text-2xs text-muted-foreground">{l.members}</span>
        </button>
      ))}
    </>
  );
}

/** Search criteria, a paid preview, then one click to add every match to the list. */
function Builder({ listId }: { readonly listId: number }) {
  const rates = useRates();
  const preview = useAtomSet(listPreviewAtom, { mode: "promise" });
  const addAll = useAtomSet(listAddAllAtom, { mode: "promise" });
  const refreshPeople = useAtomRefresh(peopleAtom(listId));
  const refreshLists = useAtomRefresh(listsAtom);
  const { busy, error, run } = useAction();
  const [query, setQuery] = useState("");
  const [minFollowers, setMin] = useState("");
  const [bioKeyword, setBio] = useState("");
  const [result, setResult] = useState<{
    readonly matches: ReadonlyArray<Candidate>;
    readonly costUsd: number;
  } | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  // A bio keyword needs a profile read per author; the preview quotes the worst case.
  const quote =
    rates === null
      ? "…"
      : bioKeyword.trim() === ""
        ? usd(rates.searchPage)
        : `up to ${usd(rates.searchPage + 50 * rates.scraperProfile)}`;

  const runPreview = () =>
    run(() =>
      preview({
        query,
        ...(minFollowers === "" ? {} : { minFollowers: Number(minFollowers) }),
        ...(bioKeyword.trim() === "" ? {} : { bioKeyword }),
      }).then((r) => {
        setResult(r);
        setAdded(null);
      }),
    );

  const runAdd = (people: ReadonlyArray<Candidate>) =>
    run(() =>
      addAll({ listId, people }).then((r) => {
        setAdded(r.inserted);
        refreshPeople();
        refreshLists();
      }),
    );

  return (
    <Section
      title="Build from search"
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={busy || query.trim() === ""}
          onClick={() => void runPreview()}
        >
          {busy ? "Searching…" : `Preview (${quote})`}
        </Button>
      }
    >
      <div className="flex gap-1.5">
        <input
          className={inputClass}
          placeholder='"typefully alternative" OR "schedule tweets"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className={inputClass + " w-28"}
          placeholder="min followers"
          inputMode="numeric"
          value={minFollowers}
          onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
        />
        <input
          className={inputClass + " w-36"}
          placeholder="bio contains"
          value={bioKeyword}
          onChange={(e) => setBio(e.target.value)}
        />
      </div>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {result !== null ? (
        <div className="flex flex-col gap-1 pt-2">
          <div className="flex items-center justify-between font-mono text-2xs text-muted-foreground">
            <span>
              {result.matches.length} matches · cost {usd(result.costUsd)}
              {added !== null ? ` · added ${added}` : ""}
            </span>
            <Button
              size="xs"
              disabled={busy || result.matches.length === 0 || added !== null}
              onClick={() => void runAdd(result.matches)}
            >
              Add all to list
            </Button>
          </div>
          <ul className="max-h-48 overflow-y-auto text-xs">
            {result.matches.map((m) => (
              <li key={m.handle} className="flex gap-2 border-t border-border py-0.5">
                <span className="w-40 shrink-0 truncate">@{m.handle}</span>
                <span className="w-12 shrink-0 text-right font-mono text-2xs">
                  {fmt(m.followers)}
                </span>
                <span className="truncate text-muted-foreground">{m.bio || m.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/** Who liked or reposted one post, priced by the service before the fetch, then one click into the list. */
function EngagementBuilder({ listId }: { readonly listId: number }) {
  const fetchEngagers = useAtomSet(engagersAtom, { mode: "promise" });
  const addAll = useAtomSet(listAddAllAtom, { mode: "promise" });
  const refreshPeople = useAtomRefresh(peopleAtom(listId));
  const refreshLists = useAtomRefresh(listsAtom);
  const { busy, error, run } = useAction();
  const [postText, setPostText] = useState("");
  const postId = parsePostId(postText);
  const [via, setVia] = useState<EngagementVia>("repost");
  const quote = AsyncResult.getOrElse(useAtomValue(engagersQuoteAtom(via)), () => null);
  const [result, setResult] = useState<{
    readonly matches: ReadonlyArray<Candidate>;
    readonly costUsd: number;
  } | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  return (
    <Section
      title="Build from engagement"
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={busy || postId === null}
          onClick={() => {
            if (postId === null) return;
            void run(() =>
              fetchEngagers({ postId, via }).then((r) => {
                setResult(r);
                setAdded(null);
              }),
            );
          }}
        >
          {busy ? "Fetching…" : `Fetch (${quote === null ? "…" : usd(quote)})`}
        </Button>
      }
    >
      <div className="flex gap-1.5">
        <input
          className={inputClass}
          placeholder="Post id or URL, e.g. 1835124037934367098"
          aria-label="Post id or URL"
          value={postText}
          onChange={(e) => setPostText(e.target.value)}
        />
        <select
          className={inputClass + " w-auto"}
          value={via}
          onChange={(e) => setVia(e.target.value as EngagementVia)}
        >
          <option value="repost">who reposted (scraper)</option>
          <option value="like">who liked (X API, first 20)</option>
        </select>
      </div>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {result !== null ? (
        <div className="flex flex-col gap-1 pt-2">
          <div className="flex items-center justify-between font-mono text-2xs text-muted-foreground">
            <span>
              {result.matches.length} people · cost {usd(result.costUsd)}
              {added !== null ? ` · added ${added}` : ""}
            </span>
            <Button
              size="xs"
              disabled={busy || result.matches.length === 0 || added !== null}
              onClick={() =>
                void run(() =>
                  addAll({ listId, people: result.matches }).then((r) => {
                    setAdded(r.inserted);
                    refreshPeople();
                    refreshLists();
                  }),
                )
              }
            >
              Add all to list
            </Button>
          </div>
          <ul className="max-h-48 overflow-y-auto text-xs">
            {result.matches.map((m) => (
              <li key={m.handle} className="flex gap-2 border-t border-border py-0.5">
                <span className="w-40 shrink-0 truncate">@{m.handle}</span>
                <span className="w-12 shrink-0 text-right font-mono text-2xs">
                  {fmt(m.followers)}
                </span>
                <span className="truncate text-muted-foreground">{m.bio || m.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
