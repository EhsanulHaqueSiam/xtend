import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  DESKTOP_COMMAND_LIMIT_MS,
  type DesktopCommand,
  DesktopUnavailableError,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as SessionPosting from "./SessionPosting.ts";
import { desktopStub } from "./testStubs.ts";

const asked: Array<DesktopCommand> = [];
// How the desktop answers the next command: X's new id, or why it did not.
const desktop = { answer: "ok" as "ok" | DesktopUnavailableError["reason"] };
const layerTest = SessionPosting.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      NodeCrypto.layer,
      TokenCipher.layerTest,
      desktopStub(asked, (command) =>
        desktop.answer === "ok"
          ? Effect.succeed({ type: command.type, postId: "702" } as never)
          : Effect.fail(new DesktopUnavailableError({ reason: desktop.answer, detail: "test" })),
      ),
    ),
  ),
);

it.effect("edits through the session only while session actions are on, styles and all", () =>
  Effect.gen(function* () {
    const session = yield* SessionPosting.SessionPosting;
    const settings = yield* SettingsStore.SettingsStore;
    const edit = { postId: "701", text: "fixed the typo", styles: [] };

    yield* settings.update({ sessionPostingEnabled: false });
    const off = yield* Effect.flip(session.edit(edit));
    expect(off.detail).toMatch(/Session actions are off/);
    expect(asked).toEqual([]);

    yield* settings.update({ sessionPostingEnabled: true });
    const bold = [{ start: 0, end: 5, style: "Bold" as const }];
    expect(yield* session.edit({ ...edit, styles: bold })).toEqual({ postId: "702" });
    // With the service's own deadline (the test clock starts at 0), past which it stops waiting.
    expect(asked).toEqual([
      {
        type: "sessionEditPost",
        postId: "701",
        text: "fixed the typo",
        styles: bold,
        deadline: DESKTOP_COMMAND_LIMIT_MS.sessionEditPost,
      },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "tells an edit X may have saved (Update pressed, no answer) from one the desktop never pressed",
  () =>
    Effect.gen(function* () {
      const session = yield* SessionPosting.SessionPosting;
      yield* (yield* SettingsStore.SettingsStore).update({ sessionPostingEnabled: true });
      const edit = { postId: "701", text: "fixed the typo" };
      const outcome = (answer: typeof desktop.answer) =>
        Effect.suspend(() => {
          desktop.answer = answer;
          return session.edit(edit).pipe(
            Effect.map(({ postId }) => postId),
            Effect.catchTags({ ComposeError: () => Effect.succeed("refused") }),
          );
        });
      // Each a separate click, past the human pace's gap.
      const results = [];
      for (const answer of ["failed", "timeout", "not_attempted", "no_desktop"] as const) {
        results.push(yield* outcome(answer));
        yield* TestClock.adjust("9 seconds");
      }
      expect(results).toEqual([null, null, "refused", "refused"]);
    }).pipe(Effect.provide(layerTest)),
);
