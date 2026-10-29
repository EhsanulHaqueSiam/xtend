import { type Collection, LibraryError, type SavedPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { paid, rates, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { CollectionsTab } from "./CollectionsTab";
import { PicksTab } from "./PicksTab";
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
  // A `?q=` link searches on arrival.
  await expect.poll(() => searches).toEqual([{ query: "ai agents", mode: "top" }]);
  await expect
    .element(screen.getByRole("button", { name: /^Search.*cached, free$/ }))
    .toBeVisible();
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

it("searches the swipe file, keeps a note on blur, and drops a removed post", async () => {
  let rows = [saved(1, first), saved(2, second)];
  const notes: Array<{ readonly id: number; readonly note: string }> = [];
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

  const secondPost = await inspect(screen, second.text);
  await userEvent.click(secondPost.getByRole("button", { name: "Remove" }));
  await expect.element(screen.getByText(second.text)).not.toBeInTheDocument();
  await expect.element(screen.getByText(first.text)).toBeVisible();
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
    .element(screen.getByRole("button", { name: /^Write 5 ideas.*\$0\.001$/ }))
    .toBeEnabled();
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
