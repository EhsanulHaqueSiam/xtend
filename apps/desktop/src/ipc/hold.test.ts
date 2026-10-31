import { expect, it } from "@effect/vitest";

import { holdUntilHeard } from "./hold.ts";

it("hands what came before anyone listened to the first listener, then streams", () => {
  const channel = holdUntilHeard<number>(2);
  channel.push(1);
  channel.push(2);
  channel.push(3); // over the limit: dropped
  const heard: Array<number> = [];
  const stop = channel.listen((n) => heard.push(n));
  channel.push(4);
  stop();
  channel.push(5); // nobody listens again: held for the next one
  const later: Array<number> = [];
  channel.listen((n) => later.push(n));
  expect([heard, later]).toEqual([[1, 2, 4], [5]]);
});
