import type { AccountPost, PostKind } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { engagementRate, fmt, pct, Section, Stat } from "./ui";

const COLUMNS = ["date", "views", "likes", "replies", "reposts", "bookmarks", "er"] as const;
type Column = (typeof COLUMNS)[number];

const valueOf = (p: AccountPost, c: Column): number =>
  c === "date" ? new Date(p.createdAt).getTime() : c === "er" ? engagementRate(p) : (p[c] ?? 0);

const KINDS: ReadonlyArray<PostKind> = ["text", "media", "link", "reply", "thread"];

export function PostsTable({ posts }: { readonly posts: ReadonlyArray<AccountPost> }) {
  const [sort, setSort] = useState<Column>("date");
  const [desc, setDesc] = useState(true);
  const byEr = [...posts].sort((a, b) => engagementRate(b) - engagementRate(a));
  const best = new Set(byEr.slice(0, 5).map((p) => p.postId));
  const worst = new Set(byEr.slice(-5).map((p) => p.postId));
  const sorted = [...posts].sort((a, b) => (valueOf(b, sort) - valueOf(a, sort)) * (desc ? 1 : -1));

  const toggle = (c: Column) => {
    if (c === sort) setDesc((d) => !d);
    else {
      setSort(c);
      setDesc(true);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Section title="Average views by type">
        <div className="grid grid-cols-5 gap-x-4">
          {KINDS.map((kind) => {
            const of = posts.filter((p) => p.kind === kind);
            const avg =
              of.length === 0 ? 0 : of.reduce((s, p) => s + (p.views ?? 0), 0) / of.length;
            return <Stat key={kind} label={kind} value={fmt(avg)} sub={`${of.length} posts`} />;
          })}
        </div>
      </Section>
      <Section title={`${posts.length} posts`}>
        <table className="w-full text-xs">
          <thead className="text-2xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Post</th>
              <th className="py-1 text-left font-normal">Type</th>
              {COLUMNS.map((c) => (
                <th key={c} className="py-1 text-right font-normal">
                  <button
                    type="button"
                    className={cn("cursor-pointer uppercase", c === sort && "text-foreground")}
                    onClick={() => toggle(c)}
                  >
                    {c}
                    {c === sort ? (desc ? " v" : " ^") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.postId}
                className={cn(
                  "border-t border-border hover:bg-accent/60",
                  best.has(p.postId) && "text-success-foreground",
                  worst.has(p.postId) && "text-error-foreground",
                )}
              >
                <td className="max-w-xs truncate py-1 pr-2">
                  <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {p.text || "(no text)"}
                  </a>
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{p.kind}</td>
                <td className="py-1 text-right font-mono text-muted-foreground">
                  {p.createdAt.slice(0, 10)}
                </td>
                <td className="py-1 text-right font-mono">{fmt(p.views)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.likes)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.replies)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.reposts)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.bookmarks)}</td>
                <td className="py-1 text-right font-mono">{pct(engagementRate(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pt-2 text-2xs text-muted-foreground">
          Green: top 5 by engagement rate. Red: bottom 5. Click a post to open it on x.com.
        </p>
      </Section>
    </div>
  );
}
