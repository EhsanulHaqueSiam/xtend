import { ComposeError, type DraftPatch, type EngineGif, type EngineUser } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
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
const { markXReady, registerXWebview } = await import("../../state/x");

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

/** One engine response carrying only people, as the capture sends a profile's. */
const people = {
  op: "UserByScreenName",
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts: [],
  users: [],
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
};

/** The handles the mention list offers, top first. */
const handles = () =>
  Array.from(
    document.querySelectorAll('[role="option"] span span:last-child'),
    (e) => e.textContent,
  );

/**
 * The service behind the box: what it was asked to create, attach, delete and post. Files named
 * in `failing` fail to upload; `posted` holds Post now until the test settles it.
 */
const setup = ({
  failing = [],
  posted = Promise.resolve(),
}: { failing?: ReadonlyArray<string>; posted?: Promise<void> } = {}) => {
  const log: Array<string> = [];
  const creates: Array<DraftPatch> = [];
  const service: FakeService = {
    "compose.draftDelete": ({ id }) => Effect.sync(() => void log.push(`delete ${id}`)),
    "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
    "compose.draftCreate": (patch) =>
      Effect.sync(() => {
        creates.push(patch);
        return draft("h1", "draft");
      }),
    "compose.mediaAdd": (input) =>
      failing.includes(input.name)
        ? Effect.fail(new ComposeError({ operation: "mediaAdd", detail: "disk full" }))
        : Effect.sync(() => {
            log.push(`media ${input.draftId} ${input.kind} ${input.name}`);
            return draft("h1", "draft");
          }),
    "compose.postNow": (input) =>
      Effect.promise(() => posted).pipe(
        Effect.map(() => {
          const gif = input.gif === undefined ? "" : ` gif=${input.gif.query}:${input.gif.id}`;
          log.push(`post ${input.id} sessionOnly=${String(input.sessionOnly)}${gif}`);
          return draft(input.id, "posted", { postIds: ["99"] });
        }),
      ),
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
    ...people,
    users: [person("theo_b", 50, true), person("thalia", 9000, false), person("zed", 10, true)],
  });
  const box = screen.getByLabelText("Post text");
  await userEvent.click(box);
  await userEvent.keyboard("Which @th");
  // Followed first; the second suggestion by arrow key.
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

const png = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

it("replaces the whole mention around the caret, not just what is before it", async () => {
  const { service } = setup();
  await using screen = await render(
    <>
      <EngineSync />
      <HomeComposer />
    </>,
    { service },
  );
  bridge.emitEngine({ ...people, users: [person("theo_b", 50, true)] });
  const box = screen.getByLabelText("Post text");
  await userEvent.click(box);
  // The caret after "@the": "o" is the rest of the mention.
  await userEvent.keyboard("hi @theo{ArrowLeft}");
  await expect.poll(handles).toEqual(["@theo_b"]);
  await userEvent.keyboard("{Enter}");
  await expect.element(box).toHaveValue("hi @theo_b ");
});

it("deletes the draft a failed upload left, so a retry starts clean", async () => {
  const { log, service } = setup({ failing: ["b.png"] });
  await using screen = await render(<HomeComposer />, { service });
  await userEvent.upload(screen.getByLabelText("Media files"), [png("a.png"), png("b.png")]);
  await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  await expect.poll(() => log).toEqual(["media h1 image a.png", "delete h1"]);
  // Both stay in the box for the retry.
  await expect.element(screen.getByRole("button", { name: "Remove b.png" })).toBeVisible();
});

it("deletes the draft and frees the box when a picked file can no longer be read", async () => {
  const { log, service } = setup();
  await using screen = await render(<HomeComposer />, { service });
  await userEvent.upload(screen.getByLabelText("Media files"), [png("a.png"), png("b.png")]);
  // The second file changed on disk after it was picked.
  const read = FileReader.prototype.readAsDataURL;
  using _read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
    this: FileReader,
    file: Blob,
  ) {
    if (file instanceof File && file.name === "b.png")
      queueMicrotask(() => this.dispatchEvent(new ProgressEvent("error")));
    else read.call(this, file);
  });
  await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  await expect.poll(() => log).toEqual(["media h1 image a.png", "delete h1"]);
  await expect.element(screen.getByLabelText("Post text")).toBeEnabled();
});

it("freezes the box while Post sends, so nothing added or handed off meanwhile is lost", async () => {
  let release = () => {};
  const posted = new Promise<void>((resolve) => (release = resolve));
  const { log, service } = setup({ posted });
  await using screen = await render(<HomeComposer />, { service });
  // Focused once, as on X, so the reply row is there too.
  await userEvent.click(screen.getByLabelText("Post text"));
  await userEvent.upload(screen.getByLabelText("Media files"), png("a.png"));
  await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  for (const name of [
    "Media",
    "Poll",
    "Emoji",
    "Schedule in Compose",
    "Make a thread in Compose",
    "Remove a.png",
    "Everyone can reply",
  ])
    await expect.element(screen.getByRole("button", { name })).toBeDisabled();
  await expect.element(screen.getByLabelText("Post text")).toBeDisabled();
  release();
  await expect.poll(() => log).toEqual(["media h1 image a.png", "post h1 sessionOnly=true"]);
  await expect.element(screen.getByLabelText("Post text")).toBeEnabled();
});

it("frees picked files when the box goes away with them", async () => {
  const { service } = setup();
  await using screen = await render(<HomeComposer />, { service });
  await userEvent.upload(screen.getByLabelText("Media files"), png("a.png"));
  const url = screen.container.querySelector("img")?.getAttribute("src");
  expect(url).toMatch(/^blob:/);
  using revoke = vi.spyOn(URL, "revokeObjectURL");
  await screen.unmount();
  expect(revoke).toHaveBeenCalledWith(url);
});

it("picks a GIF from X's own search in the engine and posts it free, leaving X's search on close", async () => {
  const { log, creates, service } = setup();
  // The engine: each script X's page would run, answered as X's search showing. X's Back, which
  // leaves the search, finishes when the test says.
  const scripts: Array<string> = [];
  let leave = () => {};
  const left = new Promise<boolean>((resolve) => (leave = () => resolve(true)));
  registerXWebview({
    executeJavaScript: (code: string) => (
      scripts.push(code),
      code.includes("app-bar-back") ? left : Promise.resolve(true)
    ),
  } as unknown as Parameters<typeof registerXWebview>[0]);
  markXReady();
  try {
    await using screen = await render(
      <>
        <EngineSync />
        <HomeComposer />
      </>,
      { service },
    );
    await userEvent.click(screen.getByRole("button", { name: "GIF" }));
    const picker = page.getByRole("dialog", { name: "Choose a GIF" });
    await expect.poll(() => scripts.some((s) => s.includes("gifSearchButton"))).toBe(true);
    await userEvent.fill(picker.getByPlaceholder("Search for GIFs"), "cat");
    await expect.element(picker.getByText("Loading from X")).toBeVisible();
    expect(scripts.at(-1)).toContain('"cat"');

    const gif = (id: string, altText: string | null): EngineGif => ({
      id,
      altText,
      url: `data:image/gif;base64,R0lGODlhAQABAAAAACw=`,
      stillUrl: null,
      width: 200,
      height: 150,
      provider: "GIPHY",
    });
    bridge.emitEngine({
      ...people,
      op: "GifSearch",
      key: "gifs:cat",
      bottom: "go50c50",
      gifs: [
        gif("giphy_g1", "Cat Jump GIF"),
        ...Array.from({ length: 49 }, (_, i) => gif(`giphy_m${i}`, null)),
      ],
    });
    // Scrolled to the end of X's first page, the engine scrolls X's list on for its next.
    const grid = () => document.querySelector("[data-virtuoso-scroller]");
    await expect
      .poll(() => {
        grid()?.scrollTo(0, grid()!.scrollHeight);
        return scripts.some((s) => s.includes("scrollIntoView"));
      })
      .toBe(true);
    grid()?.scrollTo(0, 0);
    // Tests load no CSS, so Base UI's inert layer covers the picker: the click goes to the tile.
    const tile = picker.getByRole("button", { name: "Cat Jump GIF" });
    await expect.element(tile).toBeVisible();
    (tile.element() as HTMLElement).click();
    await expect.element(picker).not.toBeInTheDocument();
    // Closed, the engine leaves X's search with its own Back.
    await expect.poll(() => scripts.at(-1)).toContain("app-bar-back");

    // As on X: a GIF stands alone on the post.
    await expect.element(screen.getByRole("img", { name: "Cat Jump GIF" })).toBeVisible();
    for (const name of ["Media", "GIF", "Poll"])
      await expect.element(screen.getByRole("button", { name })).toBeDisabled();
    // Post waits for X's search to be left: the desktop opens X's composer in the same page.
    await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
    expect(creates).toEqual([]);
    leave();
    await expect.poll(() => log).toEqual(["post h1 sessionOnly=true gif=cat:giphy_g1"]);
    expect(creates).toEqual([{ blocks: [{ text: "" }], quoteUrl: null }]);
    await expect
      .element(screen.getByRole("button", { name: "Remove GIF" }))
      .not.toBeInTheDocument();
  } finally {
    registerXWebview(null);
  }
});

// X's own command key for bold and italic, as the box reads it.
const COMMAND = navigator.userAgent.includes("Mac") ? "Meta" : "Control";

it("formats the selection with Bold and X's shortcut for an account X lets format, and posts the runs", async () => {
  const { log, creates, service } = setup();
  await using screen = await render(
    <>
      <EngineSync />
      <HomeComposer />
    </>,
    { service },
  );
  bridge.emitEngine({ ...people, op: "GetUserClaims", claims: ["subscriptions_feature_1014"] });
  const box = screen.getByLabelText("Post text");
  await userEvent.click(box);
  await userEvent.keyboard("  go big now");
  const area = box.element() as HTMLTextAreaElement;
  area.setSelectionRange(5, 8);
  const bold = screen.getByRole("button", { name: "Bold" });
  await userEvent.click(bold);
  await expect.element(bold).toHaveAttribute("aria-pressed", "true");
  area.setSelectionRange(9, 12);
  await userEvent.keyboard(`{${COMMAND}>}i{/${COMMAND}}`);
  await expect
    .element(screen.getByRole("button", { name: "Italic" }))
    .toHaveAttribute("aria-pressed", "true");
  // Typed at a run's end, it joins the run.
  area.setSelectionRange(12, 12);
  await userEvent.keyboard("!");

  await userEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  await expect.poll(() => log).toEqual(["post h1 sessionOnly=true"]);
  // Trimmed as posted, the runs move with the text.
  expect(creates).toEqual([
    {
      blocks: [
        {
          text: "go big now!",
          styles: [
            { start: 3, end: 6, style: "Bold" },
            { start: 7, end: 11, style: "Italic" },
          ],
        },
      ],
      quoteUrl: null,
    },
  ]);
});

it("shows X's own upsell on Bold for an account X does not let format, and posts the text plain", async () => {
  const { log, creates, service } = setup();
  await using screen = await render(
    <>
      <EngineSync />
      <HomeComposer />
    </>,
    { service },
  );
  bridge.emitEngine({ ...people, op: "GetUserClaims", claims: [] });
  const box = screen.getByLabelText("Post text");
  await userEvent.click(box);
  await userEvent.keyboard("hi");
  (box.element() as HTMLTextAreaElement).setSelectionRange(0, 2);
  await userEvent.keyboard(`{${COMMAND}>}b{/${COMMAND}}`);
  await userEvent.click(screen.getByRole("button", { name: "Bold" }));
  await expect
    .element(
      page.getByText("Write longer posts and apply text formatting such as bold and italic."),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Subscribe" }))
    .toHaveAttribute("href", "https://x.com/i/premium_sign_up?referring_page=sidebar_longform");
  // Tests load no CSS, so Base UI's layer covers the box: Post is pressed in place.
  (screen.getByRole("button", { name: "Post", exact: true }).element() as HTMLElement).click();
  await expect.poll(() => log).toEqual(["post h1 sessionOnly=true"]);
  expect(creates).toEqual([{ blocks: [{ text: "hi" }], quoteUrl: null }]);
});
