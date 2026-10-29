import { Marks_METHODS, MarksRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Marks from "./Marks.ts";

/** Marks read straight from SQLite, so this area adds no service of its own. */
export const layer = Layer.empty;

/** RPC handlers for MarksRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = MarksRpcGroup.toLayer(
  Effect.succeed(
    MarksRpcGroup.of({
      [Marks_METHODS.forPosts]: ({ posts }) => Marks.forPosts(posts).pipe(Effect.orDie),
    }),
  ),
);
