import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AuthorBand, HookPattern, type LibraryFilters, type LibraryPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactNode } from "react";

import { fmtDay } from "../../lib/time";
import { cn } from "../../lib/utils";
import {
  browseAtom,
  detectPatternsAtom,
  encodeFilters,
  writeInFormatAtom,
} from "../../state/library";
import { useQuoteLabel } from "../../state/costs";
import { PageHeader } from "../PageHeader";
import { compactInputClass } from "../ui/field";
import { Cost, Empty } from "../ui/layout";
import { DetailSplit } from "../ui/split";
import { xPill, xPillSm } from "../x";
import {
  FormatTabs,
  SearchXField,
  SortMenu,
  sortItems,
  type FormatFilter,
  type SortKey,
} from "./controls";
import { PostGrid } from "./PostCard";
import { DraftBlock, InspectorGroup, PostInspector } from "./PostInspector";
import { RemixButton, SaveButton, useSavedIds } from "./SaveButton";
import { AppLink, ErrorLine, causeMessage, errorMessage } from "./shared";

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => THIS_YEAR - i);
const LANGS = ["en", "es", "pt", "fr", "de", "ja", "hi", "id"] as const;
const ARCHIVE_FORMATS = ["all", "thread", "media", "text", "link"] as const;

function Select<T extends string>({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: T | undefined;
  readonly options: ReadonlyArray<T>;
  readonly onChange: (v: T | undefined) => void;
}) {
  return (
    <select
      aria-label={label}
      className={cn(
        compactInputClass,
        "w-auto cursor-pointer",
        value === undefined && "text-muted-foreground",
      )}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as T))}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** The archive's filters other than format, which sits in the header. One row of plain controls. */
export function FilterBar({
  value,
  onChange,
  aside,
}: {
  readonly value: LibraryFilters;
  readonly onChange: (next: LibraryFilters) => void;
  readonly aside?: ReactNode;
}) {
  const set = <K extends keyof LibraryFilters>(key: K, v: LibraryFilters[K] | undefined) => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const { format, ...rest } = value;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-6 py-2.5">
      <input
        className={cn(compactInputClass, "w-24 font-mono tabular-nums")}
        aria-label="Min views"
        type="number"
        min={0}
        placeholder="min views"
        value={value.minViews ?? ""}
        // The filter key is schema-encoded on render, and a negative or fractional count fails it.
        onChange={(e) => {
          const n = Math.trunc(Number(e.target.value));
          set("minViews", e.target.value === "" || Number.isNaN(n) ? undefined : Math.max(0, n));
        }}
      />
      <Select
        label="year"
        placeholder="Any year"
        value={value.year === undefined ? undefined : String(value.year)}
        options={YEARS.map(String)}
        onChange={(v) => set("year", v === undefined ? undefined : Number(v))}
      />
      <Select
        label="author size"
        placeholder="Any author size"
        value={value.authorBand}
        options={AuthorBand.literals}
        onChange={(v) => set("authorBand", v)}
      />
      <Select
        label="language"
        placeholder="Any language"
        value={value.lang}
        options={LANGS}
        onChange={(v) => set("lang", v)}
      />
      <Select
        label="hook"
        placeholder="Any hook"
        value={value.hookPattern}
        options={HookPattern.literals}
        onChange={(v) => set("hookPattern", v)}
      />
      {Object.keys(rest).length > 0 ? (
        <button
          type="button"
          className="h-7 cursor-pointer px-2 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={() => onChange(format === undefined ? {} : { format })}
        >
          Clear
        </button>
      ) : null}
      {aside !== undefined ? <div className="ml-auto flex items-center gap-2">{aside}</div> : null}
    </div>
  );
}

/** The selected archive post, with the model's "write mine in this format". */
function ArchiveInspector({
  entry,
  saved,
  onClose,
}: {
  readonly entry: LibraryPost;
  readonly saved: boolean;
  readonly onClose: () => void;
}) {
  const write = useAtomSet(writeInFormatAtom(entry.post.postId), { mode: "promise" });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <PostInspector
      post={entry.post}
      format={entry.format}
      facts={[
        ["Hook", entry.hookPattern ?? "not labelled"],
        ["Last seen", fmtDay(entry.lastSeenAt)],
      ]}
      onClose={onClose}
    >
      <InspectorGroup title="Act">
        <div className="flex flex-wrap items-center gap-1.5">
          <SaveButton post={entry.post} saved={saved} />
          <RemixButton post={entry.post} />
        </div>
      </InspectorGroup>
      <InspectorGroup title="Write mine in this format" aside={<Cost label={assistQuote} />}>
        {draft === null ? (
          <button
            type="button"
            className={cn(xPill, xPillSm)}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setDraft((await write()).text);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Writing" : "Write it"}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <DraftBlock>{draft}</DraftBlock>
            <p className="text-xs text-muted-foreground">
              Filed as a suggested draft.{" "}
              <AppLink href="/compose?tab=automatic" className="text-foreground hover:underline">
                Open Compose
              </AppLink>
            </p>
          </div>
        )}
        {error !== null ? <ErrorLine className="px-0">{error}</ErrorLine> : null}
      </InspectorGroup>
    </PostInspector>
  );
}

const tagOf = (entry: LibraryPost) =>
  [entry.format === "thread" ? "thread" : null, entry.hookPattern]
    .filter((t) => t !== null)
    .join(" · ") || null;

/** Every post a search or a pick has seen, with the model's format and hook labels. */
export function ArchiveTab() {
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [sort, setSort] = useState<SortKey>("views");
  const [selected, setSelected] = useState<string | null>(null);
  const key = encodeFilters(filters);
  const result = useAtomValue(browseAtom(key));
  const refresh = useAtomRefresh(browseAtom(key));
  const detect = useAtomSet(detectPatternsAtom, { mode: "promise" });
  const saved = useSavedIds();
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runDetect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { detected, remaining } = await detect();
      setNotice(`${detected} labelled, ${remaining} to go`);
      refresh();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = AsyncResult.getOrElse(result, (): ReadonlyArray<LibraryPost> => []);
  const entry = rows.find((r) => r.post.postId === selected);
  const format: FormatFilter = filters.format ?? "all";

  return (
    <>
      <PageHeader
        title="Archive"
        tabs={
          <FormatTabs
            value={format}
            options={ARCHIVE_FORMATS}
            onChange={(next) => {
              const { format: _, ...rest } = filters;
              setFilters(next === "all" ? rest : { ...rest, format: next });
            }}
          />
        }
        detail={AsyncResult.isSuccess(result) ? `${rows.length} posts` : undefined}
        actions={
          <>
            <SortMenu value={sort} onChange={setSort} />
            <SearchXField />
          </>
        }
      />
      <FilterBar
        value={filters}
        onChange={setFilters}
        aside={
          <>
            {notice !== null ? (
              <span className="font-mono text-2xs text-muted-foreground">{notice}</span>
            ) : null}
            <button
              type="button"
              className={cn(xPill, xPillSm)}
              disabled={busy}
              title="Label the hook pattern of the next 20 unlabelled posts"
              onClick={() => void runDetect()}
            >
              {busy ? "Detecting" : "Detect hooks"}
              {/* One model call labels the batch of 20. */}
              <Cost label={`20 posts · ${assistQuote}`} />
            </button>
          </>
        }
      />
      <DetailSplit
        closable
        label="Selected post"
        detailKey={selected}
        detail={
          entry === undefined ? null : (
            <ArchiveInspector
              key={entry.post.postId}
              entry={entry}
              saved={saved.has(entry.post.postId)}
              onClose={() => setSelected(null)}
            />
          )
        }
        list={AsyncResult.match(result, {
          onInitial: () => <Empty>Loading the archive</Empty>,
          onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
          onSuccess: ({ value }) =>
            value.length === 0 ? (
              Object.keys(filters).length > 0 ? (
                <Empty
                  action={
                    <button
                      type="button"
                      className={cn(xPill, xPillSm)}
                      onClick={() => setFilters({})}
                    >
                      Clear filters
                    </button>
                  }
                >
                  No archived post matches these filters.
                </Empty>
              ) : (
                <Empty
                  action={
                    <AppLink href="/library?tab=search" className={cn(xPill, xPillSm)}>
                      Search X
                    </AppLink>
                  }
                >
                  Searches and picks fill the archive.
                </Empty>
              )
            ) : (
              <PostGrid
                items={sortItems(value, (r) => r.post, sort).map((r) => ({
                  key: r.post.postId,
                  post: r.post,
                  tag: tagOf(r),
                }))}
                selected={selected}
                onSelect={setSelected}
              />
            ),
        })}
      />
    </>
  );
}
