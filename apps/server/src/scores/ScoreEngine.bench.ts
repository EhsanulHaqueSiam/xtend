import * as DateTime from "effect/DateTime";
import { expect, test } from "vite-plus/test";

import * as Seed from "../testing/seed.ts";
import * as ScoreEngine from "./ScoreEngine.ts";

// A score run reads FOLLOWER_PAGES pages: about 1,000 followers.
const followers = Array.from({ length: 1_000 }, (_, i) => Seed.follower(i));
const account = { followers: 6_700, following: 830 };
const now = DateTime.makeUnsafe(Seed.SEED_NOW);

test("ScoreEngine", async ({ bench }) => {
  expect(ScoreEngine.score(followers, account, now).scored).toHaveLength(ScoreEngine.SCORE_TOP_K);
  // Synchronous: the service's event loop, and every other client's answer, waits for it.
  await bench("score 1,000 followers", () => ScoreEngine.score(followers, account, now)).run();
});
