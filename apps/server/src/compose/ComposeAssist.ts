import {
  ComposeError,
  ContinuedBlocks,
  HookAlternatives,
  RewriteVariants,
  ThreadIdeas,
  type ReplyTone,
  type VoiceMatch,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";

type Blocks = ReadonlyArray<string>;

export class ComposeAssist extends Context.Service<
  ComposeAssist,
  {
    readonly improveHook: (
      blocks: Blocks,
      tone?: ReplyTone,
    ) => Effect.Effect<HookAlternatives, ComposeError>;
    readonly rewrite: (
      text: string,
      tone?: ReplyTone,
    ) => Effect.Effect<RewriteVariants, ComposeError>;
    readonly threadIdeas: (
      topic: string,
      tone?: ReplyTone,
    ) => Effect.Effect<ThreadIdeas, ComposeError>;
    readonly continueThread: (
      blocks: Blocks,
      tone?: ReplyTone,
    ) => Effect.Effect<ContinuedBlocks, ComposeError>;
    /** Compares the draft with the Settings handle's recent posts (up to 20). */
    readonly voiceMatch: (blocks: Blocks) => Effect.Effect<VoiceMatch, ComposeError>;
  }
>()("xtend/compose/ComposeAssist") {}

const make = Effect.gen(function* () {
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const x = yield* XClient.XClient;
  const fail = (operation: string) => (cause: { readonly message: string }) =>
    new ComposeError({ operation, detail: cause.message });

  const improveHook = Effect.fn("ComposeAssist.improveHook")(
    (blocks: Blocks, tone?: ReplyTone) =>
      assist.generate({
        task: "compose.improveHook",
        tone,
        instructions:
          "Rewrite the first line (the hook) of this X post. Return exactly 3 alternatives, each under 200 characters, with a one-line reason why it should stop the scroll. Keep the rest of the post as context only.",
        input: { hook: blocks[0] ?? "", rest: blocks.slice(1) },
        output: HookAlternatives,
      }),
    Effect.mapError(fail("assistHook")),
  );

  const rewrite = Effect.fn("ComposeAssist.rewrite")(
    (text: string, tone?: ReplyTone) =>
      assist.generate({
        task: "compose.rewrite",
        tone,
        instructions:
          "Rewrite this X post 3 different ways, each under 280 characters, same meaning, different angle or rhythm.",
        input: { text },
        output: RewriteVariants,
      }),
    Effect.mapError(fail("assistRewrite")),
  );

  const threadIdeas = Effect.fn("ComposeAssist.threadIdeas")(
    (topic: string, tone?: ReplyTone) =>
      assist.generate({
        task: "compose.threadIdeas",
        tone,
        instructions:
          "Propose 3 X thread outlines on the topic. Each has a hook (first post, under 280 characters) and 3 to 5 beats, one line each, that the following posts would cover.",
        input: { topic },
        output: ThreadIdeas,
      }),
    Effect.mapError(fail("assistThreadIdeas")),
  );

  const continueThread = Effect.fn("ComposeAssist.continueThread")(
    (blocks: Blocks, tone?: ReplyTone) =>
      assist.generate({
        task: "compose.continueThread",
        tone,
        instructions:
          "Write 3 different options for the next 2 posts of this X thread, each post under 280 characters, continuing the argument without repeating it.",
        input: { blocks },
        output: ContinuedBlocks,
      }),
    Effect.mapError(fail("assistContinue")),
  );

  const voiceMatch = Effect.fn("ComposeAssist.voiceMatch")(
    function* (blocks: Blocks) {
      const { handle } = yield* settings.get.pipe(Effect.mapError(fail("assistVoiceMatch")));
      const samples =
        handle === null
          ? []
          : (yield* x.userPosts(handle, { purpose: "compose.voiceMatch" })).items
              .filter((p) => !p.isRepost)
              .slice(0, 20)
              .map((p) => p.text);
      const result = yield* assist.generate({
        task: "compose.voiceMatch",
        instructions:
          "Score 0 to 1 how closely the draft matches the voice of the sample posts (tone, sentence length, vocabulary, formatting). With no samples, score against the account notes only. Add a one-line note on what to change.",
        input: { draft: blocks, samples },
        output: Schema.Struct({ score: Schema.Number, note: Schema.String }),
      });
      return { ...result, score: Math.min(1, Math.max(0, result.score)), samples: samples.length };
    },
    Effect.mapError(fail("assistVoiceMatch")),
  );

  return ComposeAssist.of({ improveHook, rewrite, threadIdeas, continueThread, voiceMatch });
});

export const layer = Layer.effect(ComposeAssist, make);
