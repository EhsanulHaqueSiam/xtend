import { expect, it } from "vite-plus/test";

import { isInstallId, readBatch } from "./batch.ts";

it("accepts a batch of posts and refuses the rest", () => {
  const post = {
    postId: "1",
    createdAt: "2026-11-25T00:00:00Z",
    author: { userId: "9", handle: "a" },
  };
  expect(readBatch({ items: [{ post }] })).toMatchObject({ items: [{ post: { postId: "1" } }] });
  expect(readBatch({ items: [{ post: { postId: "1" } }] })).toHaveProperty("error");
  expect(readBatch({ items: [] })).toEqual({ error: "items is empty" });
  expect(readBatch({ items: [{ post: { postId: 1 } }] })).toHaveProperty("error");
  expect(readBatch({})).toHaveProperty("error");
  expect(readBatch(null)).toHaveProperty("error");
});

it("only takes v4 uuids as install ids", () => {
  expect(isInstallId("3f2b8c1e-5d4a-4f6b-8c9d-0a1b2c3d4e5f")).toBe(true);
  expect(isInstallId("not-an-id")).toBe(false);
  expect(isInstallId(null)).toBe(false);
});

it("leaves out what Postgres would refuse, so one push cannot fail a flush", () => {
  const batch = readBatch({
    items: [
      {
        post: {
          postId: "1",
          text: "a\u0000b\ud800",
          createdAt: "2026-11-25T00:00:00Z",
          extra: { deep: [[[]]] },
          author: { userId: "9", handle: "a", followers: 1.5 },
        },
        metrics: { views: 1e300, likes: 3 },
      },
    ],
  });
  expect(JSON.parse(JSON.stringify(batch))).toEqual({
    items: [
      {
        post: {
          postId: "1",
          text: "ab\ufffd",
          createdAt: "2026-11-25T00:00:00.000Z",
          author: { userId: "9", handle: "a" },
        },
        metrics: { likes: 3 },
      },
    ],
  });
});
