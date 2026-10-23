import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  AuthorBand,
  HookPattern,
  type LibraryFilters,
  type LibraryPost,
  PostFormat,
} from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { PenLine, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  browseAtom,
  detectPatternsAtom,
  encodeFilters,
  writeInFormatAtom,
} from "../../state/library";
import { Button } from "../ui/button";
import { SaveButton } from "./SaveButton";
import { InspireButton } from "./SearchTab";
import { Empty, ErrorLine, PostRow, errorMessage, inputClass } from "./shared";

// The shared input class is full width; the bar needs its controls side by side.
const narrow = inputClass.replace("w-full", "");
const selectClass = `${narrow} w-auto`;
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => THIS_YEAR - i);
const LANGS = ["en", "es", "pt", "fr", "de", "ja", "hi", "id"] as const;

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T | undefined;
  readonly options: ReadonlyArray<T>;
  readonly onChange: (v: T | undefined) => void;
}) {
  return (
    <select
      aria-label={label}
      className={selectClass}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as T))}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Filters over the archive. Every control is a plain select or input so the bar stays one row. */
export function FilterBar({
  value,
  onChange,
}: {
  readonly value: LibraryFilters;
  readonly onChange: (next: LibraryFilters) => void;
}) {
  const set = <K extends keyof LibraryFilters>(key: K, v: LibraryFilters[K] | undefined) => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <input
        className={`${narrow} w-28`}
        aria-label="Min views"
        type="number"
        min={0}
        placeholder="min views"
        value={value.minViews ?? ""}
        onChange={(e) =>
          set("minViews", e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
      <Select
        label="format"
        value={value.format}
        options={PostFormat.literals}
        onChange={(v) => set("format", v)}
      />
      <Select
        label="year"
        value={value.year === undefined ? undefined : String(value.year)}
        options={YEARS.map(String)}
        onChange={(v) => set("year", v === undefined ? undefined : Number(v))}
      />
      <Select
        label="author size"
        value={value.authorBand}
        options={AuthorBand.literals}
        onChange={(v) => set("authorBand", v)}
      />
      <Select
        label="language"
        value={value.lang}
        options={LANGS}
        onChange={(v) => set("lang", v)}
      />
      <Select
        label="hook"
        value={value.hookPattern}
        options={HookPattern.literals}
        onChange={(v) => set("hookPattern", v)}
      />
      {Object.keys(value).length > 0 ? (
        <Button variant="ghost-muted" size="xs" onClick={() => onChange({})}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function ArchiveRow({ entry }: { readonly entry: LibraryPost }) {
  const write = useAtomSet(writeInFormatAtom, { mode: "promise" });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <PostRow
      post={entry.post}
      badge={
        <span className="rounded-sm border border-border px-1 font-mono text-2xs text-muted-foreground">
          {entry.format}
          {entry.hookPattern === null ? "" : ` · ${entry.hookPattern}`}
        </span>
      }
      actions={
        <>
          <SaveButton post={entry.post} />
          <InspireButton post={entry.post} />
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setStatus(null);
              try {
                const { text } = await write(entry.post.postId);
                setStatus(`Saved as a suggested draft: ${text}`);
              } catch (e) {
                setStatus(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <PenLine /> {busy ? "Writing…" : "Write mine in this format (model)"}
          </Button>
          {status !== null ? (
            <span className="text-2xs text-muted-foreground">{status}</span>
          ) : null}
        </>
      }
    />
  );
}

/** Every post a search or a pick has seen, with the model's format and hook labels. */
export function ArchiveTab() {
  const [filters, setFilters] = useState<LibraryFilters>({});
  const key = encodeFilters(filters);
  const result = useAtomValue(browseAtom(key));
  const refresh = useAtomRefresh(browseAtom(key));
  const detect = useAtomSet(detectPatternsAtom, { mode: "promise" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runDetect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { detected, remaining } = await detect();
      setNotice(`Labelled ${detected} posts, ${remaining} still unlabelled.`);
      refresh();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar value={filters} onChange={setFilters} />
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-2xs text-muted-foreground">
        <span>Formats come from the post; hook patterns need one model call per 20 posts.</span>
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          disabled={busy}
          onClick={() => void runDetect()}
        >
          <Sparkles /> {busy ? "Detecting…" : "Detect patterns (20 posts, model)"}
        </Button>
      </div>
      {notice !== null ? <ErrorLine>{notice}</ErrorLine> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {AsyncResult.match(result, {
          onInitial: () => <Empty>Loading…</Empty>,
          onFailure: (f) => <ErrorLine>{String(f.cause)}</ErrorLine>,
          onSuccess: ({ value }) =>
            value.length === 0 ? (
              <Empty>Nothing here yet. Searches and picks fill the archive.</Empty>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2 py-2">
                {value.map((entry) => (
                  <ArchiveRow key={entry.post.postId} entry={entry} />
                ))}
              </div>
            ),
        })}
      </div>
    </div>
  );
}
