import { expect, it } from "vite-plus/test";

import { CHUNK_BYTES, chunkEnd, entriesJson } from "./flush.ts";

it("cuts chunks at the byte budget but always takes the first row", () => {
  const half = CHUNK_BYTES / 2;
  expect(
    chunkEnd([
      { id: 1, bytes: half },
      { id: 2, bytes: half },
      { id: 3, bytes: 1 },
    ]),
  ).toBe(2);
  expect(
    chunkEnd([
      { id: 7, bytes: CHUNK_BYTES * 3 },
      { id: 8, bytes: 1 },
    ]),
  ).toBe(7);
});

it("builds pool_flush's argument without re-encoding the bodies", () => {
  const body = '{"items":[{"post":{"postId":"1"}}]}';
  const json = entriesJson([{ install: "a", at: "2026-11-25T00:00:00.000Z", body }]);
  expect(JSON.parse(json)).toEqual([
    { install: "a", at: "2026-11-25T00:00:00.000Z", body: JSON.parse(body) },
  ]);
});
