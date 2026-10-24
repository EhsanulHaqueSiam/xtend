// @effect-diagnostics globalFetch:off -- Response is only the fake treg's answer object; nothing is fetched.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
import { XApiError } from "@xtend/contracts";

import * as Budget from "../budget/Budget.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Treg from "./Treg.ts";
import * as XClient from "./XClient.ts";

// A treg stub that answers the search endpoint with one anyapi-shaped row.
const tregStub = Layer.succeed(Treg.Treg)({
  isCached: () => Effect.succeed(false),
  call: (input) =>
    Effect.succeed({
      status: 200,
      cached: false,
      costUsd: 0.0004,
      body:
        input.endpoint === "anyapi.x.search.posts"
          ? {
              output: {
                data: {
                  items: [
                    {
                      id: "2112103712584090069",
                      url: "https://x.com/i/web/status/2112103712584090069",
                      text: "Save this https://t.co/abc",
                      createdUtc: 1792399740,
                      lang: "ja",
                      isReply: false,
                      authorId: "2042103180478001153",
                      authorUsername: "studio_dev",
                      authorName: "Studio",
                      authorFollowers: 42713,
                      authorVerified: true,
                      media: [{ type: "video" }],
                      likeCount: 2025,
                      retweetCount: 207,
                      replyCount: 12,
                      quoteCount: 18,
                      bookmarkCount: 2775,
                      viewCount: 161377,
                    },
                  ],
                  nextCursor: "cur_1",
                },
              },
            }
          : {},
    }),
});

const layer = Layer.effect(XClient.XClient, XClient.make).pipe(Layer.provide(tregStub));

/** An XClient over a treg that answers each endpoint with a fixed body. */
const answering = (bodies: Record<string, unknown>) =>
  Layer.effect(XClient.XClient, XClient.make).pipe(
    Layer.provide(
      Layer.succeed(Treg.Treg)({
        isCached: () => Effect.succeed(false),
        call: (input) =>
          Effect.succeed({ status: 200, cached: false, costUsd: 0, body: bodies[input.endpoint] }),
      }),
    ),
  );

const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: "hello",
  createdUtc: 1792399740,
  authorId: "10",
  authorUsername: "studio_dev",
  ...extra,
});

describe("XClient", () => {
  it.effect("normalizes an anyapi search row into an XPost", () =>
    Effect.gen(function* () {
      const x = yield* XClient.XClient;
      const page = yield* x.searchPosts("graph tools", { purpose: "test" });
      expect(page.nextCursor).toBe("cur_1");
      expect(page.items).toHaveLength(1);
      const post = page.items[0]!;
      expect(post.author.handle).toBe("studio_dev");
      expect(post.hasMedia).toBe(true);
      expect(post.hasLink).toBe(true);
      expect(post.metrics).toEqual({
        views: 161377,
        likes: 2025,
        reposts: 207,
        replies: 12,
        quotes: 18,
        bookmarks: 2775,
      });
      expect(post.createdAt).toBe("2026-10-19T08:49:00.000Z");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("drops provider rows that miss the contract instead of failing the whole page", () =>
    Effect.gen(function* () {
      const x = yield* XClient.XClient;
      const page = yield* x.searchPosts("q", { purpose: "test" });
      expect(page.items.map((p) => p.postId)).toEqual(["1"]);
      // Found, but without an id the profile cannot be stored or sent: same as not found.
      expect(yield* x.profile("ghost", "test")).toBeNull();
      const followers = yield* x.followers("levelsio", { purpose: "test" });
      expect(followers.items.map((f) => f.handle)).toEqual(["kept"]);
    }).pipe(
      Effect.provide(
        answering({
          "anyapi.x.search.posts": {
            output: {
              data: {
                items: [
                  row("1", {}),
                  row("2", { authorId: undefined }),
                  row("3", { authorFollowers: 1.5 }),
                  row("4", { createdUtc: 1e20 }),
                ],
              },
            },
          },
          "anyapi.x.user.profile": { output: { found: true, data: { handle: "ghost" } } },
          "tikhub.x.twitter-web-fetch-user-followers": {
            data: {
              followers: [
                { rest_id: "5", screen_name: "kept", followers_count: 1 },
                { screen_name: "noid" },
              ],
            },
          },
        }),
      ),
    ),
  );

  it.effect("reads no X connection from a refusal, but not from a rate limit or an outage", () =>
    Effect.gen(function* () {
      const meWhenTreg = (status: number) =>
        Effect.flatMap(XClient.XClient, (x) => x.me("test")).pipe(
          Effect.provide(
            Layer.effect(XClient.XClient, XClient.make).pipe(
              Layer.provide(
                Layer.succeed(Treg.Treg)({
                  isCached: () => Effect.succeed(false),
                  call: (input) =>
                    new XApiError({
                      endpoint: input.endpoint,
                      reason: "provider",
                      status,
                      detail: "",
                    }),
                }),
              ),
            ),
          ),
        );
      expect(yield* meWhenTreg(404)).toBeNull();
      expect((yield* Effect.flip(meWhenTreg(429))).status).toBe(429);
      expect((yield* Effect.flip(meWhenTreg(502))).status).toBe(502);
    }),
  );

  it("prices a post with a link at X's URL rate, but not one that merely names Node.js", () => {
    expect(XClient.postCostUsd("plain text")).toBe(0.015);
    expect(XClient.postCostUsd("see xtend.app")).toBe(0.2);
    expect(XClient.postCostUsd("https://x.com/a")).toBe(0.2);
    expect(XClient.postCostUsd("I ship Node.js and React.tsx things")).toBe(0.015);
  });
});

// The real Treg and its read cache over a fake treg, so a probe is checked against the key and
// age the call itself writes.
delete process.env["XTEND_TREG_TOKEN"];
const httpPaths: Array<string> = [];
const layerCache = Layer.effect(XClient.XClient, XClient.make).pipe(
  Layer.provideMerge(Treg.layer),
  Layer.provideMerge(Budget.layer),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) => {
          const path = new URL(request.url).pathname;
          httpPaths.push(path);
          const body = path.endsWith("/2/users/me")
            ? { data: { id: "77", username: "siam", name: "Siam" } }
            : path.includes("followers")
              ? { data: { followers: [] } }
              : { data: [] };
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body))),
          );
        }),
      ),
      FileSystem.layerNoop({}),
      Path.layer,
    ),
  ),
);
const connect = Effect.flatMap(SettingsStore.SettingsStore, (s) =>
  s.update({ tregToken: "trg_a", monthlyBudgetUsd: 1 }),
);

describe("XClient cache probes", () => {
  it.effect("probe the mentions page a refresh after that id reads, not the first page", () =>
    Effect.gen(function* () {
      yield* connect;
      const x = yield* XClient.XClient;
      yield* x.mentions({ purpose: "test", sinceId: "12" });
      expect(yield* x.cached.mentions("12")).toBe(true);
      expect(yield* x.cached.mentions()).toBe(false);
      expect(yield* x.cached.mentions("15")).toBe(false);
    }).pipe(Effect.provide(layerCache)),
  );

  it.effect(
    "let a new-follower check read X again within minutes; a score run keeps 12 hours",
    () =>
      Effect.gen(function* () {
        yield* connect;
        const x = yield* XClient.XClient;
        yield* x.followers("Siam", { purpose: "test", fresh: true });
        yield* TestClock.adjust("11 minutes");
        expect(yield* x.cached.followers("siam", true)).toBe(false);
        expect(yield* x.cached.followers("siam")).toBe(true);

        httpPaths.length = 0;
        expect((yield* x.followers("siam", { purpose: "test" })).fromCache).toBe(true);
        expect((yield* x.followers("siam", { purpose: "test", fresh: true })).fromCache).toBe(
          false,
        );
        expect(httpPaths).toHaveLength(1);
        // A second click straight after is served from what the first one paid for.
        expect((yield* x.followers("siam", { purpose: "test", fresh: true })).fromCache).toBe(true);
      }).pipe(Effect.provide(layerCache)),
  );
});
