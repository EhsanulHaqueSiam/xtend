import type { SignalAgent } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { DESKTOP, endlessAnimations, SAMPLES, settled } from "../../../test/bench";
import { quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { CommandPalette } from "./CommandPalette";
import { ShellHotkeys } from "./ShellHotkeys";

/** 30 agents, every other one checking for bots, which prices its run differently. */
const agents = Array.from({ length: 30 }, (_, i): SignalAgent => ({
  id: i + 1,
  name: `scout${i + 1}`,
  query: `"saas founder" niche ${i + 1}`,
  minFollowers: 100,
  intervalMinutes: 30,
  enabled: true,
  scoringPrompt: "",
  lang: null,
  excludeBots: i % 2 === 0,
  notifyMinScore: null,
  listId: null,
  lastRun: null,
}));

// Dispatched in the page: Playwright's round trip per key would dwarf the render.
const pressCmdK = () =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
const options = (root: HTMLElement) => root.querySelectorAll('[role="option"]');

beforeAll(() => page.viewport(DESKTOP.width, DESKTOP.height));

it("⌘K palette with 30 agents", async ({ bench }) => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "leads.agentsList": () => Effect.succeed(agents),
      },
    },
  );
  // Agents come last, and their price ends with the model call's quote once both have loaded.
  const ready = () => {
    const last = options(screen.container)[options(screen.container).length - 1];
    return last?.textContent.includes("scout30") === true && last.textContent.endsWith("$0.001");
  };
  const closed = () => screen.container.querySelector('[role="dialog"]') === null;

  pressCmdK();
  await settled(screen.container, ready);
  expect(endlessAnimations()).toEqual([]);
  pressCmdK();
  await settled(screen.container, closed);

  // Each open mounts the palette afresh and reads the agents again; closing is not timed.
  const open = await bench("Palette: open with 30 agents", async () => {
    const start = performance.now();
    pressCmdK();
    await settled(screen.container, ready);
    const overriddenDuration = performance.now() - start;
    pressCmdK();
    await settled(screen.container, closed);
    return { overriddenDuration };
  }).run(SAMPLES);
  expect(open.latency.p50).toBeLessThan(50); // 2ms
});
