import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { AnalyzeData } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck } from "lucide-react";
import { TextMorph } from "torph/react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { engagersAtom, themesAtom } from "../../state/analyze";
import { Button } from "../ui/button";
import { Section } from "../ui/layout";
import { AnalyzePage, RefreshPosts } from "./AnalyzePage";
import { errorText, fmt, insetTable, ModelCall, Note, XLink } from "./ui";

function Engagers() {
  const result = useAtomValue(engagersAtom);
  const t = insetTable;
  return (
    <Section title="Accounts you see most">
      {AsyncResult.match(result, {
        onInitial: () => <Note>Loading.</Note>,
        onFailure: (f) => <p className="text-xs text-error-foreground">{errorText(f.cause)}</p>,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            isElectron ? (
              <Note
                action={
                  <Button size="sm" variant="outline" render={<Link to="/x" />}>
                    Open X
                  </Button>
                }
              >
                Nothing seen yet. Accounts land here as you browse X.
              </Note>
            ) : (
              <Note>Nothing seen yet. Browse X in the desktop app.</Note>
            )
          ) : (
            <table className={t.root}>
              <thead>
                <tr>
                  <th className={t.th}>Account</th>
                  <th className={cn(t.th, "text-right")}>Followers</th>
                  <th className={cn(t.th, "text-right")}>Seen</th>
                </tr>
              </thead>
              <tbody>
                {value.map((e) => (
                  <tr key={e.handle} className={t.row}>
                    <td className={cn(t.td, "max-w-0")}>
                      <XLink
                        href={`https://x.com/${e.handle}`}
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        <span className="truncate font-medium">{e.name}</span>
                        {e.verified ? (
                          <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          @{e.handle}
                        </span>
                      </XLink>
                    </td>
                    <td className={cn(t.td, t.num)}>{fmt(e.followers)}</td>
                    <td className={cn(t.td, t.num, "text-muted-foreground")}>{e.seen}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ),
      })}
    </Section>
  );
}

function Themes({ data }: { readonly data: AnalyzeData }) {
  const result = useAtomValue(themesAtom);
  const run = useAtomSet(themesAtom);
  const byId = new Map(data.posts.map((p) => [p.postId, p]));
  const noPosts = data.posts.length === 0;
  return (
    <Section
      title="Themes in your best 50 posts"
      aside={
        <Button
          size="sm"
          variant="outline"
          disabled={result.waiting || noPosts}
          title="Cached per set of posts: asking again for the same posts is free."
          onClick={() => run()}
        >
          <TextMorph duration={250}>{result.waiting ? "Analyzing" : "Analyze themes"}</TextMorph>
          <ModelCall />
        </Button>
      }
    >
      {AsyncResult.match(result, {
        onInitial: () =>
          noPosts ? (
            <Note action={<RefreshPosts />}>Refresh your posts first.</Note>
          ) : (
            <Note>Groups your top posts by what they are about, and why each group works.</Note>
          ),
        onFailure: (f) => <p className="text-xs text-error-foreground">{errorText(f.cause)}</p>,
        onSuccess: ({ value }) => (
          <div className="grid gap-x-10 gap-y-6 @4xl:grid-cols-2">
            {value.map((t) => (
              <div key={t.name} className="flex min-w-0 flex-col gap-1">
                <p className="flex items-baseline gap-2 text-sm font-medium">
                  {t.name}
                  <span className="font-mono text-2xs text-muted-foreground">
                    {t.postIds.length} posts
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{t.why}</p>
                <ul className="mt-1 flex flex-col border-t border-border text-[13px]">
                  {t.postIds.slice(0, 5).map((id) => {
                    const p = byId.get(id);
                    return p === undefined ? null : (
                      <li key={id} className="border-b border-border py-1.5">
                        <XLink href={p.url} className="block truncate text-foreground/90">
                          {p.text}
                        </XLink>
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

export function Audience({ data }: { readonly data: AnalyzeData }) {
  return (
    <AnalyzePage data={data}>
      <Engagers />
      <Themes data={data} />
    </AnalyzePage>
  );
}
