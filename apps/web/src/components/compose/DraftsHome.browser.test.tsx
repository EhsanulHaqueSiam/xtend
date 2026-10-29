import {
  AutomateError,
  ComposeError,
  type Draft,
  type PendingRequest,
  type XtendEvent,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
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
      "automate.pendingList": () => Effect.succeed([]),
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
      "automate.pendingList": () => Effect.succeed([pending]),
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

it("shows what automation wrote and prices an ask-first action, then queues a suggestion", async () => {
  const queued: Array<string> = [];
  const decided: Array<number> = [];
  await using screen = await render(
    <DraftsHome tab="automatic" onOpen={() => {}} onNew={() => {}} />,
    {
      service: {
        ...prices,
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
  // The paid approval carries its price on the button itself.
  const approve = screen.getByRole("button", { name: /^Approve/ });
  await expect.element(approve).toBeVisible();
  expect(approve.element().textContent).toContain("$0.015");
  await userEvent.click(approve);
  await expect.poll(() => decided).toEqual([7]);
  await userEvent.click(screen.getByRole("button", { name: "Queue" }));
  await expect.poll(() => queued).toEqual(["s1"]);
  await expect.element(screen.getByText("Queued for the next slot")).toBeVisible();
});

it("shows why a draft failed, retries it only when asked, and says when an action is refused", async () => {
  const uncertain = draft("f1", "failed", "Launch thread", {
    error: "Post 2 may already be on X (timeout); check your profile before retrying",
    postIds: ["11"],
  });
  const queued: Array<string> = [];
  const deleted: Array<string> = [];
  await using screen = await render(
    <DraftsHome tab="failed" onOpen={() => {}} onNew={() => {}} />,
    {
      service: {
        ...prices,
        "compose.draftsList": () => Effect.succeed({ drafts: [uncertain] }),
        "automate.pendingList": () => Effect.succeed([]),
        "plan.queue": ({ id }) => {
          queued.push(id);
          return Effect.succeed(draft(id, "queued", "Launch thread"));
        },
        "compose.draftDelete": ({ id }) => {
          deleted.push(id);
          return Effect.fail(new ComposeError({ operation: "remove", detail: "Draft is posting" }));
        },
      },
    },
  );
  await expect.element(screen.getByText(uncertain.error!)).toBeVisible();
  // Nothing requeues it on its own; the user checks X first.
  expect(queued).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Retry at next slot" }));
  await expect.poll(() => queued).toEqual(["f1"]);

  // Delete names the draft and does nothing until the user agrees.
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(confirm).toHaveBeenCalledWith('Delete "Launch thread"? This cannot be undone.');
  expect(deleted).toEqual([]);
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  confirm.mockRestore();
  await expect.poll(() => deleted).toEqual(["f1"]);
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Failed: Compose remove failed: Draft is posting");
});

it("offers nothing on a draft mid-publish and moves it on when its status changes", async () => {
  let rows = [draft("p1", "posting", "Going out now")];
  let changed = () => {};
  const status = new Promise<void>((resolve) => (changed = resolve));
  const event: XtendEvent = {
    type: "draft_status_changed",
    at: "2026-10-23T09:31:00.000Z",
    payload: { draftId: "p1", status: "posted" },
  };
  await using screen = await render(
    <DraftsHome tab="queued" onOpen={() => {}} onNew={() => {}} />,
    {
      service: {
        ...prices,
        "compose.draftsList": () => Effect.sync(() => ({ drafts: rows })),
        "automate.pendingList": () => Effect.succeed([]),
        "events.subscribe": () =>
          Stream.fromEffect(Effect.promise(() => status).pipe(Effect.as(event))).pipe(
            Stream.concat(Stream.never),
          ),
      },
    },
  );
  await expect.element(screen.getByText("posting", { exact: true })).toBeVisible();
  for (const action of ["Edit", "Delete", "Unschedule", "Queue"])
    expect(screen.getByRole("button", { name: action, exact: true }).elements()).toHaveLength(0);

  rows = [draft("p1", "posted", "Going out now", { postIds: ["41"] })];
  changed();
  await expect.element(screen.getByText("Going out now")).not.toBeInTheDocument();
  await expect.element(screen.getByText(/^Nothing queued\./)).toBeVisible();
});

it("says the ask-first list failed instead of calling Automatic empty", async () => {
  await using screen = await render(
    <DraftsHome tab="automatic" onOpen={() => {}} onNew={() => {}} />,
    {
      service: {
        ...prices,
        "compose.draftsList": () => Effect.succeed({ drafts: [] }),
        "automate.pendingList": () =>
          Effect.fail(
            new AutomateError({ operation: "pendingList", detail: "locked", cause: null }),
          ),
      },
    },
  );
  await expect
    .element(screen.getByText("Automate failed during pendingList: locked"))
    .toBeVisible();
  expect(screen.getByText(/^Nothing waiting\./).elements()).toHaveLength(0);
});
