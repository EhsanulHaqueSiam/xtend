import { ComposeError, type Draft, type DraftPatch, type XtendEvent } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { draft, paid, rates, settings, xPost } from "../../../test/fixtures";
import { choose, render } from "../../../test/render";
import { ComposeEditor } from "../../routes/compose";

/** What every editor reads on open; `drafts` is the list `?draft=` is looked up in. */
const editorService = (drafts: () => ReadonlyArray<Draft>, timeZone = "UTC"): FakeService => ({
  "settings.get": () => Effect.succeed({ ...settings, timeZone }),
  "compose.draftsList": () => Effect.sync(() => ({ drafts: drafts() })),
  "compose.quote": () => Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "flux" }),
  "compose.context": () =>
    Effect.succeed({ nextSlot: null, bestHours: [], desktopConnected: true }),
  "costs.quote": ({ actions }) =>
    Effect.succeed({ rates, quotes: actions.map(() => paid(0.00075)) }),
});

const editor = (draftParam?: string) => (
  <ComposeEditor
    draftParam={draftParam}
    inspire={undefined}
    reply={undefined}
    text={undefined}
    onBack={() => {}}
    onSection={() => {}}
  />
);

const saved = (id: string, patch: DraftPatch, extra: Partial<Draft> = {}) =>
  draft(id, "draft", { blocks: patch.blocks ?? [], ...extra });

it("saves a new thread as one draft and queues it even while that first save is in flight", async () => {
  const creates: Array<DraftPatch> = [];
  const updates: Array<{ readonly id: string; readonly patch: DraftPatch }> = [];
  const queued: Array<string> = [];
  let finishCreate = () => {};
  const createGate = new Promise<void>((resolve) => (finishCreate = resolve));
  await using screen = await render(editor(), {
    service: {
      ...editorService(() => []),
      "compose.draftCreate": (patch) => {
        creates.push(patch);
        return Effect.promise(() => createGate).pipe(Effect.as(saved("d1", patch)));
      },
      "compose.draftUpdate": ({ id, patch }) => {
        updates.push({ id, patch });
        return Effect.succeed(saved(id, patch, { updatedAt: "2026-10-23T00:01:00.000Z" }));
      },
      "plan.queue": ({ id }) => {
        queued.push(id);
        return Effect.succeed(draft(id, "queued", { scheduledAt: "2030-01-07T09:30:00.000Z" }));
      },
    },
  });

  await userEvent.fill(screen.getByLabelText("Post 1"), "Three things I got wrong");
  await expect.poll(() => creates.length).toBe(1);
  // Queue during the create waits for its draft rather than doing nothing.
  await userEvent.click(screen.getByRole("button", { name: /^Queue/ }));
  finishCreate();
  await expect.poll(() => queued).toEqual(["d1"]);
  await expect.element(screen.getByText(/^Queued for /)).toBeVisible();

  // Later edits go to the same row.
  await userEvent.fill(screen.getByLabelText("Post 1"), "Three things I got wrong about views");
  await expect
    .poll(() => updates.at(-1))
    .toMatchObject({
      id: "d1",
      patch: { blocks: [{ text: "Three things I got wrong about views" }] },
    });
  expect(creates).toHaveLength(1);
});

it("prices the thread before posting and posts it once however often Confirm is clicked", async () => {
  const thread = draft("d1", "draft", {
    blocks: [{ text: "hello" }, { text: "see https://example.com" }],
  });
  const posts: Array<string> = [];
  let finishPost = () => {};
  const postGate = new Promise<void>((resolve) => (finishPost = resolve));
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [thread]),
      "compose.postNow": ({ id }) => {
        posts.push(id);
        return Effect.promise(() => postGate).pipe(
          Effect.as(draft(id, "posted", { ...thread, status: "posted", postIds: ["11", "12"] })),
        );
      },
    },
  });

  // The price rides on the send buttons, and the post with a link says so beside it.
  await expect.element(screen.getByRole("button", { name: /^Queue/ })).toMatchTextContent("$0.215");
  await expect.element(screen.getByText(/^link\s*\$0\.2$/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^Post now/ }));
  const confirm = page.getByRole("dialog");
  await expect.element(confirm.getByText("Post 2 posts now.")).toBeVisible();
  await expect.element(confirm.getByText("1 with a link")).toBeVisible();
  await expect.element(confirm.getByText("$0.2", { exact: true })).toBeVisible();
  await expect.element(confirm.getByText("$0.215", { exact: true })).toBeVisible();
  await userEvent.dblClick(confirm.getByRole("button", { name: "Confirm and post" }));
  await expect.element(confirm.getByRole("button", { name: "Posting…" })).toBeDisabled();
  finishPost();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Posted 2 posts");
  expect(posts).toEqual(["d1"]);
});

const refusals: ReadonlyArray<readonly [string, Partial<Draft>, string | null]> = [
  ["an empty post in the thread", { blocks: [{ text: "one" }, { text: "  " }] }, "Post 2 is empty"],
  [
    "a post over X's limit",
    { blocks: [{ text: "one" }, { text: "x".repeat(281) }] },
    "Post 2 is over 280 characters",
  ],
  [
    "a poll beside media on the first post",
    {
      poll: { options: ["yes", "no"], durationMinutes: 1440 },
      media: [{ id: "m1", blockIndex: 0, path: "/m/cat.png", kind: "image", alt: "", position: 0 }],
    },
    "A poll cannot share the first post with media",
  ],
  [
    "an article without a body",
    { kind: "article", title: "How I ship", body: "" },
    "Article needs a title and a body",
  ],
  // The publisher posts a first post that is only the quote link.
  [
    "a post that is only a quote",
    { blocks: [{ text: "" }], quoteUrl: "https://x.com/levelsio/status/99" },
    null,
  ],
];

it.each(refusals)("holds back what the publisher would refuse: %s", async (_, extra, refusal) => {
  const row = draft("d1", "draft", extra);
  await using screen = await render(editor("d1"), { service: editorService(() => [row]) });
  const send = screen.getByRole("button", { name: /^Post now/ });
  if (refusal === null) {
    await expect.element(send).toBeEnabled();
    await expect.element(screen.getByRole("button", { name: /^Queue/ })).toMatchTextContent("$0.2");
  } else {
    await expect.element(screen.getByText(refusal)).toBeVisible();
    await expect.element(send).toBeDisabled();
  }
});

it("prices a retry of a part-posted thread for the posts not yet on X", async () => {
  const failed = draft("d1", "failed", {
    blocks: [{ text: "one" }, { text: "two" }, { text: "three" }],
    postIds: ["11"],
    error: "X refused post 2",
  });
  await using screen = await render(editor("d1"), { service: editorService(() => [failed]) });

  await expect.element(screen.getByText("Failed: X refused post 2")).toBeVisible();
  await expect
    .element(screen.getByText("1 of 3 posts are already on X", { exact: false }))
    .toBeVisible();
  const queue = screen.getByRole("button", { name: /^Queue/ });
  await expect.element(queue).toMatchTextContent("$0.03");
  await expect.element(screen.getByText("already on X, free")).toBeVisible();

  // Changing a post that went out makes the service post the whole thread again.
  await userEvent.fill(screen.getByLabelText("Post 1"), "one, reworded");
  await expect.element(queue).toMatchTextContent("$0.045");
  await expect.element(screen.getByText("already on X, free")).not.toBeInTheDocument();
});

it("locks the editor when the scheduler claims the open draft", async () => {
  let claim = () => {};
  const claimed = new Promise<void>((resolve) => (claim = resolve));
  const event: XtendEvent = {
    type: "draft_status_changed",
    at: "2026-10-23T09:30:00.000Z",
    payload: { draftId: "d1", status: "posting" },
  };
  let row = draft("d1", "queued", { scheduledAt: "2026-10-23T09:30:00.000Z" });
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [row]),
      "events.subscribe": () =>
        Stream.fromEffect(Effect.promise(() => claimed).pipe(Effect.as(event))).pipe(
          Stream.concat(Stream.never),
        ),
    },
  });
  await expect.element(screen.getByLabelText("Post 1")).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: /^Improve hook/ })).toBeVisible();

  row = { ...row, status: "posting", updatedAt: "2026-10-23T09:30:00.000Z" };
  claim();
  await expect
    .element(screen.getByText("This draft is posting; start a new draft to change it."))
    .toBeVisible();
  await expect.element(screen.getByLabelText("Post 1")).toBeDisabled();
  // Nothing sends a draft the publisher owns.
  await expect.element(screen.getByRole("button", { name: /^Post now/ })).not.toBeInTheDocument();
  // No paid assist on a draft that can no longer change.
  await expect
    .element(screen.getByRole("button", { name: /^Improve hook/ }))
    .not.toBeInTheDocument();
});

it("offers no editable field on a posted article or a posted thread's options", async () => {
  const article = draft("a1", "posted", {
    kind: "article",
    title: "How I ship",
    body: "Every day.",
    postIds: ["21"],
  });
  {
    await using screen = await render(editor("a1"), { service: editorService(() => [article]) });
    await expect.element(screen.getByPlaceholder("Title")).toBeDisabled();
    await expect.element(screen.getByPlaceholder("Describe the cover image")).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  }
  const thread = draft("t1", "posted", { postIds: ["31"] });
  await using screen = await render(editor("t1"), { service: editorService(() => [thread]) });
  await expect.element(screen.getByLabelText("Post 1")).toBeDisabled();
  // A posted thread has no options to open at all.
  expect(screen.getByLabelText("Quote post link").elements()).toHaveLength(0);
});

it("schedules at the picked wall time in the account's zone and refuses a time already gone", async () => {
  const scheduled: Array<{ readonly id: string; readonly at: string }> = [];
  const row = draft("d1", "draft");
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [row], "Asia/Dhaka"),
      "plan.schedule": (input) => {
        scheduled.push(input);
        return Effect.succeed(draft("d1", "queued", { scheduledAt: input.at }));
      },
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Schedule", exact: true }));
  const picker = page.getByRole("dialog");
  await expect.element(picker.getByText("Asia/Dhaka")).toBeVisible();
  const submit = picker.getByRole("button", { name: /^Schedule/ });

  await userEvent.fill(picker.getByLabelText("Post on"), "2020-01-01");
  await userEvent.fill(picker.getByLabelText("Post at"), "09:00");
  await expect.element(picker.getByText("That time has passed")).toBeVisible();
  await expect.element(submit).toBeDisabled();

  await userEvent.fill(picker.getByLabelText("Post on"), "2030-01-07");
  await userEvent.fill(picker.getByLabelText("Post at"), "09:30");
  await userEvent.click(submit);
  // 09:30 in Dhaka (UTC+6), whatever zone the browser runs in.
  await expect.poll(() => scheduled).toEqual([{ id: "d1", at: "2030-01-07T03:30:00.000Z" }]);
});

it("attaches a picked file to its post, says why the service refused one, and removes it", async () => {
  const added: Array<{ readonly blockIndex: number; readonly name: string }> = [];
  const removed: Array<string> = [];
  const row = draft("d1", "draft");
  const withImage = draft("d1", "draft", {
    media: [{ id: "m1", blockIndex: 0, path: "/m/d1/m1.png", kind: "image", alt: "", position: 0 }],
  });
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [row]),
      "compose.mediaAdd": ({ blockIndex, name }) => {
        added.push({ blockIndex, name });
        return added.length === 1
          ? Effect.succeed(withImage)
          : Effect.fail(
              new ComposeError({ operation: "mediaAdd", detail: "A post holds at most 4 images" }),
            );
      },
      "compose.mediaRemove": ({ id }) => {
        removed.push(id);
        return Effect.succeed(row);
      },
    },
  });
  await expect.element(screen.getByLabelText("Post 1")).toBeEnabled();
  const picker = page.elementLocator(screen.container.querySelector('input[type="file"]')!);
  const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

  await userEvent.upload(picker, file("cat.png"));
  await expect.element(screen.getByLabelText("Alt text")).toBeVisible();
  expect(added).toEqual([{ blockIndex: 0, name: "cat.png" }]);

  await userEvent.upload(picker, file("dog.png"));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Failed: Compose mediaAdd failed: A post holds at most 4 images");
  expect(screen.getByLabelText("Alt text").elements()).toHaveLength(1);

  await userEvent.click(screen.getByRole("button", { name: "Remove media" }));
  await expect.poll(() => removed).toEqual(["m1"]);
  await expect.element(screen.getByLabelText("Alt text")).not.toBeInTheDocument();
});

it("Use on a similar post drops the files of the posts it replaces, on screen and in the save", async () => {
  const updates: Array<DraftPatch> = [];
  const row = draft("d1", "draft", {
    blocks: [{ text: "one" }, { text: "two" }],
    media: [{ id: "m2", blockIndex: 1, path: "/m/d1/m2.png", kind: "image", alt: "", position: 0 }],
  });
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [row]),
      "library.search": () =>
        Effect.succeed({ items: [xPost("9", "Ship the ugly version")], nextCursor: null }),
      "compose.draftUpdate": ({ id, patch }) => {
        updates.push(patch);
        return Effect.succeed(saved(id, patch));
      },
    },
  });
  // The second post's file would go through the session, which is off.
  const sessionWarning = screen.getByText(/Turn on Session posting in Settings/);
  await expect.element(sessionWarning).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^Search X/ }));
  await userEvent.click(screen.getByRole("button", { name: "Use", exact: true }));

  await expect.element(screen.getByLabelText("Post 1")).toHaveValue("Ship the ugly version");
  await expect.element(screen.getByLabelText("Post 2")).not.toBeInTheDocument();
  await expect.element(sessionWarning).not.toBeInTheDocument();
  await expect
    .poll(() => updates.at(-1))
    .toMatchObject({ blocks: [{ text: "Ship the ugly version" }], media: [] });
});

it("saves the last keystrokes when the editor closes inside the autosave delay, and stays when Back cannot save", async () => {
  const creates: Array<DraftPatch> = [];
  {
    await using screen = await render(editor(), {
      service: {
        ...editorService(() => []),
        "compose.draftCreate": (patch) => {
          creates.push(patch);
          return Effect.succeed(saved("d1", patch));
        },
      },
    });
    await userEvent.fill(screen.getByLabelText("Post 1"), "typed just before leaving");
    await screen.unmount();
  }
  await expect
    .poll(() => creates.map((p) => p.blocks))
    .toEqual([[{ text: "typed just before leaving" }]]);

  const backs: Array<string> = [];
  const row = draft("d2", "draft");
  await using screen = await render(
    <ComposeEditor
      draftParam="d2"
      inspire={undefined}
      reply={undefined}
      text={undefined}
      onBack={(tab) => backs.push(tab)}
      onSection={() => {}}
    />,
    {
      service: {
        ...editorService(() => [row]),
        "compose.draftUpdate": () =>
          Effect.fail(new ComposeError({ operation: "update", detail: "database is locked" })),
      },
    },
  );
  await userEvent.fill(screen.getByLabelText("Post 1"), "an edit the service refuses");
  await userEvent.click(screen.getByRole("button", { name: /^Back to drafts$/i }));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Failed: Compose update failed: database is locked");
  expect(backs).toEqual([]);
  await expect.element(screen.getByLabelText("Post 1")).toHaveValue("an edit the service refuses");
});

it("saves edits made while a save is running before it queues", async () => {
  const order: Array<string> = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const row = draft("d1", "draft");
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [row]),
      "compose.draftUpdate": ({ id, patch }) => {
        order.push(`save ${patch.blocks?.[0]?.text}`);
        return (order.length === 1 ? Effect.promise(() => gate) : Effect.void).pipe(
          Effect.as(saved(id, patch)),
        );
      },
      "plan.queue": ({ id }) => {
        order.push("queue");
        return Effect.succeed(draft(id, "queued", { scheduledAt: "2030-01-07T09:30:00.000Z" }));
      },
    },
  });
  await userEvent.fill(screen.getByLabelText("Post 1"), "first");
  await expect.poll(() => order).toEqual(["save first"]);
  await userEvent.fill(screen.getByLabelText("Post 1"), "first, then more");
  await userEvent.click(screen.getByRole("button", { name: /^Queue/ }));
  release();
  await expect.poll(() => order).toEqual(["save first", "save first, then more", "queue"]);
});

it("holds back an article until its publish price is known", async () => {
  const article = draft("a1", "draft", { kind: "article", title: "How I ship", body: "Daily." });
  await using screen = await render(editor("a1"), {
    service: { ...editorService(() => [article]), "compose.quote": () => Effect.never },
  });
  await expect.element(screen.getByLabelText("Title")).toHaveValue("How I ship");
  await expect.element(screen.getByRole("button", { name: /^Post now/ })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: /^Queue/ })).toBeDisabled();
});

const pasteInto = (target: HTMLElement, text: string) => {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  target.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  );
};

it("turns a post link pasted on its own line into the quote", async () => {
  await using screen = await render(editor(), { service: editorService(() => []) });
  const post = screen.getByLabelText("Post 1");
  await expect.element(post).toBeEnabled();
  pasteInto(post.element() as HTMLElement, "https://x.com/levelsio/status/99\n");
  await expect
    .element(screen.getByLabelText("Quote post link"))
    .toHaveValue("https://x.com/levelsio/status/99");
  await expect.element(post).toHaveValue("");
});

it("keeps the tools on a post as it moves, and focuses a post added below", async () => {
  const row = draft("d1", "draft", { blocks: [{ text: "one" }, { text: "two" }] });
  await using screen = await render(editor("d1"), { service: editorService(() => [row]) });
  await userEvent.click(screen.getByLabelText("Post 1"));
  await userEvent.click(screen.getByRole("button", { name: "Move down" }));
  const second = screen.getByLabelText("Post 2");
  await expect.element(second).toHaveValue("one");
  await expect.element(second).toHaveFocus();
  // The tools sit under the moved post, now last, so it cannot move further down.
  await expect.element(screen.getByRole("button", { name: "Move down" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Add post below" }));
  await expect.element(screen.getByLabelText("Post 3")).toHaveFocus();
});

it("unschedules a queued draft from its editor", async () => {
  const unscheduled: Array<string> = [];
  const sections: Array<string> = [];
  const row = draft("d1", "queued", { scheduledAt: "2030-01-07T09:30:00.000Z" });
  await using screen = await render(
    <ComposeEditor
      draftParam="d1"
      inspire={undefined}
      reply={undefined}
      text={undefined}
      onBack={() => {}}
      onSection={(tab) => sections.push(tab)}
    />,
    {
      service: {
        ...editorService(() => [row]),
        "plan.unschedule": ({ id }) => {
          unscheduled.push(id);
          return Effect.succeed(draft(id, "draft", { updatedAt: "2026-10-23T00:01:00.000Z" }));
        },
      },
    },
  );
  await userEvent.click(screen.getByRole("button", { name: "Unschedule" }));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Back in drafts");
  expect(unscheduled).toEqual(["d1"]);
  expect(sections).toEqual(["drafts"]);
  await expect.element(screen.getByRole("button", { name: /^Queue/ })).toBeEnabled();
});

it("says why a draft could not load instead of loading forever", async () => {
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => []),
      "compose.draftsList": () =>
        Effect.fail(new ComposeError({ operation: "list", detail: "database is locked" })),
    },
  });
  await expect.element(screen.getByText("Compose list failed: database is locked")).toBeVisible();
  expect(screen.getByText("Loading draft").elements()).toHaveLength(0);
});

it("saves a reply's target and links the post it answers on X", async () => {
  const creates: Array<DraftPatch> = [];
  await using screen = await render(
    <ComposeEditor
      draftParam={undefined}
      inspire={undefined}
      reply="1234"
      text={undefined}
      onBack={() => {}}
      onSection={() => {}}
    />,
    {
      service: {
        ...editorService(() => []),
        "library.getSavedPost": () =>
          Effect.succeed({
            id: 1,
            post: xPost("1234", "What did you ship this week?"),
            note: "",
            savedAt: "2026-10-23T00:00:00.000Z",
            collectionIds: [],
          }),
        "observations.listRecent": () => Effect.succeed({ posts: [] }),
        "compose.draftCreate": (patch) => {
          creates.push(patch);
          return Effect.succeed(saved("d1", patch));
        },
      },
    },
  );
  await expect.element(screen.getByText("Replying to @levelsio")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open on X" }))
    .toHaveAttribute("href", "https://x.com/i/web/status/1234");
  await userEvent.fill(screen.getByLabelText("Post 1"), "A parser and two tests.");
  await expect.poll(() => creates.at(-1)?.replyToPostId).toBe("1234");
});

it("saves a poll and the delay between posts, and reopens with them", async () => {
  let row: Draft | null = null;
  const store = (patch: DraftPatch) => {
    row = saved("d1", patch, {
      poll: patch.poll ?? null,
      threadDelaySeconds: patch.threadDelaySeconds ?? 0,
    });
    return Effect.succeed(row);
  };
  const service: FakeService = {
    ...editorService(() => (row === null ? [] : [row])),
    "compose.draftCreate": store,
    "compose.draftUpdate": ({ patch }) => store(patch),
  };
  {
    await using screen = await render(editor(), { service });
    await userEvent.fill(screen.getByLabelText("Post 1"), "Which ships first?");
    await userEvent.click(screen.getByText(/^Options/));
    // Nothing removes a link card after posting, so the option stays off.
    await expect.element(screen.getByRole("switch", { name: /Hide link previews/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: "Poll on the first post" }));
    await userEvent.fill(screen.getByPlaceholder("Option 1"), "web");
    await userEvent.fill(screen.getByPlaceholder("Option 2"), "desktop");
    await choose(screen.getByRole("combobox", { name: "Poll length" }), "3 days");
    await userEvent.fill(screen.getByRole("spinbutton"), "30");
    await expect
      .poll(() => row)
      .toMatchObject({
        poll: { options: ["web", "desktop"], durationMinutes: 4320 },
        threadDelaySeconds: 30,
      });
  }
  await using screen = await render(editor("d1"), { service });
  // Reopened, the row also lists what is set: "poll · 30s apart".
  await userEvent.click(screen.getByText(/^Options/));
  await expect.element(screen.getByPlaceholder("Option 2")).toHaveValue("desktop");
  await expect
    .element(screen.getByRole("combobox", { name: "Poll length" }))
    .toHaveTextContent("3 days");
  await expect.element(screen.getByRole("spinbutton")).toHaveValue(30);
});

it("puts a rewrite of the second post in the second post", async () => {
  const row = draft("d1", "draft", { blocks: [{ text: "one" }, { text: "two" }] });
  await using screen = await render(editor("d1"), {
    service: {
      ...editorService(() => [row]),
      "compose.assistRewrite": ({ text }) => Effect.succeed({ variants: [`${text}, sharper`] }),
    },
  });
  await userEvent.click(screen.getByLabelText("Post 2"));
  await userEvent.click(screen.getByRole("button", { name: /^Rewrite/ }));
  await userEvent.click(screen.getByRole("button", { name: "Use", exact: true }));
  await expect.element(screen.getByLabelText("Post 2")).toHaveValue("two, sharper");
  await expect.element(screen.getByLabelText("Post 1")).toHaveValue("one");
});
