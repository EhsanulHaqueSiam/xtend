import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { graphqlCall, insideRepo } from "./cdp.mjs";

it("decodes X's GraphQL operation and variables from GET and POST requests", () => {
  const variables = { userId: "44196397", count: 20 };
  const get = `https://x.com/i/api/graphql/abc123/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=%7B%7D`;
  expect(graphqlCall(get)).toEqual({ op: "UserTweets", variables });
  const post = JSON.stringify({ variables, queryId: "abc123" });
  expect(graphqlCall("https://x.com/i/api/graphql/abc123/HomeTimeline", post)).toEqual({
    op: "HomeTimeline",
    variables,
  });
  // A body that is not JSON still names the call.
  expect(graphqlCall("https://x.com/i/api/graphql/abc123/HomeTimeline", "a=b")).toEqual({
    op: "HomeTimeline",
    variables: null,
  });
  expect(graphqlCall("https://x.com/i/api/1.1/jot/client_event.json")).toBe(undefined);
  expect(graphqlCall("https://abs.twimg.com/responsive-web/client-web/main.js")).toBe(undefined);
});

it("refuses a bodies directory inside any git checkout, existing or not, symlinked or not", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-cdp-"));
  NodeFS.mkdirSync(NodePath.join(dir, "repo", ".git"), { recursive: true });
  // A linked worktree's .git is a file.
  NodeFS.mkdirSync(NodePath.join(dir, "worktree"));
  NodeFS.writeFileSync(NodePath.join(dir, "worktree", ".git"), "gitdir: elsewhere\n");
  expect(insideRepo(NodePath.join(dir, "repo", "bodies", "new"))).toBe(true);
  expect(insideRepo(NodePath.join(dir, "worktree", "out"))).toBe(true);
  expect(insideRepo(NodePath.join(dir, "outside", "bodies"))).toBe(false);
  // A path outside by its spelling but inside by its real path.
  NodeFS.symlinkSync(NodePath.join(dir, "repo"), NodePath.join(dir, "capture"));
  expect(insideRepo(NodePath.join(dir, "capture", "docs", "new"))).toBe(true);
});
