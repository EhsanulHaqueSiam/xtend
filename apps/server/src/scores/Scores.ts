import { type ScoreReport, ScoresError, type XFollower, type XTrend } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as XClient from "../x/XClient.ts";
import * as ScoreEngine from "./ScoreEngine.ts";
import * as ScoreStore from "./ScoreStore.ts";

/** Pages of followers one run reads; Costs prices a run from it. */
export const FOLLOWER_PAGES = 5;

export class Scores extends Context.Service<
  Scores,
  {
    readonly report: (handle: string) => Effect.Effect<ScoreReport, ScoresError>;
    /** Fetches followers and the profile, scores them, stores today's sample. */
    readonly run: (handle: string) => Effect.Effect<ScoreReport, ScoresError>;
    readonly trending: (country: string) => Effect.Effect<ReadonlyArray<XTrend>, ScoresError>;
  }
>()("xtend/scores/Scores") {}

const fail = (operation: string) => (cause: { readonly message: string }) =>
  new ScoresError({ operation, detail: cause.message });

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const store = yield* ScoreStore.ScoreStore;

  const report = Effect.fn("Scores.report")(function* (input: string) {
    const handle = input.toLowerCase();
    return {
      handle,
      latest: yield* store.latest(handle),
      history: yield* store.history(handle),
    } satisfies ScoreReport;
  });

  const run = Effect.fn("Scores.run")(
    function* (input: string) {
      const handle = input.toLowerCase();
      const purpose = "scores.run";
      const profile = yield* x.profile(handle, purpose);
      if (profile === null)
        return yield* new ScoresError({ operation: "run", detail: `@${handle} not found` });
      const followers: Array<XFollower> = [];
      let cursor: string | null = null;
      let pages = 0;
      for (; pages < FOLLOWER_PAGES; pages++) {
        const result: XClient.Page<XFollower> = yield* x.followers(handle, {
          purpose,
          ...(cursor === null ? {} : { cursor }),
        });
        followers.push(...result.items);
        cursor = result.nextCursor;
        if (cursor === null) {
          pages++;
          break;
        }
      }
      const now = yield* DateTime.now;
      const scored = ScoreEngine.score(followers, profile, now);
      yield* store.saveSample({
        handle,
        at: DateTime.formatIso(now),
        score: scored.score,
        tier: scored.tier,
        followers: profile.followers,
        sampled: followers.length,
        pages,
        botShare: scored.bot.botShare,
        topFollowers: scored.topFollowers,
        bot: scored.bot,
      });
      return yield* report(handle);
    },
    Effect.mapError(fail("run")),
  );

  const trending = Effect.fn("Scores.trending")(
    function* (country: string) {
      return yield* x.trending(country, "scores.trending");
    },
    Effect.mapError(fail("trending")),
  );

  return Scores.of({ report, run, trending });
});

export const layer = Layer.effect(Scores, make);
