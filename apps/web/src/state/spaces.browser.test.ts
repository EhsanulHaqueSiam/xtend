import { expect, it } from "vite-plus/test";

import { forgetSpaceRead, xSpacePlay, xSpaceRead } from "./spaces";
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

    // A and B share a title: X refuses B, then draws A's dock anew at the same 12:00. A dock drawn
    // anew is no sign X's player holds B, so Xtend never claims it.
    page("Weekly office hours", "Welcome in.");
    document.getElementById("play")!.addEventListener("click", () => {
      const dock = document.getElementById("dock")!;
      dock.replaceWith(dock.cloneNode(true));
    });
    expect(await xSpacePlay(b, "Weekly office hours")).toBe("unsure");
    // X refuses B while A plays on: its clock ticks 12:00 to 12:01 with -30:00 left, the second
    // X's display rounds away, which is no other length.
    page("Weekly office hours", "Welcome in.");
    document.getElementById("play")!.addEventListener("click", () => {
      document.getElementById("played")!.textContent = "12:01";
    });
    expect(await xSpacePlay(b, "Weekly office hours")).toBe("unsure");
    // X's player holding B shows as X starting it over.
    page("Weekly office hours", "Welcome in.");
    document.getElementById("play")!.addEventListener("click", () => {
      document.getElementById("played")!.textContent = "0:00";
    });
    expect(await xSpacePlay(b, "Weekly office hours")).toBe(true);
  } finally {
    registerXWebview(null);
    history.replaceState(null, "", "/");
  }
});

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
