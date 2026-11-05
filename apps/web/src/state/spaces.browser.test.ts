import { expect, it } from "vite-plus/test";

import { forgetSpaceRead, xSpaceRead } from "./spaces";
import { markXReady, registerXWebview, type XWebview } from "./x";
it("asks X for a Space it holds none of once per opening of the dock, and again when the move to X's page did not happen", async () => {
  const id = "900000700009";
  let at = `https://x.com/i/spaces/${id}/peek`;
  const moves: Array<string> = [];
  registerXWebview({
    loadURL: async () => {},
    getURL: () => at,
    executeJavaScript: (code: string) => {
      if (code.includes("history.pushState")) moves.push(code);
      return Promise.resolve(true);
    },
  } as unknown as XWebview);
  markXReady();
  try {
    // X's page already shows it: the engine did not move, so the read is not used up.
    await xSpaceRead(id);
    at = "https://x.com/home";
    await xSpaceRead(id);
    expect(moves).toHaveLength(1);
    // The dock mounting again on the next screen asks nothing more.
    await xSpaceRead(id);
    expect(moves).toHaveLength(1);
    // The user opening the Space again does.
    forgetSpaceRead(id);
    await xSpaceRead(id);
    expect(moves).toHaveLength(2);
  } finally {
    registerXWebview(null);
  }
});
