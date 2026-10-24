import type { PendingRequest, Rule, RuleInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { liveEvents, quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { DryRun } from "./DryRun";
import { NeedsYou } from "./NeedsYou";
import { RuleDetail } from "./RuleDetail";
import { emptyRule, RuleForm } from "./RuleForm";

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

  await userEvent.selectOptions(when, "Someone reposts or likes a post");
  await expect
    .element(
      screen.getByText(
        "Polls X every 15 min: $0.001 a poll, up to $0.096 a day, not while a dry run.",
      ),
    )
    .toBeVisible();
  // Likes come from X's liking_users at up to $0.20 a page, so they are polled hourly.
  await userEvent.selectOptions(screen.getByRole("combobox").nth(1), "likes, X API, first 20");
  await expect
    .element(screen.getByText(/^Polls X every hour: \$0\.2 a poll, up to \$4\.8 a day/))
    .toBeVisible();

  await userEvent.selectOptions(when, "New follower");
  await expect.element(screen.getByText(/^Polls X every 15 min: \$0\.001 a poll/)).toBeVisible();
  await userEvent.selectOptions(when, "Webhook call");
  expect(screen.getByText(/^Polls X/).elements()).toHaveLength(0);
});

it("saves a post trigger only with a real post id, taking it out of a pasted post URL", async () => {
  const onSave = vi.fn<(rule: RuleInput) => void>();
  await using screen = await render(
    <RuleForm initial={emptyRule} saving={false} onSave={onSave} onCancel={() => {}} />,
    { service: formService },
  );
  await userEvent.fill(screen.getByPlaceholder("Thank reposters"), "  thank reposters ");
  await userEvent.selectOptions(
    screen.getByRole("combobox").first(),
    "Someone reposts or likes a post",
  );
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
  await userEvent.selectOptions(screen.getByRole("combobox").first(), "Schedule");
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
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rule" }), "rule 4");
  rules = [rule(3)];
  events.emit("rule_fired");
  await expect.element(screen.getByRole("combobox", { name: "Rule" })).toHaveValue("3");
  await userEvent.click(screen.getByRole("button", { name: /^Simulate/ }));
  await expect.poll(() => simulated).toEqual([3, 3]);
});
