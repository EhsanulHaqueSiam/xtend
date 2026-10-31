import type { Draft } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { rates } from "../../../test/fixtures";
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

const prices = {
  "costs.quote": () => Effect.succeed({ rates, quotes: [] }),
  "compose.quote": () => Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "m" }),
} as const;

const drafts = [
  draft("d1", "draft", "Three things I got wrong about Electron views", {
    blocks: [{ text: "Three things I got wrong about Electron views" }, { text: "1." }],
  }),
  draft("s1", "suggested", "Answer fast, under posts that are still climbing", {
    source: "ready-to-post: your best format (voice 0.8)",
  }),
  draft("q1", "queued", "Queued one", { scheduledAt: "2030-01-07T09:30:00.000Z" }),
];

it("shows drafts as a board, and dragging a draft onto Queued queues it", async () => {
  localStorage.removeItem("xtend:compose-view");
  const queued: string[] = [];
  await using screen = await render(<DraftsHome tab="drafts" onOpen={vi.fn()} onNew={vi.fn()} />, {
    service: {
      ...prices,
      "compose.draftsList": () => Effect.succeed({ drafts }),
      "plan.queue": ({ id }) => {
        queued.push(id);
        return Effect.succeed(drafts[0]!);
      },
    },
  });
  await expect.element(screen.getByRole("heading", { name: /^Automatic/ })).toBeVisible();
  const card = screen.getByRole("button", { name: /Three things I got wrong/ });
  await expect.element(card).toBeVisible();
  await card.dropTo(screen.getByRole("heading", { name: /^Queued/ }));
  await expect.poll(() => queued).toEqual(["d1"]);
});

it("lists the open section's drafts with their price, and opens or starts one", async () => {
  localStorage.setItem("xtend:compose-view", "list");
  const onOpen = vi.fn();
  const onNew = vi.fn();
  await using screen = await render(<DraftsHome tab="drafts" onOpen={onOpen} onNew={onNew} />, {
    service: {
      ...prices,
      "compose.draftsList": () => Effect.succeed({ drafts }),
    },
  });
  await expect.element(screen.getByRole("heading", { name: "Drafts" })).toBeVisible();
  const row = screen.getByRole("row").filter({ hasText: "Three things I got wrong" });
  // Two posts at the plain post price; the second post shows under the hook.
  await expect.element(row.getByText("1.", { exact: true })).toBeVisible();
  await expect.element(row.getByText("$0.03", { exact: true })).toBeVisible();
  expect(screen.getByText("Queued one").elements()).toHaveLength(0);

  await userEvent.click(
    screen.getByRole("button", { name: "Three things I got wrong about Electron views" }),
  );
  expect(onOpen).toHaveBeenCalledWith("d1");
  await userEvent.click(screen.getByRole("button", { name: "New draft" }));
  expect(onNew).toHaveBeenCalled();
});

it("lists what Library and rules wrote among your drafts, and queues one", async () => {
  localStorage.setItem("xtend:compose-view", "list");
  const queued: Array<string> = [];
  await using screen = await render(
    <DraftsHome tab="drafts" onOpen={() => {}} onNew={() => {}} />,
    {
      service: {
        ...prices,
        "compose.draftsList": () => Effect.succeed({ drafts }),
        "plan.queue": ({ id }) => {
          queued.push(id);
          return Effect.succeed(
            draft(id, "queued", "x", { scheduledAt: "2030-01-07T09:30:00.000Z" }),
          );
        },
      },
    },
  );
  await expect
    .element(screen.getByText("Ready to post · your best format (voice 0.8)"))
    .toBeVisible();
  // Queued drafts belong to Plan's queue, not here.
  expect(screen.getByText("Queued one").elements()).toHaveLength(0);
  const row = screen.getByRole("row").filter({ hasText: "Answer fast" });
  await userEvent.click(row.getByRole("button", { name: "Queue" }));
  await expect.poll(() => queued).toEqual(["s1"]);
  await expect.element(screen.getByText("Queued for the next slot")).toBeVisible();
});
