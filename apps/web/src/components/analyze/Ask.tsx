import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { askAtom } from "../../state/analyze";
import { Button } from "../ui/button";
import { Empty, ErrorText, errorText, inputClass, Section } from "./ui";

/** One question, one answer. The last answer lives in the atom until the next question. */
export function Ask() {
  const result = useAtomValue(askAtom);
  const ask = useAtomSet(askAtom);
  const [question, setQuestion] = useState("");
  const submit = (q: string) => {
    if (q.trim() === "" || result.waiting) return;
    setQuestion(q);
    ask(q.trim());
  };
  return (
    <div className="flex flex-col gap-3">
      <Section title="Ask about my data">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <input
            className={inputClass}
            placeholder="Which of my post types gets the most replies?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={result.waiting}>
            {result.waiting ? "Asking…" : "Ask"}
          </Button>
        </form>
        <p className="pt-1 text-2xs text-muted-foreground">
          One model call over your loaded posts summary. Not a chat.
        </p>
      </Section>
      {AsyncResult.match(result, {
        onInitial: () => <Empty>The answer shows here.</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) => (
          <Section title="Answer">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{value.answer}</p>
            {value.followUps.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {value.followUps.slice(0, 3).map((f) => (
                  <Button key={f} size="xs" variant="outline" onClick={() => submit(f)}>
                    {f}
                  </Button>
                ))}
              </div>
            ) : null}
          </Section>
        ),
      })}
    </div>
  );
}
