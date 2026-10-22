import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AccountPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck } from "lucide-react";

import { engagersAtom, themesAtom } from "../../state/analyze";
import { Button } from "../ui/button";
import { Empty, ErrorText, errorText, fmt, Section } from "./ui";

function Engagers() {
  const result = useAtomValue(engagersAtom);
  return (
    <Section title="Top engagers seen this session">
      {AsyncResult.match(result, {
        onInitial: () => <Empty>Loading…</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            <Empty>Nothing observed yet. Browse x.com in the desktop app first.</Empty>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {value.map((e) => (
                  <tr key={e.handle} className="border-t border-border first:border-t-0">
                    <td className="flex items-center gap-1 py-1">
                      <span className="truncate font-medium">{e.name}</span>
                      {e.verified ? <BadgeCheck className="size-3 text-info-foreground" /> : null}
                      <span className="text-muted-foreground">@{e.handle}</span>
                    </td>
                    <td className="py-1 text-right font-mono text-muted-foreground">
                      {fmt(e.followers)} followers
                    </td>
                    <td className="py-1 text-right font-mono text-muted-foreground">
                      seen {e.seen}x
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ),
      })}
    </Section>
  );
}

function Themes({ posts }: { readonly posts: ReadonlyArray<AccountPost> }) {
  const result = useAtomValue(themesAtom);
  const run = useAtomSet(themesAtom);
  const byId = new Map(posts.map((p) => [p.postId, p]));
  return (
    <Section
      title="Themes in your best 50 posts"
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={result.waiting || posts.length === 0}
          onClick={() => run()}
        >
          {result.waiting ? "Analyzing…" : "Analyze themes (model call, cached per post set)"}
        </Button>
      }
    >
      {AsyncResult.match(result, {
        onInitial: () => (
          <Empty>
            {posts.length === 0
              ? "Refresh your posts first."
              : "Runs the assistant over your top posts."}
          </Empty>
        ),
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) => (
          <div className="flex flex-col divide-y divide-border">
            {value.map((t) => (
              <div key={t.name} className="py-2">
                <p className="text-sm font-medium">
                  {t.name}{" "}
                  <span className="font-mono text-2xs text-muted-foreground">
                    {t.postIds.length} posts
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{t.why}</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {t.postIds.slice(0, 5).map((id) => {
                    const p = byId.get(id);
                    return p === undefined ? null : (
                      <li key={id} className="truncate">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {p.text}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ),
      })}
    </Section>
  );
}

export function Audience({ posts }: { readonly posts: ReadonlyArray<AccountPost> }) {
  return (
    <div className="flex flex-col gap-3">
      <Engagers />
      <Themes posts={posts} />
    </div>
  );
}
