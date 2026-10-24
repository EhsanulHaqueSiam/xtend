import type {
  CostAction,
  LeadList,
  ListCriteria,
  Person,
  PersonUpdate,
  SignalAgent,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { paid, quoting, settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Agents } from "./Agents";
import { Followers } from "./Followers";
import { Lists } from "./Lists";
import { People } from "./People";

const follower = {
  userId: "900",
  handle: "newfan",
  name: "New Fan",
  followers: 1200,
  following: 300,
  verified: false,
  bio: "builds in public",
  createdAt: null,
  inPeople: false,
  score: 40,
  tier: "Noted" as const,
};

it("prices the follower check from the service's quote, free while a fresh page is cached", async () => {
  const asked: Array<CostAction> = [];
  const added: Array<string> = [];
  await using screen = await render(<Followers />, {
    service: {
      "settings.get": () => Effect.succeed(settings),
      // A check minutes ago left a page the service serves again for free.
      "costs.quote": quoting((a) => {
        asked.push(a);
        return a.kind === "followersPage" ? { usd: 0, cached: true } : paid(0.001);
      }),
      "leads.newFollowers": () => Effect.succeed({ followers: [follower], costUsd: 0 }),
      "leads.personAdd": (input) =>
        Effect.sync(() => {
          added.push(input.handle);
          return person(1, { handle: input.handle });
        }),
      "leads.peopleList": () => Effect.succeed([]),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Check new followers (cached, free)" }));
  await expect.element(screen.getByText("1 new · cost $0")).toBeVisible();
  expect(asked).toContainEqual({ kind: "followersPage", handle: settings.handle });

  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await expect.element(screen.getByText("in people")).toBeVisible();
  expect(added).toEqual(["newfan"]);
});

it("asks for a handle before a follower check can run", async () => {
  await using screen = await render(<Followers />, {
    service: {
      "settings.get": () => Effect.succeed({ ...settings, handle: null }),
      "costs.quote": quoting(),
    },
  });
  await expect.element(screen.getByText("Set your X handle in Settings first.")).toBeVisible();
  expect(screen.getByRole("button", { name: /Check new followers/ }).elements()).toHaveLength(0);
});

const list = (id: number, name: string): LeadList => ({
  id,
  name,
  createdAt: "2026-10-20T00:00:00.000Z",
  members: 0,
});

const person = (id: number, extra: Partial<Person> = {}): Person => ({
  id,
  handle: `lead${id}`,
  name: `Lead ${id}`,
  userId: null,
  followers: 500,
  bio: "",
  stage: "new",
  notes: "",
  score: null,
  tier: null,
  source: "search",
  firstSeen: "2026-10-20T00:00:00.000Z",
  lastActivity: "2026-10-20T00:00:00.000Z",
  ...extra,
});

it("a preview belongs to the list it was built in, and a pasted post URL fetches its engagers", async () => {
  const previews: Array<ListCriteria> = [];
  const fetched: Array<{ readonly postId: string; readonly via: string }> = [];
  await using screen = await render(<Lists />, {
    service: {
      "costs.quote": quoting(),
      "leads.listsList": () => Effect.succeed([list(1, "Founders"), list(2, "Investors")]),
      "leads.peopleList": () => Effect.succeed([]),
      "leads.engagersQuote": ({ via }) => Effect.succeed({ costUsd: via === "like" ? 0.2 : 0.001 }),
      "leads.listPreview": (criteria) =>
        Effect.sync(() => {
          previews.push(criteria);
          return {
            matches: [{ handle: "ada", name: "Ada", userId: "5", followers: 900, bio: "" }],
            costUsd: 0.00075,
          };
        }),
      "leads.engagers": (input) =>
        Effect.sync(() => {
          fetched.push(input);
          return { matches: [], costUsd: 0.001 };
        }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Founders/ }));
  await userEvent.fill(
    screen.getByPlaceholder('"typefully alternative" OR "schedule tweets"'),
    "saas founder",
  );
  await userEvent.fill(screen.getByPlaceholder("min followers"), "1k00");
  await userEvent.click(screen.getByRole("button", { name: "Preview ($0.00075)" }));
  await expect.element(screen.getByText("1 matches · cost $0.00075")).toBeVisible();
  expect(previews).toEqual([{ query: "saas founder", minFollowers: 100 }]);

  // Picking another list starts it clean: Founders' matches must not be added to Investors.
  await userEvent.click(screen.getByRole("button", { name: /^Investors/ }));
  expect(screen.getByRole("button", { name: "Add all to list" }).elements()).toHaveLength(0);

  const post = screen.getByLabelText("Post id or URL");
  const fetch = screen.getByRole("button", { name: "Fetch ($0.001)" });
  await userEvent.fill(post, "https://x.com/levelsio");
  await expect.element(fetch).toBeDisabled();
  await userEvent.fill(post, "https://x.com/levelsio/status/456?s=20");
  await userEvent.click(fetch);
  await expect.element(screen.getByText("0 people · cost $0.001")).toBeVisible();
  expect(fetched).toEqual([{ postId: "456", via: "repost" }]);
});

const agent = (id: number, name: string, extra: Partial<SignalAgent> = {}): SignalAgent => ({
  id,
  name,
  query: `${name} query`,
  minFollowers: 0,
  intervalMinutes: 30,
  enabled: true,
  scoringPrompt: "",
  lang: null,
  excludeBots: false,
  notifyMinScore: null,
  listId: null,
  lastRun: null,
  ...extra,
});

it("edits the agent that was clicked, and prices a bot-checking run with its profile reads", async () => {
  const saved: Array<string> = [];
  await using screen = await render(<Agents />, {
    service: {
      "costs.quote": quoting(),
      "leads.listsList": () => Effect.succeed([]),
      "leads.agentsList": () =>
        Effect.succeed([agent(1, "founders"), agent(2, "devtools", { excludeBots: true })]),
      "leads.agentUpsert": (input) =>
        Effect.sync(() => {
          saved.push(input.query);
          return { ...input, id: input.id ?? 9, lastRun: null };
        }),
    },
  });
  // One search page; dropping bots reads a profile per author, up to 50.
  await expect.element(screen.getByRole("button", { name: "Run now ($0.00075)" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Run now (up to $0.01175)" }))
    .toBeVisible();

  const edit = screen.getByRole("button", { name: "Edit", exact: true });
  await userEvent.click(edit.nth(0));
  await expect.element(screen.getByText("Edit founders")).toBeVisible();
  await userEvent.click(edit.nth(1));
  await expect.element(screen.getByText("Edit devtools")).toBeVisible();
  const query = screen.getByPlaceholder('Search: "typefully alternative" OR "tweet hunter"');
  await expect.element(query).toHaveValue("devtools query");
  await expect.element(screen.getByText("up to $0.01175 per run")).toBeVisible();

  await userEvent.fill(query, "devtools launch");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => saved).toEqual(["devtools launch"]);
});

it("changes a stage, and prices a DM to someone without a user id with the profile lookup", async () => {
  const updates: Array<PersonUpdate> = [];
  const dms: Array<string> = [];
  let people = [person(1), person(2, { userId: "22" })];
  await using screen = await render(<People listId={null} />, {
    service: {
      "costs.quote": quoting(),
      "leads.peopleList": () => Effect.sync(() => people),
      "leads.personUpdate": (patch) =>
        Effect.sync(() => {
          updates.push(patch);
          people = people.map((p) =>
            p.id === patch.id ? { ...p, stage: patch.stage ?? p.stage } : p,
          );
          return people.find((p) => p.id === patch.id)!;
        }),
      "leads.personGet": ({ id }) =>
        Effect.sync(() => ({ person: people.find((p) => p.id === id)!, activity: [] })),
      "leads.sendDm": ({ text }) => Effect.sync(() => void dms.push(text)),
    },
  });
  await userEvent.selectOptions(screen.getByLabelText("Stage of @lead2"), "contacted");
  await expect.poll(() => updates).toEqual([{ id: 2, stage: "contacted" }]);
  await expect.element(screen.getByLabelText("Stage of @lead2")).toHaveValue("contacted");

  await userEvent.click(screen.getByText("Lead 1", { exact: true }));
  await userEvent.fill(screen.getByPlaceholder("DM text"), "Loved your launch");
  // $0.015 for the DM, plus the $0.00022 profile read that finds the user id.
  await userEvent.click(screen.getByRole("button", { name: "Send DM ($0.01522)" }));
  await expect.poll(() => dms).toEqual(["Loved your launch"]);
  await expect.element(screen.getByPlaceholder("DM text")).toHaveValue("");

  // The panel follows the person: what was typed for one is not sent to the next.
  await userEvent.fill(screen.getByPlaceholder("DM text"), "draft for lead 1");
  await userEvent.click(screen.getByText("Lead 2", { exact: true }));
  await expect.element(screen.getByPlaceholder("DM text")).toHaveValue("");
  await expect.element(screen.getByRole("button", { name: "Send DM ($0.015)" })).toBeDisabled();
});
