import { Check, ChevronDown } from "lucide-react";

import { REPLY_SORTS, type ReplySort as Sort } from "../../state/engine";
import { Menu, MenuItem } from "../ui/menu";

/** X's names for its reply orders, in X's order, and the `sort_replies` its page carries for each. */
export const REPLY_SORT = {
  Relevance: { label: "Relevant", param: null },
  Recency: { label: "Recent", param: "recency" },
  Likes: { label: "Likes", param: "likes" },
} as const satisfies Record<Sort, { readonly label: string; readonly param: string | null }>;

/** X's "Relevant ⌄" under the focal post: re-sorts its replies, as X's own menu does. */
export function ReplySort({
  value,
  onChange,
}: {
  readonly value: Sort;
  readonly onChange: (sort: Sort) => void;
}) {
  return (
    <Menu
      label="Sort replies"
      trigger={
        <button
          type="button"
          className="-mx-1 flex cursor-pointer items-center gap-0.5 rounded px-1 text-[14px] text-[#71767b] hover:text-foreground"
        >
          {REPLY_SORT[value].label}
          <ChevronDown className="size-4" />
        </button>
      }
    >
      <p className="px-2 py-1.5 text-[13px] font-bold text-foreground">Sort replies</p>
      {REPLY_SORTS.map((sort) => (
        <MenuItem key={sort} onClick={() => onChange(sort)}>
          {REPLY_SORT[sort].label}
          {sort === value ? <Check className="ml-auto size-4 text-foreground" /> : null}
        </MenuItem>
      ))}
    </Menu>
  );
}
