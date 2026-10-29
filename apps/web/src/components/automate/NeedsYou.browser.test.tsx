import "../../index.css";

import * as Effect from "effect/Effect";
import type { PendingRequest } from "@xtend/contracts";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { NeedsYou, NeedsYouList } from "./NeedsYou";

const request: PendingRequest = {
  id: 7,
  ruleId: 1,
  ruleName: "thank reposters",
  subjectId: "repost:42",
  description: "@ada reposted 555; DM Ada",
  costUsd: 0.015,
  createdAt: "2026-10-23T08:00:00.000Z",
  status: "pending",
};

it("lists pending requests with their price on Approve, routes Approve and Skip, and takes a and s", async () => {
  const onApprove = vi.fn();
  const onDismiss = vi.fn();
  await using screen = await render(
    <NeedsYouList requests={[request]} busy={false} onApprove={onApprove} onDismiss={onDismiss} />,
  );
  await expect.element(screen.getByText(/^thank reposters/)).toBeVisible();
  await expect.element(screen.getByText("@ada reposted 555; DM Ada")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Approve $0.015" }));
  expect(onApprove).toHaveBeenCalledWith(7);
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onDismiss).toHaveBeenCalledWith(7);

  const card = screen.getByRole("listitem");
  (card.element() as HTMLElement).focus();
  await userEvent.keyboard("a");
  await userEvent.keyboard("s");
  expect(onApprove).toHaveBeenCalledTimes(2);
  expect(onDismiss).toHaveBeenCalledTimes(2);

  await screen.rerender(
    <NeedsYouList requests={[]} busy={false} onApprove={onApprove} onDismiss={onDismiss} />,
  );
  await expect.element(screen.getByText(/Nothing waiting/)).toBeVisible();
});

it("a and s act on the focused card only, keep the shell's letter keys out, and move focus on", async () => {
  const onApprove = vi.fn();
  const onDismiss = vi.fn();
  const second = { ...request, id: 8, description: "@bo reposted 556; DM Bo" };
  // What the shell's hotkeys see: they skip a key a card already took.
  const taken: Array<boolean> = [];
  const listen = (e: KeyboardEvent) => taken.push(e.defaultPrevented);
  window.addEventListener("keydown", listen);
  onTestFinished(() => window.removeEventListener("keydown", listen));
  const list = (requests: ReadonlyArray<PendingRequest>) => (
    <NeedsYouList requests={requests} busy={false} onApprove={onApprove} onDismiss={onDismiss} />
  );
  await using screen = await render(list([request, second]));
  const cards = screen.getByRole("listitem");
  (cards.nth(0).element() as HTMLElement).focus();
  await userEvent.keyboard("a");
  expect(onApprove.mock.calls).toEqual([[7]]);
  expect(taken).toEqual([true]);

  // The approved card leaves; focus lands on the one now in its place.
  await screen.rerender(list([second]));
  await expect.element(cards.nth(0)).toHaveFocus();
  await userEvent.keyboard("s");
  expect(onDismiss.mock.calls).toEqual([[8]]);
  expect(taken).toEqual([true, true]);
});

const postText =
  "Shipped the drafts board today. Drag a draft onto a day and it posts at that day's best hour.";
const previewed: PendingRequest = {
  ...request,
  ruleName: "Ship Learned 49",
  description: "@priyaships liked your post; DM Priya Nair",
  preview: {
    title: "DM Priya Nair",
    target: { label: "Priya Nair · @priyaships", href: "https://x.com/priyaships" },
    because: "@priyaships liked your post",
    post: { text: postText, href: "https://x.com/i/status/555" },
    message: "Hey Priya Nair, thanks for the like! Building anything right now?",
  },
};

it("expands the saved target, full post and resolved message in place, then approves with a", async () => {
  const approved: Array<number> = [];
  let open = [previewed];
  await using screen = await render(<NeedsYou />, {
    service: {
      "automate.pendingList": () => Effect.sync(() => open),
      "automate.runsList": () => Effect.succeed([]),
      "automate.pendingApprove": ({ id }) =>
        Effect.sync(() => {
          approved.push(id);
          open = [];
          return {
            id: 1,
            ruleId: 1,
            at: request.createdAt,
            subjectId: request.subjectId,
            status: "ok" as const,
            detail: "DM Priya Nair",
            costUsd: 0.015,
            xId: "42",
          };
        }),
    },
  });
  const summary = screen.getByRole("button", { name: "DM Priya Nair" });
  await expect.element(summary).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText(previewed.preview!.message!).elements()).toHaveLength(0);
  await userEvent.click(summary);
  await expect.element(summary).toHaveAttribute("aria-expanded", "true");
  await expect
    .element(screen.getByRole("link", { name: "Priya Nair · @priyaships ↗" }))
    .toHaveAttribute("href", "https://x.com/priyaships");
  await expect
    .element(screen.getByRole("link", { name: postText }))
    .toHaveAttribute("href", "https://x.com/i/status/555");
  await expect.element(screen.getByText(previewed.preview!.message!)).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Approve $0.015" })).toBeVisible();
  expect(approved).toEqual([]);
  await userEvent.click(summary);
  await expect.element(summary).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(summary);
  (screen.getByRole("listitem").element() as HTMLElement).focus();
  await userEvent.keyboard("a");
  await expect.element(screen.getByText(/^Nothing waiting/)).toBeVisible();
  expect(approved).toEqual([7]);
});

it("wraps a long message at panel width and leaves a named free action and its shortcuts available", async () => {
  const container = document.createElement("div");
  container.style.width = "440px";
  const skip = vi.fn();
  const listRequest = {
    ...previewed,
    id: 8,
    costUsd: 0,
    preview: { ...previewed.preview!, title: "Add Kofi Mensah to Founders", message: null },
  };
  await using screen = await render(
    <NeedsYouList
      requests={[
        {
          ...previewed,
          preview: {
            ...previewed.preview!,
            message: "Long message ".repeat(50) + "https://example.com/" + "x".repeat(300),
          },
        },
        listRequest,
      ]}
      busy={false}
      onApprove={vi.fn()}
      onDismiss={skip}
    />,
    { container },
  );
  await userEvent.click(screen.getByRole("button", { name: "DM Priya Nair" }));
  await expect.element(screen.getByText(/^Long message/)).toBeVisible();
  expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  await expect.element(screen.getByRole("button", { name: "Approve free" })).toBeVisible();
  (screen.getByRole("listitem").nth(1).element() as HTMLElement).focus();
  await userEvent.keyboard("s");
  expect(skip).toHaveBeenCalledWith(8);
});

it("explains missing previews for requests saved by an older service", async () => {
  await using screen = await render(
    <NeedsYouList requests={[request]} busy={false} onApprove={vi.fn()} onDismiss={vi.fn()} />,
  );
  await userEvent.click(screen.getByRole("button", { name: request.description }));
  await expect
    .element(screen.getByText(/This older request has no saved message preview/))
    .toBeVisible();
});
