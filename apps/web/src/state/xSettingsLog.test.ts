import { expect, it } from "vite-plus/test";

import { markKey, settleMarks } from "./xSettingsLog";

it("settles a filed key's mark, but keeps a press the user made after the read was sent", () => {
  const k = markKey(1, "/settings/audience_and_tagging Protect your posts");
  const logged = [{ key: "/settings/audience_and_tagging Protect your posts" }];
  const on = new Map([[k, { value: "On" }]]);
  // Filed while the mark is still the press it was sent with: settled.
  expect(settleMarks(on, on, 1, logged).size).toBe(0);
  // The user turned it Off before the On answer came back: Off stays theirs.
  const off = new Map([[k, { value: "Off" }]]);
  expect(settleMarks(off, on, 1, logged).get(k)?.value).toBe("Off");
  // On, Off, then On again before the first On answer: the newest On is another press, and stays.
  const onAgain = new Map([[k, { value: "On" }]]);
  expect(settleMarks(onAgain, on, 1, logged).get(k)?.value).toBe("On");
});
