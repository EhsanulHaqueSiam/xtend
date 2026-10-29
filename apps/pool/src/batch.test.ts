import { expect, it } from "vite-plus/test";

import { isInstallId, readBatch } from "./batch.ts";

it("accepts a batch of posts and refuses the rest", () => {
  expect(readBatch({ items: [{ post: { postId: "1" } }] })).toEqual({
    items: [{ post: { postId: "1" } }],
  });
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
