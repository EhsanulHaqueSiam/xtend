import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * X's older Grok client streams its answers from add_response.json, one JSON line per chunk.
 * The desktop's capture hands each line to the window as X's page receives it, not once the
 * stream ends.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine();
});
afterAll(() => e?.close());

interface Heard {
  readonly kind: string;
  readonly line?: string;
  readonly at: number;
}

test("X's streamed Grok answer reaches the window line by line, as X's page receives it", async () => {
  await expect.poll(() => e.engine<number>("1"), { timeout: 20_000 }).toBe(1);
  await e.app.evaluate(() => {
    const heard: Array<unknown> = [];
    Reflect.set(window, "__grok", heard);
    Reflect.get(window, "desktopBridge").onGrok((capture: object) =>
      heard.push({ ...capture, at: Date.now() }),
    );
  });
  const heard = () => e.app.evaluate(() => Reflect.get(window, "__grok") as ReadonlyArray<Heard>);
  // X's page asks as X's older client does: one POST, its answer read as it streams.
  await e.engine(
    `void fetch("/i/api/2/grok/add_response.json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) }).then((r) => r.text()), true`,
  );
  const expected = e.mock.state.grok.streamFor("hi").map((l) => JSON.stringify(l));
  // The first line is in the window while X is still sending the rest, a chunk every 300ms.
  await expect.poll(async () => (await heard()).length).toBeGreaterThanOrEqual(1);
  const first = await heard();
  expect(first.some((h) => h.kind === "end")).toBe(false);
  await expect.poll(async () => (await heard()).at(-1)?.kind, { timeout: 10_000 }).toBe("end");
  const all = await heard();
  expect(all.filter((h) => h.kind === "chunk").map((h) => h.line)).toEqual(expected);
  // Lines came apart in time, as X sent them, not all at the end.
  const chunks = all.filter((h) => h.kind === "chunk");
  expect(chunks.at(-1)!.at - chunks[0]!.at).toBeGreaterThanOrEqual(600);
});
