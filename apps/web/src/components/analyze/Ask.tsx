import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AnalyzeData } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useRef, useState } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { askAtom } from "../../state/analyze";
import { useQuoteLabel } from "../../state/costs";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { Cost, Section } from "../ui/layout";
import { AnalyzePage, RefreshPosts } from "./AnalyzePage";
import { errorText, Note } from "./ui";

/** Picking one fills the box; asking stays a separate, priced click. */
const EXAMPLES = [
  "Which of my post types gets the most replies?",
  "What do my best posts have in common?",
  "Which hours get my posts the most views?",
] as const;

/** One question, one answer: a model call over the loaded posts summary, not a chat. The last answer lives in the atom. */
export function Ask({ data }: { readonly data: AnalyzeData }) {
  const result = useAtomValue(askAtom);
  const ask = useAtomSet(askAtom);
  const quote = useQuoteLabel({ kind: "assist" });
  const [question, setQuestion] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const submit = (q: string) => {
    if (q.trim() === "" || result.waiting) return;
    setQuestion(q);
    ask(q.trim());
  };
  return (
    <AnalyzePage data={data}>
      <Section>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <input
            ref={input}
            aria-label="Question"
            className={cn(inputClass, "h-8 flex-1 py-0")}
            placeholder="Ask about your posts and audience"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            variant="outline"
            type="submit"
            disabled={result.waiting || question.trim() === ""}
          >
            <TextMorph duration={250}>{result.waiting ? "Asking" : "Ask"}</TextMorph>
            <Cost label={quote} />
          </Button>
        </form>
        {data.posts.length === 0 ? (
          <div className="pt-3">
            <Note action={<RefreshPosts />}>No posts loaded yet. Answers come from them.</Note>
          </div>
        ) : null}
      </Section>
      {AsyncResult.match(result, {
        onInitial: () => (
          <Section title="Examples">
            <ul className="flex flex-col border-t border-border">
              {EXAMPLES.map((q) => (
                <li key={q} className="border-b border-border">
                  <button
                    type="button"
                    className="w-full cursor-pointer py-2 text-left text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    onClick={() => {
                      setQuestion(q);
                      input.current?.focus();
                    }}
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ),
        onFailure: (f) => (
          <Section>
            <p role="alert" className="text-sm text-error-foreground">
              {errorText(f.cause)}
            </p>
          </Section>
        ),
        onSuccess: ({ value }) => (
          <Section title="Answer">
            <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-wrap">{value.answer}</p>
            {value.followUps.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {value.followUps.slice(0, 3).map((f) => (
                  <Button key={f} size="sm" variant="outline" onClick={() => submit(f)}>
                    {f}
                    <Cost label={quote} />
                  </Button>
                ))}
              </div>
            ) : null}
          </Section>
        ),
      })}
    </AnalyzePage>
  );
}
