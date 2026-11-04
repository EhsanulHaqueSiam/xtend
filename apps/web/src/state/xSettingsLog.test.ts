import { expect, it } from "vite-plus/test";

import { markKey, settleMarks } from "./xSettingsLog";

it("settles a filed key's mark, but keeps a press the user made after the read was sent", () => {
  const key = "/settings/audience_and_tagging Protect your posts";
  const sent = new Map([[markKey(1, key), "On"]]);
  // Filed On while the mark still asks for On: settled.
  expect(settleMarks(sent, sent, 1, [{ key }]).size).toBe(0);
  // The user turned it Off before the On answer came back: Off stays theirs.
  const now = new Map([[markKey(1, key), "Off"]]);
  expect(settleMarks(now, sent, 1, [{ key }]).get(markKey(1, key))).toBe("Off");
});
