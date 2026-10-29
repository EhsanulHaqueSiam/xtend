import type { Person } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import {
  DESKTOP,
  endlessAnimations,
  Refresh,
  SAMPLES,
  settled,
  timeMount,
} from "../../../test/bench";
import type { FakeService } from "../../../test/fakeService";
import { quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { peopleAtom } from "../../state/leads";
import { PeopleSection } from "./People";
import { STAGES } from "./ui";

/** 200 people, as many as `leads.peopleList` returns, spread over stages, scores and sources. */
const people = Array.from({ length: 200 }, (_, i): Person => ({
  id: i + 1,
  handle: `founder${i + 1}`,
  name: `Founder ${i + 1}`,
  userId: i % 3 === 0 ? null : String(1_000_000 + i),
  followers: (i * 7_919) % 90_000,
  bio: "Building a calm SaaS in public. Ex-agency, now bootstrapped.",
  stage: STAGES[i % STAGES.length]!,
  notes: "",
  score: (i * 37) % 101,
  tier: null,
  source: i % 2 === 0 ? "list:Founders" : "agent:devtools",
  firstSeen: "2026-10-01T00:00:00.000Z",
  lastActivity: "2026-10-20T00:00:00.000Z",
}));

const rows = (root: HTMLElement) => root.querySelectorAll("button[data-selected]");

beforeAll(() => page.viewport(DESKTOP.width, DESKTOP.height));

it("People with 200 people", async ({ bench }) => {
  let listed = people;
  let refresh = () => {};
  const service: FakeService = {
    "costs.quote": quoting(),
    "leads.peopleList": () => Effect.sync(() => listed),
    "leads.personGet": ({ id }) =>
      Effect.sync(() => ({ person: listed.find((p) => p.id === id)!, activity: [] })),
  };
  const ui = (
    <>
      <PeopleSection />
      <Refresh atom={peopleAtom(null)} bind={(r) => (refresh = r)} />
    </>
  );
  const all = (root: HTMLElement) => rows(root).length === people.length;

  const mount = await bench("People: mount 200", timeMount(ui, { service }, all)).run(SAMPLES);
  expect(mount.latency.p50).toBeLessThan(150); // 14ms

  await using screen = await render(ui, { service });
  await settled(screen.container, () => all(screen.container));
  expect(endlessAnimations()).toEqual([]);

  // A profile fetch renames one person; the screen refetches the whole list.
  let version = 0;
  const update = await bench("People: one row changes", async () => {
    version += 1;
    const name = `Founder 1 (${version})`;
    listed = people.with(0, { ...people[0]!, name });
    refresh();
    await settled(
      screen.container,
      () => rows(screen.container)[0]?.textContent.includes(name) === true,
    );
  }).run(SAMPLES);
  expect(update.latency.p50).toBeLessThan(75); // 7ms
});
