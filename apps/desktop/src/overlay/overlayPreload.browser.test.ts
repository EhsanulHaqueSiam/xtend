import type { OverlayAction, OverlayData, OverlaySave } from "../ipc/channels.ts";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const ipc = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, value: unknown) => void>(),
  sent: [] as Array<readonly [string, OverlayAction]>,
}));
vi.mock("electron", () => ({
  ipcRenderer: {
    on: (channel: string, listener: (event: unknown, value: unknown) => void) =>
      ipc.listeners.set(channel, listener),
    send: (channel: string, value: OverlayAction) => ipc.sent.push([channel, value]),
  },
}));

const roots = new Map<Element, ShadowRoot>();
beforeAll(async () => {
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    const root = attach.call(this, options);
    roots.set(this, root);
    return root;
  });
  await import("./overlayPreload.ts");
  window.dispatchEvent(new Event("DOMContentLoaded"));
});
afterEach(() => {
  document.body.innerHTML = "";
  ipc.sent.length = 0;
});

const rootFor = (selector: string) => {
  const host = document.querySelector(selector);
  const root = host === null ? undefined : roots.get(host);
  if (root === undefined) throw new Error(`missing shadow root: ${selector}`);
  return root;
};
const seed = async () => {
  document.body.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name">@jack</div><a href="/jack/status/20"><time></time></a><div role="group"></div></article>`;
  const data: OverlayData = {
    ownAverage: null,
    posts: {
      "20": {
        views: 1000,
        likes: 2,
        reposts: 0,
        replies: 0,
        quotes: 0,
        bookmarks: 0,
        createdAt: new Date().toISOString(),
        authorHandle: "jack",
        authorFollowers: 500,
        authorVerified: false,
        isOwn: false,
        isPromoted: false,
      },
    },
  };
  ipc.listeners.get("xtend:overlay-data")?.({}, data);
  await expect.poll(() => document.querySelector('[data-xtend="strip"]')).not.toBeNull();
};

it("keeps the author card reachable while moving from its trigger to the card", async () => {
  await seed();
  const trigger = document.querySelector<HTMLElement>('[data-testid="User-Name"]')!;
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  await expect.poll(() => document.querySelector('[data-xtend="card"]')).not.toBeNull();
  const card = rootFor('[data-xtend="card"]').querySelector<HTMLElement>(".card")!;
  trigger.dispatchEvent(new MouseEvent("mouseleave"));
  expect(card.isConnected).toBe(true);
  card.dispatchEvent(new MouseEvent("mouseenter"));
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(card.isConnected).toBe(true);
  card.querySelector<HTMLButtonElement>("button")!.click();
  expect(ipc.sent.at(-1)).toEqual([
    "xtend:overlay-action",
    { type: "openRoute", route: "/scores?handle=jack" },
  ]);
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  await expect.poll(() => card.isConnected).toBe(true);
  trigger.dispatchEvent(new MouseEvent("mouseleave"));
  await expect.poll(() => card.isConnected).toBe(false);
});

it("activates Schedule once for Enter, Space and a pointer click", async () => {
  document.body.innerHTML = `<div><div data-testid="tweetTextarea_0" contenteditable="true">hello x</div><div data-testid="toolBar"><nav></nav><div>Post</div></div></div>`;
  await expect.poll(() => document.querySelector('[data-xtend="chips"]')).not.toBeNull();
  const button = rootFor('[data-xtend="chips"]').querySelector<HTMLButtonElement>("button")!;
  button.focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  expect(ipc.sent).toEqual(
    Array.from({ length: 3 }, () => [
      "xtend:overlay-action",
      { type: "openRoute", route: "/compose?text=hello%20x" },
    ]),
  );
});

it("acknowledges saves, blocks repeats while saving and allows retry on failure", async () => {
  await seed();
  const root = rootFor('[data-xtend="strip"]');
  const save = () => root.querySelector<HTMLButtonElement>('[data-act="save"]')!;
  save().click();
  expect(save().textContent).toBe("Saving");
  expect(save().disabled).toBe(true);
  save().click();
  expect(ipc.sent).toHaveLength(1);
  const status = (state: OverlaySave["state"]) =>
    ipc.listeners.get("xtend:overlay-save")?.({}, { postId: "20", state });
  status("failed");
  await expect.poll(() => save().textContent).toBe("Save failed, try again");
  save().click();
  expect(ipc.sent).toHaveLength(2);
  status("saved");
  await expect.poll(() => save().textContent).toBe("Saved");
  expect(save().disabled).toBe(true);
});
