import { expect, it } from "vite-plus/test";

import { liveEvents } from "../../../test/fixtures";
import { render, stubGlobal } from "../../../test/render";
import { ShellNotifications } from "./ShellNotifications";

/** Records what would reach the OS, with the permission already granted, until disposed. */
function fakeNotifications() {
  const shown: Array<{ readonly title: string; readonly body: string | undefined }> = [];
  class FakeNotification extends EventTarget {
    static readonly permission = "granted";
    static readonly requestPermission = () => Promise.resolve("granted");
    constructor(title: string, options?: NotificationOptions) {
      super();
      shown.push({ title, body: options?.body });
    }
  }
  return Object.assign(stubGlobal("Notification", FakeNotification), { shown });
}

it("tells the user what an automation's notify action says and when a rule needs them", async () => {
  using notifications = fakeNotifications();
  const { shown } = notifications;
  const events = liveEvents();
  await using _screen = await render(<ShellNotifications />, {
    service: { "events.subscribe": events.subscribe },
  });

  // The engine's payloads, as AutomationEngine publishes them.
  events.emit("rule_fired", {
    ruleId: 1,
    ruleName: "thanks",
    notify: { title: "thanks", body: "Big reposted you (@big reposted 42)" },
  });
  events.emit("rule_fired", {
    ruleId: 2,
    ruleName: "like back",
    detail: "like 42",
    xId: "42",
    costUsd: 0.015,
  });
  events.emit("rule_fired", {
    pending: true,
    pendingId: 7,
    ruleId: 3,
    ruleName: "plug",
    description: "own post 9 at 5000 views; reply with link",
    costUsd: 0.2,
  });
  events.emit("mention_arrived", { count: 3 });
  events.emit("spend_changed", {});

  await expect.poll(() => shown).toHaveLength(3);
  // A rule that just acted is in the runs log; only notify actions and approvals interrupt.
  expect(shown).toEqual([
    { title: "thanks", body: "Big reposted you (@big reposted 42)" },
    { title: "plug", body: "Needs you: own post 9 at 5000 views; reply with link ($0.2)" },
    { title: "Xtend", body: "3 new mentions" },
  ]);

  // Each event is shown once, however many arrive after it.
  events.emit("lead_found", { personId: 4, handle: "ada", score: 91, agent: "founders" });
  await expect.poll(() => shown).toHaveLength(4);
  expect(shown.at(-1)).toEqual({ title: "Xtend", body: "Lead found: @ada" });
});
