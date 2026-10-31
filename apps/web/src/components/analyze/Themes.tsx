import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AnalyzeData } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { TextMorph } from "torph/react";

import { themesAtom } from "../../state/analyze";
import { useQuoteLabel } from "../../state/costs";
import { Button } from "../ui/button";
import { Cost, Section } from "../ui/layout";
import { XLink } from "../ui/x-link";
import { RefreshPosts } from "./AnalyzePage";
import { errorText, Note } from "./ui";

/** Your best posts grouped by what they are about, and why each group works; paid, cached per set. */
export function Themes({ data }: { readonly data: AnalyzeData }) {
  const result = useAtomValue(themesAtom);
  const run = useAtomSet(themesAtom);
  const quote = useQuoteLabel({ kind: "assist" });
  const byId = new Map(data.posts.map((p) => [p.postId, p]));
  const noPosts = data.posts.length === 0;
  return (
    <Section
      title="Themes in your best 50 posts"
      aside={
        <Button
          size="sm"
          variant="outline"
          disabled={result.waiting || noPosts || quote === "…"}
          title="Cached per set of posts: asking again for the same posts is free."
          onClick={() => run()}
        >
          <TextMorph duration={250}>{result.waiting ? "Analyzing" : "Analyze themes"}</TextMorph>
          <Cost label={quote} />
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
                        <XLink
                          href={p.url}
                          className="block truncate text-foreground/90 hover:underline"
                        >
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
