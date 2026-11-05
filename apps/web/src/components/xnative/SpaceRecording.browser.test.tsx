import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";
import { RECORDED_SPACE, synth } from "./engineFixtures";
import { SpaceRecording } from "./SpaceRecording";

const { spaces } = synth();
const batches = spaces!.batches;
const answer = batches.find((b) => b.op === "AudioSpaceById" && b.key === RECORDED_SPACE)!;
const captions = batches.find((b) => b.op === "LiveChatReplay")!;
const recorded = answer.spaces![0]!;
const [, cohost, speaker] = recorded.people;
/** A script that presses X's Play recording (a read of X's page only waits for it). */
const pressed = (code: string) => code.includes("Play recording") && code.includes(".click()");

it("reads a recording as X's captions, a row each, marking the people the account tracks, and plays it through X's own Play recording only for the click", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      // X's player, once its Play recording was pressed: 15:30 into the recording.
      if (code.includes("function readSpaceDock"))
        return Promise.resolve({
          word: "Close",
          request: null,
          mic: null,
          react: false,
          captions: [],
          player: { at: 930_000, length: 2_900_000, playing: true, speed: "Speed 1x" },
        });
      return Promise.resolve(pressed(code) ? "joined" : true);
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
    stage: "replied" as const,
    notes: "",
    score: null,
    tier: null,
    source: "manual",
    firstSeen: "2026-10-01T00:00:00.000Z",
    lastActivity: "2026-10-01T00:00:00.000Z",
  };
  await using screen = await render(
    <div style={{ width: 1400, height: 900, display: "flex" }}>
      <EngineSync />
      <SpaceRecording spaceId={RECORDED_SPACE} />
    </div>,
    {
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        "leads.peopleByHandles": () => Effect.succeed([lead]),
        "engage.targets": () => Effect.succeed([]),
      },
    },
  );
  bridge.emitEngine(answer);
  // Before X sent captions: the speakers, and X's player to start.
  await expect.element(screen.getByText(cohost!.name).first()).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Play recording" })).toBeVisible();
  expect(scripts.some(pressed)).toBe(false);

  bridge.emitEngine(captions);
  const rows = () =>
    [...screen.container.querySelectorAll('[data-x="caption"]')].map((r) => r.textContent);
  await expect.poll(rows).toHaveLength(captions.spaceCaptions!.length);
  // Each row: who said it, X's role or the account's label for them, when, and what.
  expect(rows()[2]).toContain(`${speaker!.name}Lead · replied7:40`);
  expect(rows()[1]).toContain(`${cohost!.name}Co-host7:03`);

  await screen.getByRole("button", { name: "Play recording" }).click();
  await expect.poll(() => scripts.filter(pressed).length).toBe(1);
  await expect.element(screen.getByText("15:30 / 48:20")).toBeVisible();
  // At 15:30 the line said at 15:02 is the one X plays; ticks mark where the lead spoke.
  const current = screen.container.querySelector('[data-x="caption"][aria-current="true"]');
  expect(current?.textContent).toContain("15:02");
  expect(screen.container.querySelectorAll('[data-x="tick"]')).toHaveLength(2);
  // The rail counts what the lead said from X's captions.
  await expect.element(screen.getByText("Spoke 2 times · Lead · replied")).toBeVisible();
});
