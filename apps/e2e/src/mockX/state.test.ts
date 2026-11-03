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

it("answers X's folder dialogs and rows as X does, read back by the capture, and no folders without X's claim", () => {
  const state = createMockState();
  const read = (op: string, variables: Record<string, unknown>) =>
    renderEngineBatch(op, variables, JSON.parse(JSON.stringify(state.respond(op, variables))));
  const did = (op: string, variables: Record<string, unknown>) =>
    renderEngineBatch(
      op,
      variables,
      JSON.parse(JSON.stringify(state.write(op, variables, "/i/bookmarks"))),
    ).bookmarkFolders;
  const [reading] = state.folders();
  const [id] = state.feed("following");

  expect(did("createBookmarkFolder", { name: "Recipes" })).toEqual({
    kind: "saved",
    folder: { folderId: "800000000101", name: "Recipes", imageUrl: null },
  });
  expect(
    did("bookmarkTweetToFolder", { bookmark_collection_id: reading!.folderId, tweet_id: id }),
  ).toEqual({
    kind: "post",
    folderId: reading!.folderId,
    postId: id,
    added: true,
  });
  expect(
    read("BookmarkFolderTimeline", { bookmark_collection_id: reading!.folderId }).order[0],
  ).toBe(id);
  expect(did("DeleteBookmarkFolder", { bookmark_collection_id: "800000000101" })).toEqual({
    kind: "deleted",
    folderId: "800000000101",
  });
  const listed = read("BookmarkFoldersSlice", {}).bookmarkFolders;
  expect(listed?.kind === "list" && listed.folders.map((f) => f.name)).toEqual([
    "Reading list",
    "Launch ideas",
  ]);
  expect(read("GetUserClaims", {}).claims).toEqual([
    "subscriptions_feature_1002",
    "subscriptions_feature_account_analytics",
  ]);

  state.setPremium(false);
  expect(read("GetUserClaims", {}).claims).toEqual([]);
  expect(read("BookmarkFoldersSlice", {}).bookmarkFolders).toBeUndefined();
});
