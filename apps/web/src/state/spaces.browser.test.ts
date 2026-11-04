import { expect, it } from "vite-plus/test";

import { xSpacePlay } from "./spaces";
import { markXReady, registerXWebview, type XWebview } from "./x";

it("counts a recording as playing only once X's player holds it, never while another one plays", async () => {
  const b = "900000700005";
  history.replaceState(null, "", `/i/spaces/${b}/peek`);
  // X's player plays recording A; B's page offers Play recording, which X has not taken yet.
  document.body.innerHTML = `<main role="main"></main>
    <div id="dock"><div role="button" aria-label="Collapse"></div><div role="button">Close</div><div id="title">Recording A</div></div>
    <div role="button" aria-label="Play recording" id="play"></div>`;
  // The engine's scripts run in X's page; here, in this document, on B's page.
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com/i/spaces/${b}/peek`,
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } as unknown as XWebview);
  markXReady();
  try {
    expect(await xSpacePlay(b, "Recording B")).toBeNull();
    expect(document.getElementById("title")!.textContent).toBe("Recording A");

    // X takes it: its player now holds B.
    document.getElementById("play")!.addEventListener("click", () => {
      document.getElementById("title")!.textContent = "Recording B";
    });
    expect(await xSpacePlay(b, "Recording B")).toBe(true);
  } finally {
    registerXWebview(null);
    history.replaceState(null, "", "/");
  }
});
