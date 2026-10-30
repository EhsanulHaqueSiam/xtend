import { Costs_METHODS, Leads_METHODS, type Rule } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { rates } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { RuleDetail } from "./RuleDetail";

const service = {
  [Costs_METHODS.quote]: () => Effect.succeed({ rates, quotes: [] }),
  [Leads_METHODS.listsList]: () => Effect.succeed([]),
};

const rule: Rule = {
  id: 1,
  name: "Thank reposters",
  enabled: true,
  trigger: { kind: "new_follower" },
  conditions: {},
  waitMinutes: 0,
  action: { kind: "auto_dm", template: "Thanks {name}!" },
  budgetUsdDay: 0.5,
  budgetUsdMonth: 5,
  undoAfterHours: null,
  askFirst: false,
  dryRun: false,
  spentUsdDay: 0,
  spentUsdMonth: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const detail = (r: Rule, onRunNow: () => void) => (
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

it("shows a live rule's price and asks before Run now fires it", async () => {
  const onRunNow = vi.fn();
  await using screen = await render(detail(rule, onRunNow), { service });

  await userEvent.click(screen.getByRole("button", { name: /Run now.*\$0\.015/ }));
  expect(onRunNow).not.toHaveBeenCalled();
  await expect
    .element(screen.getByText(/Charges your treg balance \$0\.015 per fire/))
    .toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /Confirm and run.*\$0\.015/ }));
  expect(onRunNow).toHaveBeenCalledOnce();
});

it("keeps a paid Run now off until the rate card prices it", async () => {
  await using screen = await render(detail(rule, vi.fn()), {
    service: { ...service, [Costs_METHODS.quote]: () => Effect.never },
  });
  await expect.element(screen.getByRole("button", { name: /^Run now/ })).toBeDisabled();
  // A dry run charges nothing, so it needs no price.
  await screen.rerender(detail({ ...rule, dryRun: true }, vi.fn()));
  await expect.element(screen.getByRole("button", { name: /^Run now/ })).toBeEnabled();
});

it("runs a dry-run rule at once, since it charges nothing", async () => {
  const onRunNow = vi.fn();
  await using screen = await render(detail({ ...rule, dryRun: true }, onRunNow), { service });

  await userEvent.click(screen.getByRole("button", { name: /Run now.*dry run/ }));
  expect(onRunNow).toHaveBeenCalledOnce();
});
