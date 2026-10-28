import type { PendingRequest } from "@xtend/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { NeedsYouList } from "./NeedsYou";

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
