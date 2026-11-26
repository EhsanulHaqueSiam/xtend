import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import type { DesktopCommand } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as SessionPosting from "./SessionPosting.ts";
import { desktopStub } from "./testStubs.ts";

const asked: Array<DesktopCommand> = [];
const layerTest = SessionPosting.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      NodeCrypto.layer,
      TokenCipher.layerTest,
      desktopStub(asked, (command) =>
        Effect.succeed({ type: command.type, postId: "702" } as never),
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
    expect(asked).toEqual([
      { type: "sessionEditPost", postId: "701", text: "fixed the typo", styles: bold },
    ]);
  }).pipe(Effect.provide(layerTest)),
);
