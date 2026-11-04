import type { Draft, DraftPatch } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { installFakeBridge } from "../../../test/fakeBridge";

// The day beside every X screen reads other areas' rpcs; this screen's tests are about the editor.
vi.mock("../shell/HomeCompanion", () => ({ DayGlance: () => null }));

// Inside the desktop app with session actions on, where Publish now can press X's own editor.
// Everything that reads isElectron loads after the bridge exists.
installFakeBridge();
const { draft, quoting, settings } = await import("../../../test/fixtures");
const { render } = await import("../../../test/render");
const { ArticleEditor } = await import("./ArticleEditor");
delete window.desktopBridge;

const article = (extra: Partial<Draft> = {}) =>
  draft("a1", "draft", {
    kind: "article",
    blocks: [],
    title: "Two plans",
    body: "It worked.",
    ...extra,
  });

const service = (rows: () => ReadonlyArray<Draft>, extra: FakeService = {}): FakeService => ({
  "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
  "compose.draftsList": () => Effect.sync(() => ({ drafts: rows() })),
  "compose.quote": () => Effect.succeed({ articleUsd: 0.005, coverUsd: 0.003, coverModel: "flux" }),
  "compose.context": () =>
    Effect.succeed({ nextSlot: null, bestHours: [], desktopConnected: true }),
  "costs.quote": quoting(() => ({ usd: 0, cached: false })),
  ...extra,
});

const editor = (draftId?: string) => (
  <ArticleEditor draftId={draftId} onOpen={() => {}} onBack={() => {}} />
);

/** Selects `text` inside the body block that shows it, as a drag over it would. */
const select = (text: string) => {
  const block = [...document.querySelectorAll<HTMLElement>("[data-block]")].find((b) =>
    b.textContent?.includes(text),
  )!;
  const node = [...block.childNodes].find((n) => n.textContent?.includes(text))!;
  const leaf = node.nodeType === Node.TEXT_NODE ? node : node.firstChild!;
  const at = leaf.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(leaf, at);
  range.setEnd(leaf, at + text.length);
  block.focus();
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
};

it("writes in X's own blocks: an In-Text Shortcut, Enter for the next block, and bold", async () => {
  const saved: Array<DraftPatch> = [];
  await using screen = await render(editor(), {
    service: service(() => [], {
      "compose.draftCreate": (patch) => {
        saved.push(patch);
        return Effect.succeed(article({ title: patch.title ?? "", body: patch.body ?? "" }));
      },
      "compose.draftUpdate": ({ id, patch }) => {
        saved.push(patch);
        return Effect.succeed(article({ id, title: patch.title ?? "", body: patch.body ?? "" }));
      },
    }),
  });
  await userEvent.fill(screen.getByLabelText("Article Title"), "Two plans");
  const body = screen.getByRole("textbox", { name: "Article body" });
  await userEvent.click(body);
  // X's "#" then a space makes the block a Heading.
  await userEvent.keyboard("# Why");
  await expect.element(body).toHaveAttribute("data-kind", "heading");
  await userEvent.keyboard("{Enter}It worked");
  const next = screen.getByRole("textbox", { name: "Block 2" });
  await expect.element(next).toHaveAttribute("data-kind", "body");
  select("worked");
  await userEvent.click(
    screen.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }),
  );
  await expect
    .poll(() => saved.at(-1))
    .toMatchObject({ kind: "article", title: "Two plans", body: "# Why\n\nIt **worked**" });
});

it("prices the three ways out, and Publish now sends who can reply and the caption through X's own Publish", async () => {
  const calls: Array<string> = [];
  let row = article();
  await using screen = await render(editor("a1"), {
    service: service(() => [row], {
      "compose.draftUpdate": ({ patch }) => {
        calls.push(`save ${patch.replySettings}`);
        row = { ...row, replySettings: patch.replySettings ?? row.replySettings };
        return Effect.succeed(row);
      },
      "compose.postNow": (input) => {
        calls.push(`publish ${JSON.stringify(input)}`);
        return Effect.succeed({ ...row, status: "posted" as const, postIds: ["19"] });
      },
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
  const ways = page.getByRole("list", { name: "Ways out" });
  await expect.element(ways.getByRole("button", { name: /Publish now.*free/ })).toBeEnabled();
  // A draft and a publish request through the X API, $0.005 each.
  await expect.element(ways.getByRole("button", { name: /^Queue.*\$0\.01$/ })).toBeEnabled();
  await expect.element(ways.getByRole("button", { name: /^Schedule.*\$0\.01$/ })).toBeEnabled();
  await userEvent.click(ways.getByRole("button", { name: /Publish now/ }));
  await userEvent.selectOptions(
    page.getByLabelText("Choose who can reply to this Article"),
    "Accounts you follow",
  );
  await userEvent.fill(page.getByLabelText("Add a caption to your article"), "The whole test");
  await userEvent.click(page.getByRole("button", { name: /^Publish\s*free$/ }));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Success! Your Article has been published");
  // The reply setting is saved on the draft before X's editor reads it.
  expect(calls).toEqual([
    "save following",
    `publish ${JSON.stringify({ id: "a1", sessionOnly: true, caption: "The whole test" })}`,
  ]);
});

it("holds back what X would refuse, in X's words, and what each lane cannot carry", async () => {
  {
    await using screen = await render(editor("a1"), {
      service: service(() => [article({ title: "" })]),
    });
    await expect
      .element(screen.getByText("Your Article needs a title before publishing.").first())
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Queue", exact: true })).toBeDisabled();
  }
  const cover = {
    id: "m1",
    blockIndex: 0,
    path: "/m/cover.webp",
    kind: "image" as const,
    alt: "",
    position: 0,
  };
  await using screen = await render(editor("a1"), {
    service: service(() => [article({ body: "It worked.\n\n---", media: [cover] })]),
  });
  // X's paste drops a divider; the X API lane has no media upload, so no way out is open.
  await expect.element(screen.getByText(/go out through the X API/).first()).toBeVisible();
  await expect
    .element(screen.getByText(/A cover goes out only with Publish now/).first())
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Queue", exact: true })).toBeDisabled();
});

it("rewrites the selected passage from the bubble over it, at the assist's price, and Use puts it in place", async () => {
  const asked: Array<unknown> = [];
  const saved: Array<string | undefined> = [];
  let row = article({ body: "Signups went up 18% and nobody wrote in." });
  await using screen = await render(editor("a1"), {
    service: service(() => [row], {
      "costs.quote": quoting(() => ({ usd: 0.002, cached: false })),
      "compose.assistArticle": (input) => {
        asked.push(input);
        return Effect.succeed({ options: ["Signups rose 18%"] });
      },
      "compose.draftUpdate": ({ patch }) => {
        saved.push(patch.body);
        row = { ...row, body: patch.body ?? row.body };
        return Effect.succeed(row);
      },
    }),
  });
  await expect
    .element(screen.getByRole("textbox", { name: "Article body" }))
    .toHaveTextContent("Signups went up 18% and nobody wrote in.");
  select("Signups went up 18%");
  const bubble = screen.getByRole("toolbar", { name: "Selection" });
  await expect.element(bubble.getByRole("button", { name: /Rewrite\s*\$0\.002/ })).toBeVisible();
  await userEvent.click(bubble.getByRole("button", { name: /Rewrite/ }));
  await expect
    .poll(() => asked)
    .toEqual([
      {
        mode: "rewrite",
        title: "Two plans",
        body: "Signups went up 18% and nobody wrote in.",
        text: "Signups went up 18%",
      },
    ]);
  await userEvent.click(
    screen.getByRole("list", { name: "Suggestions" }).getByRole("button", { name: "Use" }),
  );
  await expect.poll(() => saved.at(-1)).toBe("Signups rose 18% and nobody wrote in.");
});

it("offers the X API inline, at its price, when X's editor cannot take the article", async () => {
  await using screen = await render(editor("a1"), {
    service: service(() => [article({ body: "It worked.\n\n---" })]),
  });
  await userEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
  const ways = page.getByRole("list", { name: "Ways out" });
  await expect
    .element(ways.getByRole("button", { name: /Publish now.*Insert menu/ }))
    .toBeDisabled();
  await expect
    .element(ways.getByRole("button", { name: /^Publish now through the X API.*\$0\.01$/ }))
    .toBeEnabled();
});

it("shows a publish failure in X's column, the one stored from last time included, in focus mode too", async () => {
  await using screen = await render(editor("a1"), {
    service: service(() => [
      article({ status: "failed", error: "x.com did not confirm the Article" }),
    ]),
  });
  const column = screen.container.querySelector<HTMLElement>('[data-x="column"]')!;
  await userEvent.click(screen.getByRole("button", { name: "Focus mode" }));
  await expect
    .element(page.elementLocator(column).getByRole("status"))
    .toHaveTextContent("Failed: x.com did not confirm the Article");
});

it("follows the draft as the service moves it: published by the scheduler while open, it locks", async () => {
  let publish = () => {};
  const published = new Promise<void>((resolve) => (publish = resolve));
  const event = {
    type: "draft_status_changed" as const,
    at: "2030-01-07T09:31:00.000Z",
    payload: { draftId: "a1", status: "posted" },
  };
  let row = article({ status: "queued", scheduledAt: "2030-01-07T09:30:00.000Z" });
  await using screen = await render(editor("a1"), {
    service: service(() => [row], {
      "events.subscribe": () =>
        Stream.fromEffect(Effect.promise(() => published).pipe(Effect.as(event))).pipe(
          Stream.concat(Stream.never),
        ),
    }),
  });
  await expect.element(screen.getByRole("button", { name: "Unschedule" })).toBeVisible();
  row = { ...row, status: "posted", postIds: ["19"], updatedAt: "2030-01-07T09:31:00.000Z" };
  publish();
  await expect.element(screen.getByText("Published", { exact: true })).toBeVisible();
  await expect.element(screen.getByLabelText("Article Title")).toHaveAttribute("readonly");
});

it("drops its own failure once the service lists a newer outcome: published from Plan after it failed here", async () => {
  let land = () => {};
  const landed = new Promise<void>((resolve) => (land = resolve));
  const event = {
    type: "draft_status_changed" as const,
    at: "2030-01-07T09:40:00.000Z",
    payload: { draftId: "a1", status: "posted" },
  };
  let row = article();
  await using screen = await render(editor("a1"), {
    service: service(() => [row], {
      "compose.postNow": () => {
        row = {
          ...row,
          status: "failed",
          error: "x.com kept Publish off",
          updatedAt: "2030-01-07T09:30:00.000Z",
        };
        return Effect.succeed(row);
      },
      "events.subscribe": () =>
        Stream.fromEffect(Effect.promise(() => landed).pipe(Effect.as(event))).pipe(
          Stream.concat(Stream.never),
        ),
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
  await userEvent.click(
    page
      .getByRole("list", { name: "Ways out" })
      .getByRole("button", { name: /Opens X.s Publish dialog/ }),
  );
  await userEvent.click(page.getByRole("button", { name: /^Publish\s*free$/ }));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Failed: x.com kept Publish off");
  // Plan's Post now publishes it through the X API while the editor is open.
  row = {
    ...row,
    status: "posted",
    error: null,
    postIds: ["19"],
    updatedAt: "2030-01-07T09:40:00.000Z",
  };
  land();
  await expect.element(screen.getByText("Published", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
});

it("keeps its own failure through an edit, whose save clears the stored error without a new attempt", async () => {
  let row = article();
  await using screen = await render(editor("a1"), {
    service: service(() => [row], {
      "compose.postNow": () => {
        row = {
          ...row,
          status: "failed",
          error: "x.com kept Publish off",
          attempts: 1,
          updatedAt: "2030-01-07T09:30:00.000Z",
        };
        return Effect.succeed(row);
      },
      // DraftStore.update: an edit clears the error and the attempts, and keeps the status.
      "compose.draftUpdate": ({ patch }) => {
        row = {
          ...row,
          title: patch.title ?? row.title,
          error: null,
          attempts: 0,
          updatedAt: "2030-01-07T09:31:00.000Z",
        };
        return Effect.succeed(row);
      },
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
  await userEvent.click(
    page
      .getByRole("list", { name: "Ways out" })
      .getByRole("button", { name: /Opens X.s Publish dialog/ }),
  );
  await userEvent.click(page.getByRole("button", { name: /^Publish\s*free$/ }));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Failed: x.com kept Publish off");
  await userEvent.fill(screen.getByLabelText("Article Title"), "Two plans, edited");
  await expect.poll(() => row.title).toBe("Two plans, edited");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Failed: x.com kept Publish off");
});
