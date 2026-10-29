import { type Collection, LibraryError, type SavedPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { paid, quoting, rates, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { ArchiveTab } from "./ArchiveTab";
import { CollectionsTab } from "./CollectionsTab";
import { PicksTab } from "./PicksTab";
import { PostGrid } from "./PostCard";
import { SaveButton } from "./SaveButton";
import { SearchTab } from "./SearchTab";
import { SwipeTab } from "./SwipeTab";
import { TrendsTab } from "./TrendsTab";

afterEach(() => {
  vi.restoreAllMocks();
});

const first = xPost("1", "AI agents need boring infra");
const second = xPost("2", "Ship the ugly version");
const third = xPost("3", "Pricing pages convert on proof");

const collection = (id: number, name: string, builtIn = false): Collection => ({
  id,
  name,
  builtIn,
  posts: 0,
  createdAt: "2026-10-23T00:00:00.000Z",
});
const saved = (id: number, post: typeof first, note = ""): SavedPost => ({
  id,
  post,
  note,
  savedAt: "2026-10-23T12:00:00.000Z",
  collectionIds: [],
});

type Screen = Awaited<ReturnType<typeof render>>;
/** A post's card in a Library grid. */
const card = (screen: Screen, text: string) =>
  screen.getByRole("article").filter({ hasText: text });
/** Selects a card; its inspector opens in the detail column. */
const inspect = async (screen: Screen, text: string) => {
  await userEvent.click(card(screen, text).getByText(text));
  return screen.getByRole("complementary", { name: "Selected post" });
};

it("prices a search by its mode, and Load more as the next page of the search on screen", async () => {
  const searches: Array<{
    readonly query: string;
    readonly mode: string;
    readonly cursor?: string | undefined;
  }> = [];
  await using screen = await render(<SearchTab initialQuery="ai agents" />, {
    service: {
      // Only the first top page is in the service's cache.
      "costs.quote": ({ actions }) =>
        Effect.succeed({
          rates,
          quotes: actions.map((a) =>
            a.kind === "search" && a.mode !== "latest" && a.cursor === undefined
              ? { usd: 0, cached: true }
              : paid(0.00075),
          ),
        }),
      "library.search": (input) => {
        searches.push(input);
        return Effect.succeed(
          input.cursor === undefined
            ? { items: [first, second], nextCursor: "c2" }
            : { items: [second, third], nextCursor: null },
        );
      },
      "library.collectionsList": () => Effect.succeed([]),
      "library.savedList": () => Effect.succeed([]),
    },
  });
  // A `?q=` link fills the box; the search waits for the priced click.
  const searchButton = screen.getByRole("button", { name: /^Search.*cached, free$/ });
  await expect.element(searchButton).toBeVisible();
  expect(searches).toEqual([]);
  await userEvent.click(searchButton);
  await expect.poll(() => searches).toEqual([{ query: "ai agents", mode: "top" }]);
  // The next page is a read of its own, paid though the first one was cached.
  const loadMore = screen.getByRole("button", { name: /^Load more.*\$0\.00075$/ });
  await expect.element(loadMore).toBeVisible();

  // Latest is cached apart from Top.
  await userEvent.click(screen.getByRole("tab", { name: /^Latest/ }));
  await expect.element(screen.getByRole("button", { name: /^Search.*\$0\.00075$/ })).toBeVisible();

  // Load more continues the search that is listed, whatever the box and the toggle say now.
  await userEvent.fill(screen.getByLabelText("Search query"), "something else");
  await userEvent.click(loadMore);
  await expect
    .poll(() => searches.at(-1))
    .toEqual({ query: "ai agents", mode: "top", cursor: "c2" });
  await expect.element(screen.getByText(third.text)).toBeVisible();
  // A post X repeats on the next page is listed once.
  expect(screen.getByText(second.text).elements()).toHaveLength(1);
  await expect.element(screen.getByRole("button", { name: /^Load more/ })).not.toBeInTheDocument();
});

it("saves a post into a user collection and says when the save failed", async () => {
  const saves: Array<number | null> = [];
  await using screen = await render(<SaveButton post={first} />, {
    service: {
      "library.collectionsList": () =>
        Effect.succeed([collection(1, "Staff picks", true), collection(2, "Hooks")]),
      "library.savedList": () => Effect.succeed([]),
      "library.save": ({ collectionId }) => {
        saves.push(collectionId);
        return saves.length === 1
          ? Effect.succeed(saved(9, first))
          : Effect.fail(new LibraryError({ operation: "store", detail: "disk full" }));
      },
    },
  });
  // The choices open in a menu, which portals out of the screen's container.
  const trigger = screen.getByRole("button", { name: /^Save/ });
  await userEvent.click(trigger);
  await expect.element(page.getByRole("menuitem", { name: /^Hooks/ })).toBeVisible();
  // The built-in collection fills itself; it is not offered.
  expect(page.getByRole("menuitem", { name: /^Staff picks/ }).elements()).toHaveLength(0);
  await userEvent.click(page.getByRole("menuitem", { name: /^Hooks/ }));
  await expect.element(screen.getByRole("button", { name: /Saved to Hooks/ })).toBeVisible();
  expect(saves).toEqual([2]);

  await userEvent.click(trigger);
  await userEvent.click(page.getByRole("menuitem", { name: "Swipe file" }));
  await expect.element(screen.getByText("Library store failed: disk full")).toBeVisible();
  expect(saves).toEqual([2, null]);
});

it("creates a collection, lists its posts, and clears the view when the open one is deleted", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let collections = [collection(1, "Staff picks", true)];
  await using screen = await render(<CollectionsTab />, {
    service: {
      "library.collectionsList": () => Effect.sync(() => collections),
      "library.collectionCreate": ({ name }) => {
        const created = collection(2, name);
        collections = [...collections, created];
        return Effect.succeed(created);
      },
      "library.collectionDelete": ({ id }) => {
        collections = collections.filter((c) => c.id !== id);
        return Effect.void;
      },
      "library.savedList": ({ collectionId }) =>
        Effect.succeed(collectionId === 2 ? [saved(5, first)] : []),
    },
  });
  await expect.element(screen.getByRole("button", { name: /^Staff picks/ })).toBeVisible();
  // Staff picks is read-only.
  expect(screen.getByRole("button", { name: /^(Delete|Rename) / }).elements()).toHaveLength(0);

  await userEvent.fill(screen.getByLabelText("New collection"), "  Hooks ");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await userEvent.click(screen.getByRole("button", { name: /^Hooks/ }));
  await expect.element(screen.getByText(first.text)).toBeVisible();

  // Deleting the open collection falls back to the first one, Staff picks.
  await userEvent.click(screen.getByRole("button", { name: "Delete Hooks" }));
  await expect.element(screen.getByText("The daily picks land here.")).toBeVisible();
  await expect.element(screen.getByText(first.text)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: /^Hooks/ })).not.toBeInTheDocument();
});

it("Remove in a collection takes the post out of that collection only; Staff picks has none", async () => {
  let hooks = [saved(5, first), saved(6, second)];
  const removed: Array<{ readonly collectionId: number; readonly savedId: number }> = [];
  // No savedDelete: deleting the saved post itself would fail this test.
  await using screen = await render(<CollectionsTab />, {
    service: {
      "library.collectionsList": () =>
        Effect.succeed([collection(1, "Staff picks", true), collection(2, "Hooks")]),
      "library.savedList": ({ collectionId }) =>
        Effect.sync(() =>
          collectionId === 2 ? hooks : collectionId === 1 ? [saved(7, third)] : [...hooks],
        ),
      "library.collectionRemovePost": (input) => {
        removed.push(input);
        hooks = hooks.filter((r) => r.id !== input.savedId);
        return Effect.void;
      },
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Hooks/ }));
  const hooksPost = await inspect(screen, first.text);
  await userEvent.click(hooksPost.getByRole("button", { name: "Remove" }));
  await expect.poll(() => removed).toEqual([{ collectionId: 2, savedId: 5 }]);
  await expect.element(screen.getByText(first.text)).not.toBeInTheDocument();
  await expect.element(screen.getByText(second.text)).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /^Staff picks/ }));
  const staffPost = await inspect(screen, third.text);
  await expect.element(staffPost.getByRole("button", { name: "Remix" })).toBeVisible();
  expect(staffPost.getByRole("button", { name: "Remove" }).elements()).toHaveLength(0);
});

it("searches the swipe file, keeps a note on blur, and deletes a post only after a confirm", async () => {
  let rows = [saved(1, first), saved(2, second)];
  const notes: Array<{ readonly id: number; readonly note: string }> = [];
  const deleted: Array<number> = [];
  await using screen = await render(<SwipeTab />, {
    service: {
      "library.savedList": ({ query }) =>
        Effect.sync(() =>
          query === undefined ? rows : rows.filter((r) => r.post.text.includes(query)),
        ),
      "library.savedSetNote": (input) => {
        notes.push(input);
        return Effect.void;
      },
      "library.savedDelete": ({ id }) => {
        deleted.push(id);
        rows = rows.filter((r) => r.id !== id);
        return Effect.void;
      },
    },
  });
  await expect.element(screen.getByText(second.text)).toBeVisible();
  await userEvent.fill(screen.getByLabelText("Search swipe file"), "agents");
  await expect.element(screen.getByText(second.text)).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Search swipe file"));

  const firstPost = await inspect(screen, first.text);
  await userEvent.fill(firstPost.getByLabelText("Note"), "steal the hook");
  await userEvent.click(screen.getByLabelText("Search swipe file"));
  await expect.poll(() => notes).toEqual([{ id: 1, note: "steal the hook" }]);
  // The open inspector covers the grid on a narrow screen.
  await userEvent.click(firstPost.getByRole("button", { name: "Close" }));

  // In the swipe file the delete reaches every collection, so it says so and asks first.
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const secondPost = await inspect(screen, second.text);
  const remove = secondPost.getByRole("button", { name: "Delete saved post" });
  await userEvent.click(remove);
  expect(confirm).toHaveBeenCalledOnce();
  await expect.element(card(screen, second.text)).toBeVisible();
  confirm.mockReturnValue(true);
  await userEvent.click(remove);
  await expect.element(screen.getByText(second.text)).not.toBeInTheDocument();
  await expect.element(screen.getByText(first.text)).toBeVisible();
  expect(deleted).toEqual([2]);
});

it("moves focus into an opened post, back to its card on close, and to the next card once deleted", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let rows = [saved(1, first), saved(2, second), saved(3, third)];
  // Under 46rem the open post covers the grid, taking the clicked card's focus with it.
  const container = document.createElement("div");
  container.style.width = "600px";
  await using screen = await render(<SwipeTab />, {
    container,
    service: {
      "library.savedList": () => Effect.sync(() => rows),
      "library.savedDelete": ({ id }) => {
        rows = rows.filter((r) => r.id !== id);
        return Effect.void;
      },
    },
  });
  // The card's own button comes first; its hover actions follow it.
  const cardButton = (text: string) => card(screen, text).getByRole("button").first();

  const detail = await inspect(screen, second.text);
  await expect.element(detail.getByRole("button", { name: "Close" })).toHaveFocus();
  await userEvent.click(detail.getByRole("button", { name: "Close" }));
  await expect.element(cardButton(second.text)).toHaveFocus();

  await inspect(screen, second.text);
  await userEvent.click(detail.getByRole("button", { name: "Delete saved post" }));
  await expect.element(screen.getByText(second.text)).not.toBeInTheDocument();
  await expect.element(cardButton(third.text)).toHaveFocus();
});

it("marks a post saved though the swipe file's latest 200 no longer hold it", async () => {
  await using screen = await render(
    <PostGrid items={[{ key: "1", post: first }]} selected={null} onSelect={() => {}} />,
    {
      service: {
        "library.savedList": () => Effect.succeed([]),
        "library.savedIds": () => Effect.succeed([first.postId]),
      },
    },
  );
  await userEvent.hover(card(screen, first.text));
  await expect.element(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
});

it("keeps a paid search shut until its price arrives, Enter included", async () => {
  const searches: Array<string> = [];
  await using screen = await render(<SearchTab initialQuery="ai agents" />, {
    service: {
      // "ai agents" is priced; any other query, and every next page, is still being quoted.
      "costs.quote": ({ actions }) =>
        actions.some(
          (a) => a.kind === "search" && (a.query !== "ai agents" || a.cursor !== undefined),
        )
          ? Effect.never
          : Effect.succeed({ rates, quotes: actions.map(() => paid(0.00075)) }),
      "library.search": ({ query }) => {
        searches.push(query);
        return Effect.succeed({ items: [first], nextCursor: "c2" });
      },
      "library.collectionsList": () => Effect.succeed([]),
      "library.savedList": () => Effect.succeed([]),
    },
  });
  const box = screen.getByLabelText("Search query");
  await userEvent.fill(box, "unpriced");
  await expect.element(screen.getByRole("button", { name: /^Search/ })).toBeDisabled();
  await userEvent.type(box, "{Enter}");

  await userEvent.fill(box, "ai agents");
  await userEvent.click(screen.getByRole("button", { name: /^Search.*\$0\.00075$/ }));
  await expect.element(screen.getByText(first.text)).toBeVisible();
  expect(searches).toEqual(["ai agents"]);
  await expect.element(screen.getByRole("button", { name: /^Load more/ })).toBeDisabled();
});

it("runs a paid search once while it is out, whatever submits it again", async () => {
  let release = () => {};
  const answered = new Promise<void>((resolve) => (release = resolve));
  const searches: Array<string> = [];
  await using screen = await render(<SearchTab initialQuery="ai agents" />, {
    service: {
      "costs.quote": quoting(() => paid(0.00075)),
      "library.search": ({ query }) => {
        searches.push(query);
        return Effect.promise(() => answered).pipe(Effect.as({ items: [first], nextCursor: null }));
      },
      "library.collectionsList": () => Effect.succeed([]),
      "library.savedList": () => Effect.succeed([]),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Search.*\$0\.00075$/ }));
  await expect.poll(() => searches).toEqual(["ai agents"]);
  await userEvent.type(screen.getByLabelText("Search query"), "{Enter}");
  release();
  await expect.element(screen.getByText(first.text)).toBeVisible();
  expect(searches).toEqual(["ai agents"]);
});

it("declining a collection's delete deletes nothing and keeps it open", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const deleted: Array<number> = [];
  await using screen = await render(<CollectionsTab />, {
    service: {
      "library.collectionsList": () =>
        Effect.succeed([collection(1, "Staff picks", true), collection(2, "Hooks")]),
      "library.collectionDelete": ({ id }) => {
        deleted.push(id);
        return Effect.void;
      },
      "library.savedList": ({ collectionId }) =>
        Effect.succeed(collectionId === 2 ? [saved(5, first)] : []),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Hooks/ }));
  await expect.element(screen.getByText(first.text)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Delete Hooks" }));
  expect(confirm).toHaveBeenCalledOnce();
  await expect
    .element(screen.getByRole("button", { name: /^Hooks/ }))
    .toHaveAttribute("data-active", "true");
  await expect.element(screen.getByText(first.text)).toBeVisible();
  expect(deleted).toEqual([]);
});

it("renames a collection inline, and the rail shows the new name", async () => {
  let collections = [collection(1, "Staff picks", true), collection(2, "Hooks")];
  const renames: Array<{ readonly id: number; readonly name: string }> = [];
  await using screen = await render(<CollectionsTab />, {
    service: {
      "library.collectionsList": () => Effect.sync(() => collections),
      "library.collectionRename": (input) => {
        renames.push(input);
        collections = [collection(1, "Staff picks", true), collection(input.id, input.name)];
        return Effect.void;
      },
      "library.savedList": () => Effect.succeed([]),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Rename Hooks" }));
  await userEvent.fill(screen.getByLabelText("Collection name"), "  Openers ");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("button", { name: /^Openers/ })).toBeVisible();
  expect(renames).toEqual([{ id: 2, name: "Openers" }]);
});

it("asks the service for the archive in the chosen order", async () => {
  const asked: Array<string | undefined> = [];
  await using screen = await render(<ArchiveTab />, {
    service: {
      "library.browse": ({ sort }) => {
        asked.push(sort);
        return Effect.succeed([]);
      },
      "costs.quote": quoting(),
      "library.savedList": () => Effect.succeed([]),
    },
  });
  await expect.poll(() => asked).toEqual(["views"]);
  await userEvent.click(screen.getByRole("button", { name: "Most views" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Newest" }));
  await expect.poll(() => asked).toEqual(["views", "newest"]);
});

it("finds archived posts by wording in the service, with no paid read", async () => {
  const asked: Array<string | undefined> = [];
  const archived = [first, second, third].map((post) => ({
    post,
    format: "text" as const,
    hookPattern: null,
    lastSeenAt: "2026-10-23T12:00:00.000Z",
  }));
  await using screen = await render(<ArchiveTab />, {
    service: {
      "library.browse": ({ query }) => {
        asked.push(query);
        return Effect.succeed(
          archived.filter((r) => r.post.text.toLowerCase().includes(query?.toLowerCase() ?? "")),
        );
      },
      "costs.quote": quoting(),
      "library.savedList": () => Effect.succeed([]),
    },
  });
  await expect.element(screen.getByText(second.text)).toBeVisible();
  await userEvent.fill(screen.getByLabelText("Find in archive"), "pricing");
  await expect.element(screen.getByText(third.text)).toBeVisible();
  await expect.element(screen.getByText(second.text)).not.toBeInTheDocument();
  expect(asked.at(-1)).toBe("pricing");

  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  await expect.element(screen.getByText(second.text)).toBeVisible();
  expect(asked.at(-1)).toBeUndefined();
});

it("prices the day's fetches before they run and labels each model call", async () => {
  await using screen = await render(<PicksTab />, {
    service: {
      "library.picksGet": () =>
        Effect.succeed({
          day: "2026-10-24",
          keywords: ["ai"],
          pending: ["ai"],
          picks: [{ day: "2026-10-24", keyword: "ai", post: first, whyItWorks: null }],
        }),
      "library.staffPicks": () =>
        Effect.succeed([
          { handle: "levelsio", postId: "77", topic: "building" as const, post: null },
        ]),
      "library.pickWhy": () => Effect.succeed("Hook names the pain.\nList format."),
      "library.collectionsList": () => Effect.succeed([]),
      "library.savedList": () => Effect.succeed([]),
      "costs.quote": ({ actions }) =>
        Effect.succeed({
          rates,
          quotes: actions.map((a) => paid(a.kind === "trending" ? 0.001 : 0.00075)),
        }),
    },
  });
  await expect
    .element(screen.getByRole("button", { name: /^Fetch 1 keyword.*\$0\.00075$/ }))
    .toBeVisible();
  // One trends read, then one model call for all three.
  await expect
    .element(screen.getByRole("button", { name: /^Write 3 ready posts.*\$0\.001 \+ \$0\.00075$/ }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Fetch text for 1 authors.*\$0\.00075$/ }))
    .toBeVisible();
  // Why it works and Ready to post are each one model call, priced beside it.
  const pickPost = await inspect(screen, first.text);
  await expect.element(pickPost.getByRole("button", { name: "Explain it" })).toBeVisible();
  expect(pickPost.getByText("$0.00075", { exact: true }).elements()).toHaveLength(2);
  await userEvent.click(pickPost.getByRole("button", { name: "Explain it" }));
  await expect.element(pickPost.getByText("Hook names the pain.", { exact: false })).toBeVisible();
});

it("prices trend ideas by the country whose trends are loaded", async () => {
  await using screen = await render(<TrendsTab />, {
    service: {
      // The loaded country's trends are cached; another country's would be a paid read.
      "costs.quote": ({ actions }) =>
        Effect.succeed({
          rates,
          quotes: actions.map((a) =>
            a.kind === "trending" && a.country === "UnitedStates"
              ? { usd: 0, cached: true }
              : paid(0.001),
          ),
        }),
      "library.trends": () =>
        Effect.succeed([{ name: "#buildinpublic", context: null, postCount: 1200 }]),
    },
  });
  // Ideas need loaded trends: before Load there is no button for them.
  expect(screen.getByRole("button", { name: /^Write 5 ideas/ }).elements()).toHaveLength(0);
  // Before Load the empty state offers the header's Load too.
  await userEvent.click(
    screen.getByRole("button", { name: /^Load trends.*cached, free$/ }).first(),
  );
  await expect.element(screen.getByText("#buildinpublic")).toBeVisible();

  await userEvent.selectOptions(screen.getByLabelText("Country"), "UnitedKingdom");
  await expect
    .element(screen.getByRole("button", { name: /^Load trends.*\$0\.001$/ }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Write 5 ideas.*cached, free \+ \$0\.001$/ }))
    .toBeEnabled();
});

it("Load trends on the country already shown reads it again", async () => {
  let reads = 0;
  await using screen = await render(<TrendsTab />, {
    service: {
      "costs.quote": quoting(),
      "library.trends": () =>
        Effect.sync(() => [{ name: `#read${++reads}`, context: null, postCount: 1 }]),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Load trends/ }).first());
  await expect.element(screen.getByText("#read1")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^Load trends/ }));
  await expect.element(screen.getByText("#read2")).toBeVisible();
});

it("ideas stay with the country they were written for", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  await using screen = await render(<TrendsTab />, {
    service: {
      "costs.quote": quoting(),
      "library.trends": () =>
        Effect.succeed([{ name: "#buildinpublic", context: null, postCount: 1200 }]),
      // The second generation is still out when the user moves on to another country.
      "library.trendIdeas": ({ country }) => {
        const ideas = [
          { trend: "#buildinpublic", angle: "ship", text: `${country} idea ${++calls}` },
        ];
        return calls === 1
          ? Effect.succeed(ideas)
          : Effect.promise(() => held).pipe(Effect.as(ideas));
      },
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Load trends/ }).first());
  await userEvent.click(screen.getByRole("button", { name: /^Write 5 ideas/ }));
  await expect.element(screen.getByText("UnitedStates idea 1")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^Write 5 more/ }));

  await userEvent.selectOptions(screen.getByLabelText("Country"), "UnitedKingdom");
  await userEvent.click(screen.getByRole("button", { name: /^Load trends/ }));
  await expect.element(screen.getByText("UnitedStates idea 1")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: /^Write 5 ideas/ })).toBeEnabled();
  // The late answer for the United States has nowhere to land.
  release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByText("UnitedStates idea 2").elements()).toHaveLength(0);
});

it("dragging a saved card onto another collection files it there", async () => {
  const saves: Array<number | null> = [];
  await using screen = await render(<CollectionsTab />, {
    service: {
      "library.collectionsList": () =>
        Effect.succeed([
          collection(1, "Staff picks", true),
          collection(2, "Hooks"),
          collection(3, "Threads"),
        ]),
      "library.savedList": ({ collectionId }) =>
        Effect.succeed(collectionId === 2 ? [saved(5, first)] : []),
      "library.save": ({ collectionId, post }) => {
        saves.push(collectionId);
        return Effect.succeed(saved(9, post));
      },
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Hooks/ }));
  await expect.element(screen.getByText(first.text)).toBeVisible();

  await screen.getByText(first.text).dropTo(screen.getByRole("button", { name: /^Threads/ }));
  await expect
    .element(screen.getByRole("button", { name: /^Threads/ }))
    .toHaveAttribute("data-active", "true");
  expect(saves).toEqual([3]);
});
