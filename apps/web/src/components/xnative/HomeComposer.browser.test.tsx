import type { DraftPatch, EngineUser } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import type { FakeService } from "../../../test/fakeService";

// Inside the desktop app (macOS) with session actions on: the box posts free through the session.
// Everything that reads isElectron loads after the bridge exists.
const bridge = installFakeBridge();
const { draft, settings } = await import("../../../test/fixtures");
const { render } = await import("../../../test/render");
const { EngineSync } = await import("./EngineSync");
const { HomeComposer } = await import("./HomeComposer");

const person = (handle: string, followers: number, youFollow: boolean) =>
  ({
    userId: handle,
    handle,
    name: handle,
    avatarUrl: null,
    verified: false,
    followers,
    youFollow,
  }) as EngineUser;

/** The service behind the box: what it was asked to create, attach and post. */
const setup = () => {
  const log: Array<string> = [];
  const creates: Array<DraftPatch> = [];
  const service: FakeService = {
    "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
    "compose.draftCreate": (patch) =>
      Effect.sync(() => {
        creates.push(patch);
        return draft("h1", "draft");
      }),
    "compose.mediaAdd": (input) =>
      Effect.sync(() => {
        log.push(`media ${input.draftId} ${input.kind} ${input.name}`);
        return draft("h1", "draft");
      }),
    "compose.postNow": (input) =>
      Effect.sync(() => {
        log.push(`post ${input.id} sessionOnly=${String(input.sessionOnly)}`);
        return draft(input.id, "posted", { postIds: ["99"] });
      }),
  };
  return { log, creates, service };
};

it("posts a poll only verified accounts can answer, with a mention picked by keyboard", async () => {
  const { log, creates, service } = setup();
  await using screen = await render(
    <>
      <EngineSync />
      <HomeComposer />
    </>,
    { service },
  );
  bridge.emitEngine({
    op: "UserByScreenName",
    key: null,
    cursor: null,
    top: null,
    bottom: null,
    posts: [],
    users: [person("theo_b", 50, true), person("thalia", 9000, false), person("zed", 10, true)],
    people: [],
    sections: [],
    order: [],
    modules: [],
    trends: [],
    notifications: [],
    lists: [],
    communities: [],
    homeTabs: null,
    exploreTabs: null,
    viewer: null,
  });
  const box = screen.getByLabelText("Post text");
  await userEvent.click(box);
  await userEvent.keyboard("Which @th");
  // Followed first; the second suggestion by arrow key.
  const handles = () =>
    Array.from(
      document.querySelectorAll('[role="option"] span span:last-child'),
      (e) => e.textContent,
    );
  await expect.poll(handles).toEqual(["@theo_b", "@thalia"]);
  await userEvent.keyboard("{ArrowDown}{Enter}?");
  await expect.element(box).toHaveValue("Which @thalia ?");

  await userEvent.click(screen.getByRole("button", { name: "Poll" }));
  await expect.element(screen.getByRole("button", { name: "Media" })).toBeDisabled();
  await userEvent.fill(screen.getByPlaceholder("Choice 1"), "tea");
  await userEvent.fill(screen.getByPlaceholder("Choice 2"), "coffee");
  await userEvent.click(screen.getByRole("button", { name: "Add a choice" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove choice 3" }));

  // As on X: a radio group in a popover, which stays open after the pick.
  await userEvent.click(screen.getByRole("button", { name: "Everyone can reply" }));
  const rows = page.getByRole("radiogroup", { name: "Who can reply?" });
  await expect.element(rows.getByRole("radio", { name: "Everyone" })).toBeChecked();
  await userEvent.click(rows.getByRole("radio", { name: "Verified accounts" }));
  await expect.element(rows.getByRole("radio", { name: "Verified accounts" })).toBeChecked();
  await userEvent.keyboard("{Escape}");
  await expect.element(rows).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Only Verified accounts can reply" }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  await expect.poll(() => log).toEqual(["post h1 sessionOnly=true"]);
  expect(creates).toEqual([
    {
      blocks: [{ text: "Which @thalia ?" }],
      quoteUrl: null,
      replySettings: "verified",
      poll: { options: ["tea", "coffee"], durationMinutes: 1440 },
    },
  ]);
  // Posted, the box starts over: no poll, everyone can reply again.
  await expect.element(box).toHaveValue("");
  await expect.element(screen.getByPlaceholder("Choice 1")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Everyone can reply" })).toBeVisible();
});

it("previews picked media with remove, sends it through mediaAdd, and opens the OS emoji panel", async () => {
  const { log, creates, service } = setup();
  await using screen = await render(<HomeComposer />, { service });
  const png = (name: string) =>
    new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
  const files = screen.getByLabelText("Media files");

  await userEvent.upload(files, png("a.png"));
  await expect.element(screen.getByRole("button", { name: "Poll" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
  await expect
    .element(screen.getByRole("list", { name: "Attached media" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Poll" })).toBeEnabled();

  await userEvent.upload(files, png("b.png"));
  await userEvent.click(screen.getByRole("button", { name: "Emoji" }));
  expect(bridge.calls).toContain("emoji panel");
  await expect.element(screen.getByLabelText("Post text")).toHaveFocus();

  await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  await expect.poll(() => log).toEqual(["media h1 image b.png", "post h1 sessionOnly=true"]);
  expect(creates).toEqual([{ blocks: [{ text: "" }], quoteUrl: null }]);
});
