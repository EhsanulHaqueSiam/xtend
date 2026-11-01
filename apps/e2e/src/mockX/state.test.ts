import { expect, it } from "vite-plus/test";

import { renderEngineBatch } from "../../../desktop/src/xSession/engineBatch.ts";
import { createMockState } from "./state.ts";

it("answers with what the user's presses changed: a bookmark, its undo, a follow", () => {
  const state = createMockState();
  const read = (op: string, variables: Record<string, unknown>) =>
    renderEngineBatch(op, variables, JSON.parse(JSON.stringify(state.respond(op, variables))));
  const [id] = state.feed("following");
  const author = state.post(id!)!.author;

  state.write("CreateBookmark", { tweet_id: id }, "/home");
  const saved = read("Bookmarks", {});
  expect(saved.order[0]).toBe(id);
  expect(saved.posts.find((p) => p.postId === id)?.bookmarked).toBe(true);
  expect(read("HomeLatestTimeline", {}).posts.find((p) => p.postId === id)?.bookmarked).toBe(true);

  state.write("DeleteBookmark", { tweet_id: id }, "/home");
  expect(read("Bookmarks", {}).order).not.toContain(id);
  expect(read("HomeLatestTimeline", {}).posts.find((p) => p.postId === id)?.bookmarked).toBe(false);

  const following = read("UserByScreenName", { screen_name: author.handle }).users[0]!.youFollow;
  state.write(
    following ? "friendships/destroy" : "friendships/create",
    { user_id: author.userId },
    "/home",
  );
  expect(read("UserByScreenName", { screen_name: author.handle }).users[0]!.youFollow).toBe(
    !following,
  );
  expect(state.presses.map((p) => p.name)).toEqual([
    "CreateBookmark",
    "DeleteBookmark",
    following ? "friendships/destroy" : "friendships/create",
  ]);
});
