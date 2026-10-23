import type { Draft, PendingRequest } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DraftsHome } from "./DraftsHome";

const draft = (
  id: string,
  status: Draft["status"],
  text: string,
  extra: Partial<Draft> = {},
): Draft => ({
  id,
  kind: "thread",
  status,
  title: "",
  body: "",
  blocks: [{ text }],
  replySettings: "everyone",
  poll: null,
  hideLinkPreviews: false,
  linkPreviewNote: null,
  threadDelaySeconds: 0,
  source: null,
  quoteUrl: null,
  replyToPostId: null,
  articleId: null,
  media: [],
  scheduledAt: null,
  postIds: [],
  error: null,
  attempts: 0,
  postedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  ...extra,
});

const pending: PendingRequest = {
  id: 7,
  ruleId: 1,
  ruleName: "Reply to fast risers",
  subjectId: "1",
  description: "Reply to @levelsio's post climbing at 4k views an hour",
  costUsd: 0.015,
  createdAt: "2026-10-23T00:00:00.000Z",
  status: "pending",
};

const drafts = [
  draft("d1", "draft", "Three things I got wrong about Electron views", {
    blocks: [{ text: "Three things I got wrong about Electron views" }, { text: "1." }],
  }),
  draft("s1", "suggested", "Answer fast, under posts that are still climbing", {
    source: "ready-to-post: your best format (voice 0.8)",
  }),
  draft("q1", "queued", "Queued one", { scheduledAt: "2030-01-07T09:30:00.000Z" }),
];

it("groups drafts by where they are, counts each tab, and opens or starts one", async () => {
  const onTab = vi.fn();
  const onOpen = vi.fn();
  const onNew = vi.fn();
  await using screen = await render(
    <DraftsHome tab="drafts" handle="siamships" onTab={onTab} onOpen={onOpen} onNew={onNew} />,
    {
      service: {
        "compose.draftsList": () => Effect.succeed({ drafts }),
        "automate.pendingList": () => Effect.succeed([pending]),
      },
    },
  );
  await expect
    .element(screen.getByText("Three things I got wrong about Electron views"))
    .toBeVisible();
  await expect.element(screen.getByText("Show this thread · 2 posts")).toBeVisible();
  // Suggested drafts and ask-first requests both count under Automatic.
  await expect.element(screen.getByRole("button", { name: "Automatic 2" })).toBeVisible();
  expect(screen.getByText("Queued one").elements()).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(onOpen).toHaveBeenCalledWith("d1");
  await userEvent.click(screen.getByText("What's the thread?"));
  expect(onNew).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Queued 1" }));
  expect(onTab).toHaveBeenCalledWith("queued");
});

it("shows what automation wrote and asks before a paid action, then queues a suggestion", async () => {
  const queued: Array<string> = [];
  const decided: Array<number> = [];
  await using screen = await render(
    <DraftsHome
      tab="automatic"
      handle="siamships"
      onTab={() => {}}
      onOpen={() => {}}
      onNew={() => {}}
    />,
    {
      service: {
        "compose.draftsList": () => Effect.succeed({ drafts }),
        "automate.pendingList": () => Effect.succeed([pending]),
        "automate.pendingApprove": ({ id }) => {
          decided.push(id);
          return Effect.succeed({
            id: 1,
            ruleId: 1,
            at: "2026-10-23T00:00:00.000Z",
            subjectId: "1",
            status: "ok" as const,
            detail: "replied",
            costUsd: 0.015,
            xId: null,
          });
        },
        "plan.queue": ({ id }) => {
          queued.push(id);
          return Effect.succeed(
            draft(id, "queued", "x", { scheduledAt: "2030-01-07T09:30:00.000Z" }),
          );
        },
      },
    },
  );
  await expect.element(screen.getByText("Reply to fast risers")).toBeVisible();
  await expect
    .element(screen.getByText("Ready to post · your best format (voice 0.8)"))
    .toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Approve · $0.015" }));
  await expect.poll(() => decided).toEqual([7]);
  await userEvent.click(screen.getByRole("button", { name: "Queue" }));
  await expect.poll(() => queued).toEqual(["s1"]);
  await expect.element(screen.getByText("Queued for the next slot")).toBeVisible();
});
