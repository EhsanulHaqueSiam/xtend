import { expect, it, vi } from "vite-plus/test";

import { sessionPartition } from "./guestPolicy.ts";
import { MOCK_X_PARTITION, mockXOrigin } from "./mockX.ts";

vi.mock("electron", () => import("../testing/fakeElectron.ts"));

it("serves x.com from mock X only in a dev build, and only from this machine", () => {
  expect(mockXOrigin("http://127.0.0.1:4830", false)).toBe("http://127.0.0.1:4830");
  expect(mockXOrigin("http://localhost:4830/home", false)).toBe("http://localhost:4830");
  // A packaged app is a user's: it never serves X from anything but X.
  expect(mockXOrigin("http://127.0.0.1:4830", true)).toBeNull();
  for (const elsewhere of [
    "https://x.com",
    "http://10.0.0.2:4830",
    "http://mini.tail.ts.net:4830",
    "file:///tmp/x",
    "4830",
    "",
  ])
    expect(mockXOrigin(elsewhere, false)).toBeNull();
  expect(mockXOrigin(undefined, false)).toBeNull();
});

it("keeps mock X off every account's partition and off disk", () => {
  expect(MOCK_X_PARTITION.startsWith("persist:")).toBe(false);
  const accounts = Array.from({ length: 1_000 }, (_, i) => sessionPartition(i + 1));
  expect(accounts).not.toContain(MOCK_X_PARTITION);
  expect(accounts.map((p) => p.slice("persist:".length))).not.toContain(MOCK_X_PARTITION);
});
