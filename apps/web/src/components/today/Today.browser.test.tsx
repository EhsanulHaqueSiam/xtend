import type { PendingRequest } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { draft, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Today } from "./Today";

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

it("gathers what waits on you and opens each item in the tool that owns it", async () => {
  await using screen = await render(<Today />, {
    service: {
      "compose.draftsList": () =>
        Effect.succeed({
          drafts: [
            draft("d1", "failed", { blocks: [{ text: "Revenue update" }], error: "Rate limited" }),
            draft("d2", "draft"),
          ],
        }),
      "automate.pendingList": () => Effect.succeed([request]),
      "engage.mentions": () =>
        Effect.succeed({
          mentions: [
            { post: xPost("1", "@siam open one"), source: "session", handled: false },
            { post: xPost("2", "@siam done one"), source: "session", handled: true },
          ],
          apiError: null,
        }),
      "plan.slotsGet": () => Effect.succeed({ slots: [] }),
      "library.picksGet": () =>
        Effect.succeed({ day: "2026-10-31", keywords: [], pending: [], picks: [] }),
    },
  });
  await expect.element(screen.getByText("2 waiting")).toBeVisible();
  await expect.element(screen.getByText("Rate limited")).toBeVisible();
  await expect.element(screen.getByText("@ada reposted 555; DM Ada")).toBeVisible();
  // Open mentions only; a handled one stays in Engage.
  await expect.element(screen.getByText("1 open")).toBeVisible();
  await expect.element(screen.getByText("@siam done one")).not.toBeInTheDocument();
  // A draft that is only a draft waits on nobody.
  await expect.element(screen.getByText("Nothing queued.")).toBeVisible();

  await userEvent.click(screen.getByRole("link", { name: /Revenue update/ }));
  expect(screen.router?.state.location.href).toBe("/compose?draft=d1");
});
