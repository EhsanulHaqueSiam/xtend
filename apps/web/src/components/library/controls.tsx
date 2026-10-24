import { Menu } from "@base-ui/react/menu";
import type { PostFormat, XPost } from "@xtend/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";

import { useQuoteLabel } from "../../state/costs";
import { HeaderTabs } from "../PageHeader";
import { Cost } from "../ui/layout";
import { menuItemClass, menuPopupClass } from "./menu";
import { engagement, formatOf } from "./shared";

/** Header controls the Library sections share: format filter, sort, and Search X. */

export type FormatFilter = "all" | PostFormat;

const FORMAT_LABELS: Record<FormatFilter, string> = {
  all: "All",
  thread: "Threads",
  media: "Media",
  text: "Text",
  link: "Links",
};

/** The formats a list of plain posts can tell apart; threads need the archive's labels. */
export const POST_FORMATS = [
  "all",
  "media",
  "text",
  "link",
] as const satisfies ReadonlyArray<FormatFilter>;

export const matchesFormat = (post: XPost, filter: FormatFilter) =>
  filter === "all" || formatOf(post) === filter;

/** Counts per format for the filter row, over plain posts. */
export const formatCounts = (
  posts: ReadonlyArray<XPost>,
): Partial<Record<FormatFilter, number>> => {
  const counts: Partial<Record<FormatFilter, number>> = { all: posts.length };
  for (const post of posts) {
    const f = formatOf(post);
    counts[f] = (counts[f] ?? 0) + 1;
  }
  return counts;
};

export function FormatTabs({
  value,
  onChange,
  options = POST_FORMATS,
  counts,
}: {
  readonly value: FormatFilter;
  readonly onChange: (next: FormatFilter) => void;
  readonly options?: ReadonlyArray<FormatFilter>;
  readonly counts?: Partial<Record<FormatFilter, number>>;
}) {
  return (
    <HeaderTabs
      label="Format"
      tabs={options.map((id) => ({ id, label: FORMAT_LABELS[id], count: counts?.[id] }))}
      value={value}
      onChange={onChange}
    />
  );
}

export type SortKey = "views" | "er" | "newest";

const SORTS: ReadonlyArray<{ readonly id: SortKey; readonly label: string }> = [
  { id: "views", label: "Most views" },
  { id: "er", label: "Best ER" },
  { id: "newest", label: "Newest" },
];

const sortValue = (post: XPost, key: SortKey) =>
  key === "views"
    ? (post.metrics.views ?? -1)
    : key === "er"
      ? (engagement(post.metrics) ?? -1)
      : Date.parse(post.createdAt);

/** A sorted copy; the lists are bounded by the service (a day's picks, 200 archive rows). */
export const sortItems = <T,>(
  items: ReadonlyArray<T>,
  postOf: (item: T) => XPost,
  key: SortKey,
): ReadonlyArray<T> =>
  items.toSorted((a, b) => sortValue(postOf(b), key) - sortValue(postOf(a), key));

export function SortMenu({
  value,
  onChange,
}: {
  readonly value: SortKey;
  readonly onChange: (next: SortKey) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--control-radius)] px-2 text-[13px] text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:text-foreground">
        {SORTS.find((s) => s.id === value)?.label}
        <ChevronDown className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Menu.Popup className={menuPopupClass}>
            {SORTS.map((s) => (
              <Menu.Item key={s.id} className={menuItemClass} onClick={() => onChange(s.id)}>
                {s.label}
                {s.id === value ? <Check className="ml-auto size-3.5" /> : null}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * "Search X" in a section's header, priced as you type. Submitting opens the
 * Search section with the query, which runs it. The `s` hotkey focuses it.
 */
export function SearchXField() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const quote = useQuoteLabel({ kind: "search", query: query.trim() });
  return (
    <form
      role="search"
      className="flex h-7 w-52 shrink items-center gap-1.5 rounded-[var(--control-radius)] border border-white/13 pr-2 pl-2 transition-[border-color] duration-150 focus-within:border-white/30 @max-[44rem]:w-40"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        if (q !== "") void navigate({ href: `/library?tab=search&q=${encodeURIComponent(q)}` });
      }}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        aria-label="Search X"
        data-shortcut="search"
        placeholder="Search X"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-hidden placeholder:text-muted-foreground"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Cost label={quote} />
    </form>
  );
}
