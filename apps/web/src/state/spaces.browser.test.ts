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

it("tells recordings apart by X's title in its dock and, for a title they share, by X's player starting over", async () => {
  const b = "900000700006";
  history.replaceState(null, "", `/i/spaces/${b}/peek`);
  const page = (title: string, caption: string) => {
    document.body.innerHTML = `<main role="main"></main>
      <div id="dock"><div role="button" aria-label="Collapse"></div><div role="button">Close</div><div id="title">${title}</div>
        <div role="listbox"><div><div>Ana</div><div>@ana</div><div>${caption}</div></div></div>
        <div><span id="played">12:00</span><span>-30:00</span></div></div>
      <div role="button" aria-label="Play recording" id="play"></div>`;
  };
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com/i/spaces/${b}/peek`,
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } as unknown as XWebview);
  markXReady();
  try {
    // A plays on; a caption naming B's title comes in, which is no sign X's player holds B.
    page("Recording A", "Welcome in.");
    document.getElementById("play")!.addEventListener("click", () => {
      document
        .querySelector('[role="listbox"]')!
        .append(Object.assign(document.createElement("div"), { textContent: "Recording B" }));
    });
    expect(await xSpacePlay(b, "Recording B")).toBeNull();

    // A and B share a title: X's player holding B shows as X starting it over.
    page("Weekly office hours", "Welcome in.");
    expect(await xSpacePlay(b, "Weekly office hours")).toBeNull();
    document.getElementById("play")!.addEventListener("click", () => {
      document.getElementById("played")!.textContent = "0:00";
    });
    expect(await xSpacePlay(b, "Weekly office hours")).toBe(true);
  } finally {
    registerXWebview(null);
    history.replaceState(null, "", "/");
  }
});
