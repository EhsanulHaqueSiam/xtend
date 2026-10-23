import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { DesktopBridge, ShortcutKey } from "../../desktopBridge";
import { SessionBar } from "./SessionBar";

/** A bridge that records calls and lets the test play the main process. */
function fakeBridge() {
  const calls: Array<string> = [];
  const listeners = {
    url: new Set<(url: string) => void>(),
    shortcut: new Set<(k: ShortcutKey) => void>(),
  };
  const subscribe =
    <T,>(set: Set<(v: T) => void>) =>
    (cb: (v: T) => void) => {
      set.add(cb);
      return () => set.delete(cb);
    };
  const bridge: DesktopBridge = {
    platform: "darwin",
    setSessionViewBounds: () => {},
    setSessionViewHidden: () => {},
    navigateSession: (url) => calls.push(`navigate ${url}`),
    sessionBack: () => calls.push("back"),
    sessionForward: () => calls.push("forward"),
    sessionReload: () => calls.push("reload"),
    sessionFind: (find) =>
      calls.push(
        find === null
          ? "find stop"
          : `find ${find.text} ${find.forward ? ">" : "<"} ${find.findNext}`,
      ),
    openExternal: () => {},
    serviceToken: "",
    serviceMode: "none",
    remote: null,
    accountId: 1,
    checkRemote: () => Promise.resolve({ health: false, version: null, auth: false, error: null }),
    setRemote: () => {},
    selectAccount: () => {},
    onSessionUrl: subscribe(listeners.url),
    onSessionFindResult: () => () => {},
    onSessionDownload: () => () => {},
    onShortcut: subscribe(listeners.shortcut),
    onOpenRoute: () => () => {},
  };
  return { bridge, calls, listeners };
}

it("shows the session URL, navigates on enter and drives find from ⌘F", async () => {
  const { bridge, calls, listeners } = fakeBridge();
  await using screen = await render(<SessionBar bridge={bridge} />);
  for (const cb of listeners.url) cb("https://x.com/home");
  await expect.element(screen.getByLabelText("Session URL")).toHaveValue("https://x.com/home");

  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(calls).toEqual(["back"]);

  const url = screen.getByLabelText("Session URL");
  await userEvent.clear(url);
  await userEvent.type(url, "i/bookmarks{Enter}");
  expect(calls.at(-1)).toBe("navigate https://x.com/i/bookmarks");

  for (const cb of listeners.shortcut) cb("find");
  const find = screen.getByLabelText("Find in page");
  await expect.element(find).toBeVisible();
  await userEvent.type(find, "ab{Enter}");
  expect(calls.slice(-3)).toEqual(["find a > false", "find ab > false", "find ab > true"]);
  await userEvent.keyboard("{Escape}");
  expect(calls.at(-1)).toBe("find stop");
  await expect.element(screen.getByLabelText("Find in page")).not.toBeInTheDocument();
});
