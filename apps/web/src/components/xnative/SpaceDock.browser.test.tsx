import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";
import { synth } from "./engineFixtures";
import { SpaceCard } from "./SpaceCard";
import { XColumn } from "./XColumn";

const { spaces } = synth();
const [thread, answer] = spaces!.batches;
const post = thread!.posts[0]!;
const space = answer!.spaces![0]!;
const [host, cohost, speaker] = space.people;

it("opens a post's Space in the dock with X's title, count and people and the people the account tracks, pressing X's Start listening only for the click", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      // X's Start listening, pressed, draws X's dock.
      return Promise.resolve(code.includes('[aria-label="Start listening"]') ? "joined" : true);
    },
  } as unknown as XWebview);
  markXReady();
  const lead = {
    id: 1,
    handle: speaker!.handle,
    name: speaker!.name,
    userId: null,
    followers: null,
    bio: "",
    stage: "contacted" as const,
    notes: "",
    score: null,
    tier: null,
    source: "manual",
    firstSeen: "2026-10-01T00:00:00.000Z",
    lastActivity: "2026-10-01T00:00:00.000Z",
  };
  const asked: Array<ReadonlyArray<string>> = [];
  await using screen = await render(
    <div style={{ width: 1400, height: 900, display: "flex" }}>
      <EngineSync />
      <XColumn header={null}>
        <SpaceCard post={post} />
      </XColumn>
    </div>,
    {
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        "leads.peopleByHandles": ({ handles }: { readonly handles: ReadonlyArray<string> }) => {
          asked.push(handles);
          return Effect.succeed(handles.includes(lead.handle) ? [lead] : []);
        },
        "engage.targets": () =>
          Effect.succeed([
            {
              post: xPost("9", "a post", {
                author: { ...xPost("9", "").author, handle: cohost!.handle },
              }),
              keyword: "churn",
              ageMinutes: 5,
              viewsPerHour: 100,
              score: 1,
              reach: "100 to 1k/h",
              replied: false,
              authorScore: null,
              repliesToAuthor: 0,
            },
          ]),
      },
    },
  );
  bridge.emitEngine(thread!);
  bridge.emitEngine(answer!);
  await screen.getByRole("button", { name: /Churn, pricing pages/ }).click();
  const dock = screen.getByRole("region", { name: space.title });
  await expect.element(dock.getByText("214 listening")).toBeVisible();
  await expect.element(dock.getByText(host!.name, { exact: true }).first()).toBeVisible();
  await expect.element(dock.getByText("People you track · 2")).toBeVisible();
  await expect.element(dock.getByText("Lead · contacted")).toBeVisible();
  await expect.element(dock.getByText("Target")).toBeVisible();
  // Every handle in the Space, the listeners past the faces too.
  expect(asked.at(-1)).toHaveLength(space.people.length);
  // Opening the dock moved nothing in X's page and pressed nothing.
  expect(scripts.filter((s) => s.includes("Start listening") || s.includes("pushState"))).toEqual(
    [],
  );

  await dock.getByRole("button", { name: "Start listening" }).click();
  await expect
    .poll(() => scripts.some((s) => s.includes(`/i/spaces/${space.spaceId}/peek`)))
    .toBe(true);
  await expect
    .poll(() => scripts.filter((s) => s.includes('[aria-label="Start listening"]')).length)
    .toBe(1);
});
