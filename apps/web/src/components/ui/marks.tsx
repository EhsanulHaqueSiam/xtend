import { useAtomValue } from "@effect/atom-react";
import type { Mark, MarkSubject } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { fmtWhen } from "../../lib/time";
import { marksAtom, marksKey } from "../../state/marks";

/**
 * Marks: what Xtend already knows about a post, in the same words on every row
 * and on the x.com overlay. Read from local data only, so they cost nothing.
 */

/** Marks per post id for the posts a list shows; none until the service answers. */
export const useMarks = (posts: ReadonlyArray<MarkSubject>) =>
  AsyncResult.getOrElse(
    useAtomValue(marksAtom(marksKey(posts))),
    (): Readonly<Record<string, ReadonlyArray<Mark>>> => ({}),
  );

const text = (m: Mark) =>
  m.kind === "replied"
    ? `replied${m.at === null ? "" : ` · ${fmtWhen(m.at)}`}`
    : m.kind === "lead" || m.kind === "auto"
      ? `${m.kind} · ${m.detail}`
      : m.kind;

export function Marks({ marks }: { readonly marks: ReadonlyArray<Mark> | undefined }) {
  if (marks === undefined || marks.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-2.5 text-2xs text-foreground">
      {marks.map((m) => (
        <span key={m.kind}>
          <span className="mr-1 text-[7px] align-[1px]">●</span>
          {text(m)}
        </span>
      ))}
    </span>
  );
}
