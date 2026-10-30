import {
  AutomateError,
  type PendingRequest,
  type Rule,
  type RuleInput,
  type RuleRun,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { liveEvents, quoting } from "../../../test/fixtures";
import { choose, render } from "../../../test/render";
import { DryRun } from "./DryRun";
import { NeedsYou } from "./NeedsYou";
import { RuleDetail } from "./RuleDetail";
import { emptyRule, RuleForm } from "./RuleForm";
import { Rules } from "./Rules";
import { Runs } from "./RunsLog";

const rule = (id: number, extra: Partial<Rule> = {}): Rule => ({
  ...emptyRule,
  id,
  name: `rule ${id}`,
  enabled: true,
  dryRun: false,
  spentUsdDay: 0,
  spentUsdMonth: 0,
  createdAt: "2026-10-20T00:00:00.000Z",
  ...extra,
});

const formService = {
  "costs.quote": quoting(),
  "leads.listsList": () => Effect.succeed([]),
};

it("after a save the editor holds what was stored, not the list's copy from before it", async () => {
  let stored = rule(1, { name: "old name" });
  await using screen = await render(<Rules />, {
    service: {
      ...formService,
      "events.subscribe": liveEvents().subscribe,
      "automate.rulesList": () => Effect.sync(() => [stored]),
      "automate.runsList": () => Effect.succeed([]),
      "automate.pendingList": () => Effect.succeed([]),
      "automate.ruleUpsert": (input) =>
        Effect.sync(() => {
          stored = { ...stored, ...input, id: 1 };
          return stored;
        }),
    },
  });
  await userEvent.click(screen.getByText("old name"));
  await userEvent.fill(screen.getByPlaceholder("Thank reposters"), "new name");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => stored.name).toBe("new name");
  await expect.element(screen.getByPlaceholder("Thank reposters")).toHaveValue("new name");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("Escape closes the rule editor", async () => {
  await using screen = await render(<Rules />, {
    service: {
      ...formService,
      "events.subscribe": liveEvents().subscribe,
      "automate.rulesList": () => Effect.succeed([rule(1, { name: "thanks" })]),
      "automate.runsList": () => Effect.succeed([]),
      "automate.pendingList": () => Effect.succeed([]),
    },
  });
  await userEvent.click(screen.getByText("thanks"));
  await expect.element(screen.getByPlaceholder("Thank reposters")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByPlaceholder("Thank reposters")).not.toBeInTheDocument();
});

it("keeps the monthly cap and the undo interval as typed through a save and a reopen", async () => {
  let stored = rule(1, {
    name: "like keyword posts",
    trigger: { kind: "keyword_post", query: "x growth" },
    action: { kind: "auto_like" },
  });
  const saved: Array<RuleInput> = [];
  await using screen = await render(<Rules />, {
    service: {
      ...formService,
      "automate.rulesList": () => Effect.sync(() => [stored]),
      "automate.runsList": () => Effect.succeed([]),
      "automate.pendingList": () => Effect.succeed([]),
      "automate.ruleUpsert": (input) =>
        Effect.sync(() => {
          saved.push(input);
          stored = { ...stored, ...input, id: 1 };
          return stored;
        }),
    },
  });
  await userEvent.click(screen.getByText("like keyword posts"));
  await userEvent.fill(screen.getByLabelText(/^Budget per month/), "7.5");
  await userEvent.fill(screen.getByLabelText(/^Undo after hours/), "12");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => saved).toHaveLength(1);
  expect(saved[0]).toEqual({
    id: 1,
    name: "like keyword posts",
    enabled: true,
    trigger: { kind: "keyword_post", query: "x growth" },
    conditions: {},
    waitMinutes: 0,
    action: { kind: "auto_like" },
    budgetUsdDay: 0.5,
    budgetUsdMonth: 7.5,
    undoAfterHours: 12,
    askFirst: false,
    dryRun: false,
  });

  // The editor restarts from the stored rule once the save lands.
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("complementary").getByRole("button", { name: "Close", exact: true }).first(),
  );
  await expect
    .element(screen.getByRole("heading", { name: "like keyword posts" }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByText("like keyword posts"));
  await expect.element(screen.getByLabelText(/^Budget per month/)).toHaveValue(7.5);
  await expect.element(screen.getByLabelText(/^Undo after hours/)).toHaveValue("12");
});

it("prices what each polled trigger reads from X, per poll and per day, from the rate card", async () => {
  await using screen = await render(
    <RuleForm initial={emptyRule} saving={false} onSave={() => {}} onCancel={() => {}} />,
    { service: formService },
  );
  const when = screen.getByRole("combobox").first();
  // The default trigger watches own posts: one timeline page an hour.
  await expect
    .element(screen.getByText(/^Polls X every hour: \$0\.00075 a poll, up to \$0\.018 a day/))
    .toBeVisible();

  await choose(when, "Someone reposts or likes a post");
  await expect
    .element(
      screen.getByText(
        "Polls X every 15 min: $0.001 a poll, up to $0.096 a day, not while a dry run.",
      ),
    )
    .toBeVisible();
  // Likes come from X's liking_users at up to $0.20 a page, so they are polled hourly.
  await choose(screen.getByRole("combobox").nth(1), "likes, X API, first 20");
  await expect
    .element(screen.getByText(/^Polls X every hour: \$0\.2 a poll, up to \$4\.8 a day/))
    .toBeVisible();

  await choose(when, "New follower");
  await expect.element(screen.getByText(/^Polls X every 15 min: \$0\.001 a poll/)).toBeVisible();
  await choose(when, "Webhook call");
  expect(screen.getByText(/^Polls X/).elements()).toHaveLength(0);
});

it("prices the own timeline a repost or delete reads when the trigger polls nothing", async () => {
  await using screen = await render(
    <RuleForm
      initial={{ ...emptyRule, trigger: { kind: "schedule", weekdays: [1], time: "18:00" } }}
      saving={false}
      onSave={() => {}}
      onCancel={() => {}}
    />,
    { service: formService },
  );
  // A schedule reads nothing to fire, and a plug picks no post of its own.
  await expect.element(screen.getByText("Create rule")).toBeVisible();
  expect(screen.getByText(/^Polls X/).elements()).toHaveLength(0);
  await choose(screen.getByRole("combobox", { name: "Action" }), "Evergreen repost");
  await expect
    .element(screen.getByText(/^Polls X every hour: \$0\.00075 a poll, up to \$0\.018 a day/))
    .toBeVisible();
  await choose(screen.getByRole("combobox", { name: "Action" }), "Auto delete");
  await expect.element(screen.getByText(/^Polls X every hour: \$0\.00075 a poll/)).toBeVisible();
});

it("saves a post trigger only with a real post id, taking it out of a pasted post URL", async () => {
  const onSave = vi.fn<(rule: RuleInput) => void>();
  await using screen = await render(
    <RuleForm initial={emptyRule} saving={false} onSave={onSave} onCancel={() => {}} />,
    { service: formService },
  );
  await userEvent.fill(screen.getByPlaceholder("Thank reposters"), "  thank reposters ");
  await choose(screen.getByRole("combobox").first(), "Someone reposts or likes a post");
  const save = screen.getByRole("button", { name: "Create rule" });
  await expect.element(save).toBeDisabled();

  await userEvent.fill(screen.getByLabelText("Post id"), "https://x.com/levelsio");
  await expect.element(save).toBeDisabled();
  await userEvent.fill(screen.getByLabelText("Post id"), "https://x.com/levelsio/status/456?s=20");
  await expect.element(screen.getByLabelText("Post id")).toHaveValue("456");
  await userEvent.click(save);
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "thank reposters",
      trigger: { kind: "post_engaged", postId: "456", via: "repost" },
    }),
  );
});

it("a schedule needs a day; clearing a number field lets the user retype it", async () => {
  const onSave = vi.fn<(rule: RuleInput) => void>();
  await using screen = await render(
    <RuleForm
      initial={{ ...emptyRule, name: "weekly" }}
      saving={false}
      onSave={onSave}
      onCancel={() => {}}
    />,
    { service: formService },
  );
  await choose(screen.getByRole("combobox").first(), "Schedule");
  const save = screen.getByRole("button", { name: "Create rule" });
  await expect.element(save).toBeEnabled();
  // The default days are Mon and Thu; with neither the rule could never fire.
  await userEvent.click(screen.getByRole("button", { name: "Mon" }));
  await userEvent.click(screen.getByRole("button", { name: "Thu" }));
  await expect.element(save).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Fri" }));

  const waitField = screen.getByRole("spinbutton").first();
  await userEvent.clear(waitField);
  await expect.element(waitField).toHaveValue(null);
  await userEvent.type(waitField, "15");
  await expect.element(waitField).toHaveValue(15);
  await userEvent.click(save);
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      trigger: { kind: "schedule", weekdays: [5], time: "18:00" },
      waitMinutes: 15,
    }),
  );
});

it("Run now asks first when the trigger's poll is paid, even for an ask-first rule", async () => {
  const onRunNow = vi.fn();
  const detail = (r: Rule) => (
    <RuleDetail
      rule={r}
      runs={[]}
      busy={false}
      saving={false}
      running={false}
      formKey="1"
      onClose={() => {}}
      onSave={() => {}}
      onToggle={() => {}}
      onRunNow={onRunNow}
      onShowRuns={() => {}}
      onDelete={() => {}}
    />
  );
  const likes = rule(1, {
    name: "thank likers",
    askFirst: true,
    trigger: { kind: "post_engaged", postId: "42", via: "like" },
    action: { kind: "auto_dm", template: "Thanks {name}!" },
  });
  await using screen = await render(detail(likes), { service: formService });
  // The poll's price sits in the rule's numbers beside the per-fire price.
  await expect.element(screen.getByText(/^\$0\.2\s*every hour$/)).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /^Run now/ }));
  await expect
    .element(screen.getByText(/its poll costs up to \$0\.2 and what it finds waits in Needs you/))
    .toBeVisible();
  expect(onRunNow).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /^Confirm and run.*\$0\.2/ }));
  expect(onRunNow).toHaveBeenCalledTimes(1);

  // A webhook trigger reads nothing, so an ask-first rule just queues: nothing to confirm.
  await screen.rerender(detail({ ...likes, trigger: { kind: "webhook" } }));
  await userEvent.click(screen.getByRole("button", { name: /^Run now/ }));
  expect(onRunNow).toHaveBeenCalledTimes(2);
});

const request = (id: number, description: string): PendingRequest => ({
  id,
  ruleId: 1,
  ruleName: "thank reposters",
  subjectId: `repost:${id}`,
  description,
  costUsd: 0.015,
  createdAt: "2026-10-23T08:00:00.000Z",
  status: "pending",
});

it("Approve pays once: it stays off until the list drops the approved request", async () => {
  const approved: Array<number> = [];
  let open: ReadonlyArray<PendingRequest> = [request(7, "@ada reposted 555; DM Ada")];
  let releaseList = () => {};
  const listed = new Promise<void>((resolve) => (releaseList = resolve));
  await using screen = await render(<NeedsYou />, {
    service: {
      "automate.pendingList": () =>
        approved.length === 0
          ? Effect.sync(() => open)
          : Effect.promise(() => listed).pipe(Effect.map(() => open)),
      "automate.runsList": () => Effect.succeed([]),
      "automate.pendingApprove": ({ id }) =>
        Effect.sync(() => {
          approved.push(id);
          open = [];
          return {
            id: 1,
            ruleId: 1,
            at: "2026-10-23T09:00:00.000Z",
            subjectId: "repost:7",
            status: "ok" as const,
            detail: "DM Ada",
            costUsd: 0.015,
            xId: null,
          };
        }),
    },
  });
  const approve = screen.getByRole("button", { name: "Approve $0.015" });
  await userEvent.click(approve);
  await expect.poll(() => approved).toEqual([7]);
  // The refetch is still out: the old row must not be approvable again.
  await expect.element(approve).toBeDisabled();
  releaseList();
  await expect.element(screen.getByText(/^Nothing waiting/)).toBeVisible();
  expect(approved).toEqual([7]);
});

it("a request an ask-first rule queues while the tab is open shows up without a reload", async () => {
  const events = liveEvents();
  let open: ReadonlyArray<PendingRequest> = [];
  await using screen = await render(<NeedsYou />, {
    service: {
      "events.subscribe": events.subscribe,
      "automate.pendingList": () => Effect.sync(() => open),
      "automate.runsList": () => Effect.succeed([]),
    },
  });
  await expect.element(screen.getByText(/^Nothing waiting/)).toBeVisible();
  open = [request(8, "@bo reposted 556; DM Bo")];
  events.emit("rule_fired", {
    pending: true,
    pendingId: 8,
    ruleId: 1,
    ruleName: "thank reposters",
  });
  await expect.element(screen.getByText("@bo reposted 556; DM Bo")).toBeVisible();
});

it("simulates the first rule once rules arrive, and says the evaluation is free", async () => {
  const events = liveEvents();
  let rules: ReadonlyArray<Rule> = [];
  const simulated: Array<number> = [];
  await using screen = await render(<DryRun />, {
    service: {
      "events.subscribe": events.subscribe,
      "automate.rulesList": () => Effect.sync(() => rules),
      "automate.dryRun7d": ({ id }) =>
        Effect.sync(() => {
          simulated.push(id);
          return { fired: [], totalUsd: 0 };
        }),
    },
  });
  await expect.element(screen.getByText("reads stored data only, fires nothing")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Evaluate.*free$/ })).toBeDisabled();
  await expect.element(screen.getByText("No rules yet.")).toBeVisible();

  // The rules list loads after the page opened.
  rules = [rule(3), rule(4)];
  events.emit("rule_fired");
  await userEvent.click(screen.getByRole("button", { name: /^Simulate/ }));
  await expect.element(screen.getByText("Would not have fired in the last 7 days.")).toBeVisible();
  expect(simulated).toEqual([3]);

  // The picked rule was deleted: the select and the button fall back to what is left.
  await choose(screen.getByRole("combobox", { name: "Rule" }), "rule 4");
  rules = [rule(3)];
  events.emit("rule_fired");
  await expect.element(screen.getByRole("combobox", { name: "Rule" })).toHaveTextContent("rule 3");
  await userEvent.click(screen.getByRole("button", { name: /^Simulate/ }));
  await expect.poll(() => simulated).toEqual([3, 3]);
});

const ruleRun = (id: number, extra: Partial<RuleRun>): RuleRun => ({
  id,
  ruleId: 1,
  at: "2026-10-23T09:00:00.000Z",
  subjectId: "repost:7",
  status: "ok",
  detail: "DM Ada",
  costUsd: 0.015,
  xId: null,
  ...extra,
});

it("an approval the service did not act on says why, and opens that rule's runs", async () => {
  let open: ReadonlyArray<PendingRequest> = [request(7, "@ada reposted 555; DM Ada")];
  await using screen = await render(<NeedsYou />, {
    router: "/automate?tab=needs-you",
    service: {
      "automate.pendingList": () => Effect.sync(() => open),
      "automate.runsList": () => Effect.succeed([]),
      // The service settles the request even when the budget refuses the action.
      "automate.pendingApprove": () =>
        Effect.sync(() => {
          open = [];
          return ruleRun(2, { status: "skipped", detail: "daily budget reached", costUsd: 0 });
        }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Approve $0.015" }));
  await expect.element(screen.getByText("skipped: daily budget reached")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Open runs" }));
  await expect.poll(() => screen.router?.state.location.href).toBe("/automate?tab=runs&rule=1");
});

it("a simulation that ends after another rule is picked stays with its own rule", async () => {
  let release = () => {};
  const done = new Promise<void>((resolve) => (release = resolve));
  await using screen = await render(<DryRun />, {
    service: {
      "automate.rulesList": () => Effect.succeed([rule(3), rule(4)]),
      "automate.dryRun7d": () =>
        Effect.promise(() => done).pipe(
          Effect.as({
            fired: [{ at: "2026-10-22T10:00:00.000Z", description: "like 555", costUsd: 0.015 }],
            totalUsd: 0.015,
          }),
        ),
    },
  });
  const pick = screen.getByRole("combobox", { name: "Rule" });
  await userEvent.click(screen.getByRole("button", { name: /^Simulate/ }));
  await choose(pick, "rule 4");
  release();
  await choose(pick, "rule 3");
  await expect.element(screen.getByText("1 firings in 7 days")).toBeVisible();
  await choose(pick, "rule 4");
  await expect.element(screen.getByText(/^Replays one rule/)).toBeVisible();
  expect(screen.getByText("1 firings in 7 days").elements()).toHaveLength(0);
});

it("rules that failed to load say so, not that there are none", async () => {
  await using screen = await render(<DryRun />, {
    service: {
      "automate.rulesList": () =>
        Effect.fail(
          new AutomateError({ operation: "rulesList", detail: "database is locked", cause: null }),
        ),
    },
  });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Automate failed during rulesList: database is locked");
  expect(screen.getByText("No rules yet.").elements()).toHaveLength(0);
  expect(screen.getByText(/^No rule is on/).elements()).toHaveLength(0);
});

it("a run's detail opens the post or person it acted on, at any width", async () => {
  await using screen = await render(<Runs />, {
    router: "/automate?tab=runs",
    service: {
      "automate.runsList": () =>
        Effect.succeed([
          ruleRun(1, { ruleId: 1, subjectId: "555", detail: "like 555", xId: "555" }),
          ruleRun(2, { ruleId: 2, subjectId: "77", detail: "follow @bo", xId: "77" }),
          ruleRun(3, { ruleId: 3, subjectId: "2026-10-22 18:00", detail: "notify: hi" }),
        ]),
      "automate.rulesList": () =>
        Effect.succeed([
          rule(1, { trigger: { kind: "keyword_post", query: "x" }, action: { kind: "auto_like" } }),
          rule(2, { trigger: { kind: "new_follower" }, action: { kind: "follow" } }),
          rule(3, {
            trigger: { kind: "schedule", weekdays: [1], time: "18:00" },
            action: { kind: "notify", message: "hi" },
          }),
        ]),
    },
  });
  await expect
    .element(screen.getByRole("link", { name: "like 555" }))
    .toHaveAttribute("href", "https://x.com/i/status/555");
  await expect
    .element(screen.getByRole("link", { name: "follow @bo" }))
    .toHaveAttribute("href", "https://x.com/i/user/77");
  await expect.element(screen.getByText("notify: hi")).toBeVisible();
  expect(screen.getByRole("link", { name: "notify: hi" }).elements()).toHaveLength(0);
});
