import {
  LeadsError,
  SettingsError,
  type CostAction,
  type LeadList,
  type ListCriteria,
  type Person,
  type PersonUpdate,
  type SignalAgent,
  type SignalAgentInput,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { peoplePage, paid, quoting, settings, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { AgentsSection } from "./Agents";
import { FollowersSection } from "./Followers";
import { ListsSection } from "./Lists";
import { PeopleSection } from "./People";

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
  await using screen = await render(<FollowersSection />, {
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
      "leads.peopleList": () => Effect.succeed(peoplePage()),
    },
  });
  await userEvent.click(
    screen.getByRole("button", { name: /^Check new followers.*cached, free$/ }),
  );
  await expect.element(screen.getByText("1 new · $0")).toBeVisible();
  expect(asked).toContainEqual({ kind: "followersPage", handle: settings.handle });

  // The first follower opens beside the list.
  await userEvent.click(screen.getByRole("button", { name: /^Add to people/ }));
  await expect.element(screen.getByRole("button", { name: /^In people/ })).toBeDisabled();
  expect(added).toEqual(["newfan"]);
});

it("asks for a handle before a follower check can run", async () => {
  await using screen = await render(<FollowersSection />, {
    service: {
      "settings.get": () => Effect.succeed({ ...settings, handle: null }),
      "costs.quote": quoting(),
    },
  });
  await expect.element(screen.getByText(/^New followers need your handle/)).toBeVisible();
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
  await using screen = await render(<ListsSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.listsList": () => Effect.succeed([list(1, "Founders"), list(2, "Investors")]),
      "leads.peopleList": () => Effect.succeed(peoplePage()),
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
  // Founders opens first; Add people opens the builder beside its people.
  const addPeople = screen.getByRole("button", { name: "Add people" }).first();
  await userEvent.click(addPeople);
  await userEvent.fill(screen.getByPlaceholder('"typefully alternative"'), "saas founder");
  await userEvent.fill(screen.getByPlaceholder("any", { exact: true }), "1k00");
  await userEvent.click(screen.getByRole("button", { name: /^Preview.*\$0\.00075$/ }));
  await expect.element(screen.getByText("spent $0.00075")).toBeVisible();
  expect(previews).toEqual([{ query: "saas founder", minFollowers: 100 }]);

  // Picking another list starts it clean: Founders' matches must not be added to Investors.
  await userEvent.click(screen.getByRole("button", { name: /^Founders/ }));
  await userEvent.click(page.getByRole("button", { name: /^Investors/ }));
  const addAll = screen.getByRole("button", { name: /Add all to list/ });
  await expect.element(addAll).not.toBeInTheDocument();
  await userEvent.click(addPeople);
  await expect.element(addAll).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "From a post" }));
  const post = screen.getByPlaceholder("Post URL or id");
  const fetch = screen.getByRole("button", { name: /^Fetch.*\$0\.001$/ });
  await userEvent.fill(post, "https://x.com/levelsio");
  await expect.element(fetch).toBeDisabled();
  await userEvent.fill(post, "https://x.com/levelsio/status/456?s=20");
  await userEvent.click(fetch);
  await expect.element(screen.getByText("spent $0.001")).toBeVisible();
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

it("saving an agent's settings after Pause keeps it paused", async () => {
  let stored = agent(1, "founders");
  const upserts: Array<SignalAgentInput> = [];
  await using screen = await render(<AgentsSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.listsList": () => Effect.succeed([]),
      "leads.agentsList": () => Effect.sync(() => [stored]),
      "leads.agentUpsert": (input) =>
        Effect.sync(() => {
          upserts.push(input);
          stored = { ...stored, ...input, id: 1 };
          return stored;
        }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Pause" }));
  await expect.element(screen.getByRole("button", { name: "Resume" })).toBeVisible();
  await userEvent.fill(screen.getByPlaceholder('"typefully alternative" OR "tweet hunter"'), "new");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect
    .poll(() => upserts.map((u) => [u.query, u.enabled]))
    .toEqual([
      ["founders query", false],
      ["new", false],
    ]);
});

it("edits the agent that was clicked, and prices a bot-checking run with its profile reads", async () => {
  const saved: Array<string> = [];
  await using screen = await render(<AgentsSection />, {
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
  // The first agent opens beside the list: one search page per run, plus the model call that scores.
  const query = screen.getByPlaceholder('"typefully alternative" OR "tweet hunter"');
  await expect.element(query).toHaveValue("founders query");
  await expect
    .element(screen.getByRole("button", { name: /^Run now.*\$0\.00075 \+ \$0\.001$/ }))
    .toBeVisible();

  // Dropping bots reads a profile per author, up to 50.
  await userEvent.click(screen.getByRole("button", { name: /^devtools/ }));
  await expect.element(query).toHaveValue("devtools query");
  await expect
    .element(screen.getByRole("button", { name: /^Run now.*up to \$0\.01175 \+ \$0\.001$/ }))
    .toBeVisible();

  await userEvent.fill(query, "devtools launch");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => saved).toEqual(["devtools launch"]);
});

it("changes a stage, and prices a DM to someone without a user id with the profile lookup", async () => {
  const updates: Array<PersonUpdate> = [];
  const dms: Array<{ readonly id: number; readonly text: string }> = [];
  let people = [person(1), person(2, { userId: "22" })];
  await using screen = await render(<PeopleSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.peopleList": (query) => Effect.sync(() => peoplePage(people, query)),
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
      "leads.sendDm": (input) => Effect.sync(() => void dms.push(input)),
    },
  });
  // The stage is set from the selected person's panel.
  await userEvent.click(screen.getByRole("button", { name: /^@lead2/ }));
  const contacted = screen.getByRole("button", { name: "contacted", exact: true });
  await userEvent.click(contacted);
  await expect.poll(() => updates).toEqual([{ id: 2, stage: "contacted" }]);
  await expect.element(contacted).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(screen.getByRole("button", { name: /^@lead1/ }));
  const dm = screen.getByPlaceholder("Write a DM");
  await userEvent.fill(dm, "Loved your launch");
  // $0.015 for the DM, plus the $0.00022 profile read that finds the user id.
  await userEvent.click(screen.getByRole("button", { name: /^Send DM.*\$0\.01522$/ }));
  // To the person whose panel it was typed in.
  await expect.poll(() => dms).toEqual([{ id: 1, text: "Loved your launch" }]);
  await expect.element(dm).toHaveValue("");

  // The panel follows the person: what was typed for one is not sent to the next.
  await userEvent.fill(dm, "draft for lead 1");
  await userEvent.click(screen.getByRole("button", { name: /^@lead2/ }));
  await expect.element(dm).toHaveValue("");
  await expect.element(screen.getByRole("button", { name: /^Send DM.*\$0\.015$/ })).toBeDisabled();
});

it("a DM starts as your own words; a tone asks for three drafts to pick and edit", async () => {
  const asked: Array<string | undefined> = [];
  await using screen = await render(<PeopleSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.peopleList": () => Effect.succeed(peoplePage([person(1)])),
      "leads.personGet": () => Effect.succeed({ person: person(1), activity: [] }),
      "leads.draftDm": ({ tone }) =>
        Effect.sync(() => {
          asked.push(tone);
          return { drafts: ["one", "two", "three"] };
        }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^@lead1/ }));
  const dm = screen.getByLabelText("DM text");
  await expect
    .element(screen.getByRole("button", { name: "Write my own" }).first())
    .toHaveAttribute("aria-pressed", "true");

  await userEvent.click(screen.getByRole("button", { name: "Sarcastic" }).first());
  await expect.element(dm).toHaveValue("one");
  expect(asked).toEqual(["sarcastic"]);
  await userEvent.click(screen.getByRole("button", { name: /^B/ }));
  await expect.element(dm).toHaveValue("two");
  // Back to your own words: the drafts go, what is in the box stays yours to edit.
  await userEvent.click(screen.getByRole("button", { name: "Write my own" }).first());
  expect(screen.getByRole("list", { name: "Drafts" }).elements()).toHaveLength(0);
  await expect.element(dm).toHaveValue("two");
});

it("dragging a card onto a stage column moves the person there", async () => {
  const updates: Array<PersonUpdate> = [];
  let people = [person(1), person(2)];
  await using screen = await render(<PeopleSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.peopleList": (query) => Effect.sync(() => peoplePage(people, query)),
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
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Stages" }));
  const card = screen.getByRole("button", { name: /^@lead2/ });
  await card.dropTo(screen.getByRole("region", { name: "contacted" }));
  await expect.poll(() => updates).toEqual([{ id: 2, stage: "contacted" }]);
  await expect
    .element(
      screen.getByRole("region", { name: "contacted" }).getByRole("button", { name: /^@lead2/ }),
    )
    .toBeVisible();
});

/** People and the reads and writes their panel makes, kept as the service keeps them. */
const peopleService = (start: ReadonlyArray<Person>, extra: FakeService = {}): FakeService => {
  let people = start;
  return {
    "costs.quote": quoting(),
    "leads.peopleList": (query) => Effect.sync(() => peoplePage(people, query)),
    "leads.personUpdate": ({ id, stage, notes }) =>
      Effect.sync(() => {
        people = people.map((p) =>
          p.id === id ? { ...p, stage: stage ?? p.stage, notes: notes ?? p.notes } : p,
        );
        return people.find((p) => p.id === id)!;
      }),
    "leads.personGet": ({ id }) =>
      Effect.sync(() => ({ person: people.find((p) => p.id === id)!, activity: [] })),
    ...extra,
  };
};

it("a note written, left and returned to is still there", async () => {
  await using screen = await render(<PeopleSection />, {
    service: peopleService([person(1), person(2)]),
  });
  const notes = screen.getByPlaceholder("What you know about them");
  await userEvent.fill(notes, "met at a meetup");
  // Picking someone else blurs the box, which saves it.
  await userEvent.click(screen.getByRole("button", { name: /^@lead2/ }));
  await expect.element(notes).toHaveValue("");
  await userEvent.click(screen.getByRole("button", { name: /^@lead1/ }));
  await expect.element(notes).toHaveValue("met at a meetup");
});

it("a DM in flight cannot go twice, and its text is locked until it lands", async () => {
  const sent: Array<{ readonly id: number; readonly text: string }> = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await using screen = await render(<PeopleSection />, {
    service: peopleService([person(1)], {
      "leads.sendDm": (input) =>
        Effect.promise(() => {
          sent.push(input);
          return held;
        }),
    }),
  });
  const dm = screen.getByLabelText("DM text");
  await userEvent.fill(dm, "Loved your launch");
  const send = screen.getByRole("button", { name: /^(Send DM|Sending)/ });
  await userEvent.click(send);
  await expect.element(send).toBeDisabled();
  await expect.element(dm).toBeDisabled();
  // A click straight on the element skips the wait for it to be enabled.
  send.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  release();
  await expect.element(dm).toHaveValue("");
  expect(sent).toEqual([{ id: 1, text: "Loved your launch" }]);
});

it("a person's DM, reply and paid post survive picking someone else, even mid-load", async () => {
  let releaseSecond = () => {};
  const second = new Promise<void>((resolve) => (releaseSecond = resolve));
  await using screen = await render(<PeopleSection />, {
    service: peopleService([person(1), person(2)], {
      "leads.latestPost": ({ id }) =>
        Effect.promise(() => (id === 2 ? second : Promise.resolve())).pipe(
          Effect.as(xPost(`${id}00`, `post by lead ${id}`)),
        ),
    }),
  });
  const dm = screen.getByLabelText("DM text");
  const reply = screen.getByPlaceholder("Write a reply");
  const load = screen.getByRole("button", { name: /^Load their latest post/ });
  await userEvent.fill(dm, "hi lead 1");
  await userEvent.click(load);
  await userEvent.fill(reply, "reply to lead 1");

  // Lead 2's paid read is still out when the user goes back to lead 1.
  await userEvent.click(screen.getByRole("button", { name: /^@lead2/ }));
  await expect.element(dm).toHaveValue("");
  await userEvent.click(load);
  await userEvent.click(screen.getByRole("button", { name: /^@lead1/ }));
  await expect.element(dm).toHaveValue("hi lead 1");
  await expect.element(screen.getByText("post by lead 1")).toBeVisible();
  await expect.element(reply).toHaveValue("reply to lead 1");

  releaseSecond();
  await userEvent.click(screen.getByRole("button", { name: /^@lead2/ }));
  await expect.element(screen.getByText("post by lead 2")).toBeVisible();
});

it("a reply written for one post is dropped when From X finds a newer one", async () => {
  let latest = xPost("100", "first post");
  await using screen = await render(<PeopleSection />, {
    service: peopleService([person(1)], { "leads.latestPost": () => Effect.sync(() => latest) }),
  });
  await userEvent.click(screen.getByRole("button", { name: /^Load their latest post/ }));
  const reply = screen.getByPlaceholder("Write a reply");
  await userEvent.fill(reply, "about the first post");
  latest = xPost("101", "second post");
  await userEvent.click(screen.getByRole("button", { name: /^From X/ }));
  await expect.element(screen.getByText("second post")).toBeVisible();
  await expect.element(reply).toHaveValue("");
});

it("says why a person's record or the settings failed, instead of waiting forever", async () => {
  {
    await using screen = await render(<PeopleSection />, {
      service: peopleService([person(1)], {
        "leads.personGet": () =>
          Effect.fail(
            new LeadsError({ operation: "get", detail: "database is locked", cause: null }),
          ),
      }),
    });
    await expect.element(screen.getByText(/database is locked/)).toBeVisible();
    expect(screen.getByText("Loading…").elements()).toHaveLength(0);
  }
  await using screen = await render(<FollowersSection />, {
    service: {
      "settings.get": () => Effect.fail(new SettingsError({ operation: "get", cause: null })),
      "costs.quote": quoting(),
    },
  });
  await expect.element(screen.getByText("Settings failed during get.")).toBeVisible();
});

it("paid builders and agent actions wait for their price, from the button and from Enter", async () => {
  const calls: Array<string> = [];
  {
    await using screen = await render(<ListsSection />, {
      service: {
        "costs.quote": () => Effect.never,
        "leads.engagersQuote": () => Effect.never,
        "leads.listsList": () => Effect.succeed([list(1, "Founders")]),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.listPreview": () =>
          Effect.sync(() => {
            calls.push("preview");
            return { matches: [], costUsd: 0 };
          }),
        "leads.engagers": () =>
          Effect.sync(() => {
            calls.push("engagers");
            return { matches: [], costUsd: 0 };
          }),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add people" }).first());
    await userEvent.fill(screen.getByPlaceholder('"typefully alternative"'), "saas founder");
    await expect.element(screen.getByRole("button", { name: /^Preview/ })).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "From a post" }));
    await userEvent.fill(screen.getByPlaceholder("Post URL or id"), "456");
    await expect.element(screen.getByRole("button", { name: /^Fetch/ })).toBeDisabled();
    await userEvent.keyboard("{Enter}");
  }
  await using screen = await render(<AgentsSection />, {
    service: {
      "costs.quote": () => Effect.never,
      "leads.listsList": () => Effect.succeed([]),
      "leads.agentsList": () => Effect.succeed([]),
    },
  });
  await expect.element(screen.getByRole("button", { name: /^Suggest with AI/ })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "New agent" }).first());
  await userEvent.fill(screen.getByPlaceholder("Typefully switchers"), "founders");
  await userEvent.fill(screen.getByPlaceholder('"typefully alternative" OR "tweet hunter"'), "q");
  await expect.element(screen.getByRole("button", { name: "Save and start" })).toBeDisabled();
  expect(calls).toEqual([]);
});

it("a new agent's save says it starts the paid runs, beside their price", async () => {
  const saved: Array<SignalAgentInput> = [];
  await using screen = await render(<AgentsSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.listsList": () => Effect.succeed([]),
      "leads.agentsList": () => Effect.succeed([]),
      "leads.agentUpsert": (input) =>
        Effect.sync(() => {
          saved.push(input);
          return { ...input, id: 1, lastRun: null };
        }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "New agent" }).first());
  await userEvent.fill(screen.getByPlaceholder("Typefully switchers"), "founders");
  await userEvent.fill(screen.getByPlaceholder('"typefully alternative" OR "tweet hunter"'), "q");
  // The price of a run stays beside the button that starts them.
  await expect.element(screen.getByText("$0.00075 + $0.001", { exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Save and start" }));
  await expect.poll(() => saved.map((a) => a.enabled)).toEqual([true]);
});

it("Escape closes the new-agent editor and hands focus back to New agent", async () => {
  await using screen = await render(<AgentsSection />, {
    service: {
      "costs.quote": quoting(),
      "leads.listsList": () => Effect.succeed([]),
      "leads.agentsList": () => Effect.succeed([]),
    },
  });
  const open = screen.getByRole("button", { name: "New agent" }).first();
  await userEvent.click(open);
  await expect.element(screen.getByPlaceholder("Typefully switchers")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByPlaceholder("Typefully switchers")).not.toBeInTheDocument();
  await expect.element(open).toHaveFocus();
});

it("pages and searches all People with true stage counts in the table and board", async () => {
  const people = Array.from({ length: 251 }, (_, i) =>
    person(i + 1, { stage: i < 240 ? "new" : "contacted" }),
  );
  const queries: Array<import("@xtend/contracts").PeopleQuery> = [];
  await using screen = await render(<PeopleSection />, {
    service: peopleService(people, {
      "leads.peopleList": (query) =>
        Effect.sync(() => {
          queries.push(query);
          return peoplePage(people, query);
        }),
    }),
  });
  await expect.element(screen.getByText("1-50 of 251")).toBeVisible();
  await expect.element(screen.getByRole("tab", { name: /^New.*240/ })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await expect.element(screen.getByText("51-100 of 251")).toBeVisible();
  expect(queries.at(-1)?.offset).toBe(50);
  await userEvent.fill(screen.getByRole("textbox", { name: "Search people" }), "lead251");
  await expect.element(screen.getByText("1-1 of 1")).toBeVisible();
  expect(queries.at(-1)).toMatchObject({ search: "lead251", offset: 0 });
  await userEvent.fill(screen.getByRole("textbox", { name: "Search people" }), "");
  await userEvent.click(screen.getByRole("tab", { name: /^Contacted.*11/ }));
  await expect.element(screen.getByText("1-11 of 11")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Stages", exact: true }));
  await expect
    .element(screen.getByRole("region", { name: "new", exact: true }).getByRole("heading"))
    .toHaveTextContent("new240");
  await expect
    .element(screen.getByRole("region", { name: "contacted", exact: true }).getByRole("heading"))
    .toHaveTextContent("contacted11");
  await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await expect.element(screen.getByText("51-100 of 251")).toBeVisible();
});

it("pages list members beyond the old cap and searches within the list", async () => {
  const members = Array.from({ length: 251 }, (_, i) => person(i + 1));
  const queries: Array<import("@xtend/contracts").PeopleQuery> = [];
  await using screen = await render(<ListsSection />, {
    service: peopleService(members, {
      "leads.listsList": () => Effect.succeed([{ ...list(1, "Founders"), members: 251 }]),
      "leads.peopleList": (query) =>
        Effect.sync(() => {
          queries.push(query);
          return peoplePage(members, query);
        }),
    }),
  });
  await expect.element(screen.getByText("1-50 of 251")).toBeVisible();
  // Each page must settle before its Next button can request the following page.
  /* oxlint-disable no-await-in-loop */
  for (let i = 0; i < 4; i++) {
    await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
    await expect
      .element(screen.getByText(`${(i + 1) * 50 + 1}-${(i + 2) * 50} of 251`))
      .toBeVisible();
  }
  /* oxlint-enable no-await-in-loop */
  expect(queries.at(-1)).toMatchObject({ listId: 1, offset: 200 });
  await userEvent.fill(screen.getByRole("textbox", { name: "Search people" }), "lead251");
  await expect.element(screen.getByRole("button", { name: /^@lead251/ })).toBeVisible();
  expect(queries.at(-1)).toMatchObject({ listId: 1, search: "lead251", offset: 0 });
});

it("adds existing people from the free paged builder, then removes only list membership", async () => {
  const people = Array.from({ length: 61 }, (_, i) => person(i + 1));
  const memberIds = new Set([1]);
  const added: Array<ReadonlyArray<number>> = [];
  const removed: Array<number> = [];
  const queries: Array<import("@xtend/contracts").PeopleQuery> = [];
  await using screen = await render(<ListsSection />, {
    service: peopleService(people, {
      "leads.listsList": () =>
        Effect.sync(() => [{ ...list(1, "Founders"), members: memberIds.size }]),
      "leads.peopleList": (query) =>
        Effect.sync(() => {
          queries.push(query);
          const rows =
            query.listId === 1
              ? people.filter((p) => memberIds.has(p.id))
              : query.excludeListId === 1
                ? people.filter((p) => !memberIds.has(p.id))
                : people;
          return peoplePage(rows, query);
        }),
      "leads.listAddPeople": ({ listId, personIds }) =>
        Effect.sync(() => {
          expect(listId).toBe(1);
          added.push(personIds);
          let count = 0;
          for (const id of personIds) {
            if (!memberIds.has(id)) count++;
            memberIds.add(id);
          }
          return { added: count };
        }),
      "leads.listRemovePerson": ({ listId, personId }) =>
        Effect.sync(() => {
          expect(listId).toBe(1);
          removed.push(personId);
          memberIds.delete(personId);
        }),
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Add people", exact: true }).first());
  await userEvent.click(screen.getByRole("button", { name: /^From people.*free/ }));
  await expect.element(screen.getByText("60 not in Founders")).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "Select @lead1", exact: true }).elements(),
  ).toHaveLength(0);
  await userEvent.click(screen.getByRole("checkbox", { name: "Select @lead2", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }).last());
  await expect.element(screen.getByText("51-60 of 60")).toBeVisible();
  expect(queries.at(-1)).toMatchObject({ excludeListId: 1, offset: 50 });
  await userEvent.click(screen.getByRole("checkbox", { name: "Select @lead61", exact: true }));
  await userEvent.fill(screen.getByRole("textbox", { name: "Search existing people" }), "lead61");
  await expect.element(screen.getByText("1 not in Founders")).toBeVisible();
  expect(queries.at(-1)).toMatchObject({ excludeListId: 1, search: "lead61", offset: 0 });
  await userEvent.click(screen.getByRole("button", { name: /^Add 2 to Founders.*free/ }));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Added 2");
  expect(added).toEqual([[2, 61]]);
  await expect.element(screen.getByText("0 not in Founders")).toBeVisible();
  await expect.element(screen.getByText("1-3 of 3")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^@lead2/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Remove from list.*free/ }));
  await expect.element(screen.getByText("1-2 of 2")).toBeVisible();
  expect(removed).toEqual([2]);
  expect(people).toHaveLength(61);
  await expect.element(screen.getByRole("button", { name: /^Founders.*2/ })).toBeVisible();
});

it("keeps the selection on a failed free add and resets it when switching lists", async () => {
  await using screen = await render(<ListsSection />, {
    service: peopleService([person(1), person(2)], {
      "leads.listsList": () => Effect.succeed([list(1, "Founders"), list(2, "Investors")]),
      "leads.peopleList": (query) =>
        Effect.succeed(
          peoplePage(query.excludeListId === undefined ? [] : [person(1), person(2)], query),
        ),
      "leads.listAddPeople": () =>
        Effect.fail(
          new LeadsError({ operation: "addPeopleToList", detail: "Unavailable", cause: null }),
        ),
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Add people", exact: true }).first());
  await userEvent.click(screen.getByRole("button", { name: /^From people.*free/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Select @lead1", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: /^Add 1 to Founders.*free/ }));
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect
    .element(screen.getByRole("checkbox", { name: "Select @lead1", exact: true }))
    .toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: /^Founders/ }));
  await userEvent.click(page.getByRole("button", { name: /^Investors/ }));
  await userEvent.click(screen.getByRole("button", { name: "Add people", exact: true }).first());
  await userEvent.click(screen.getByRole("button", { name: /^From people.*free/ }));
  await expect
    .element(screen.getByRole("checkbox", { name: "Select @lead1", exact: true }))
    .not.toBeChecked();
  await expect
    .element(screen.getByRole("button", { name: /^Add 0 to Investors.*free/ }))
    .toBeDisabled();
});
