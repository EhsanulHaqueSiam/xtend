import type { EnginePost } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { avatar96, vsAuthor, xAge } from "./format";

const NOW = Date.parse("2026-10-31T12:00:00Z");

it("writes a post's age as X does: seconds, minutes, hours, then the date, with the year only when it differs", () => {
  expect(xAge("2026-10-31T11:59:30Z", NOW)).toBe("30s");
  expect(xAge("2026-10-31T11:32:00Z", NOW)).toBe("28m");
  expect(xAge("2026-10-30T20:00:00Z", NOW)).toBe("16h");
  expect(xAge("2026-10-28T09:00:00Z", NOW)).toBe("Oct 28");
  expect(xAge("2025-10-28T09:00:00Z", NOW)).toBe("Oct 28, 2025");
});

const post = (postId: string, userId: string, views: number | null) =>
  ({ postId, author: { userId }, metrics: { views } }) as unknown as EnginePost;

it("compares a post with the median of the author's other posts, and stays quiet with fewer than three", () => {
  const theo = [post("a", "1", 1000), post("b", "1", 2000), post("c", "1", 3000)];
  expect(vsAuthor(post("x", "1", 8000), theo)).toBe(4);
  expect(vsAuthor(post("x", "1", 8000), theo.slice(0, 2))).toBeNull();
  // Other authors and the post itself never count.
  expect(vsAuthor(post("a", "1", 1000), [...theo, post("z", "2", 9)])).toBeNull();
});

it("asks X for the 96px avatar instead of the 48px default", () => {
  expect(avatar96("https://pbs.twimg.com/profile_images/1/a_normal.jpg")).toBe(
    "https://pbs.twimg.com/profile_images/1/a_x96.jpg",
  );
});
