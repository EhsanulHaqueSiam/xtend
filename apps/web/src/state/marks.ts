import { Marks_METHODS, MarkSubject } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";

import { clientRuntime, XtendClient } from "../rpc/client";

const SubjectsJson = Schema.fromJsonString(Schema.Array(MarkSubject));
const decodeSubjects = Schema.decodeSync(SubjectsJson);
const encodeSubjects = Schema.encodeSync(SubjectsJson);

/** Keyed by the batch itself, so a list re-rendering with the same posts asks once. */
export const marksKey = (posts: ReadonlyArray<MarkSubject>) => encodeSubjects(posts);

export const marksAtom = Atom.family((key: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Marks_METHODS.forPosts]({ posts: decodeSubjects(key) });
    }),
  ),
);
