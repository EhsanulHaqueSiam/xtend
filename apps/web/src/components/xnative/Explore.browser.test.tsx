import type { EngineBatch } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { Suspense } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Toasts } from "../ui/toast";
import { EngineSync } from "./EngineSync";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { Route } from "../../routes/explore";

vi.mock("../shell/HomeCompanion", () => ({ DayGlance: () => null }));

it.each([
  { enabled: false, current: true, feedback: "success" },
  { enabled: true, current: true, feedback: "success" },
  { enabled: true, current: false, feedback: "success" },
  { enabled: true, current: true, feedback: "error" },
  { enabled: true, current: true, feedback: "unmounted" },
])(
  "reads X's trend menu and respects session actions (%s), including hiding and Undo",
  async ({ enabled, current, feedback }) => {
    const dismissed = feedback === "success";
    const toast =
      feedback === "unmounted"
        ? null
        : feedback === "error"
          ? "Something went wrong. Try again."
          : "Thanks";
    const search = vi.spyOn(Route, "useSearch").mockReturnValue({ tab: "news" });
    const bridge = installFakeBridge();
    const labels = ["Not interested in this", "This trend is spam"] as const;
    const scripts: Array<string> = [];
    registerXWebview({
      getURL: () => "https://x.com/explore",
      loadURL: () => Promise.resolve(),
      executeJavaScript: (code: string) => {
        scripts.push(code);
        return Promise.resolve(
          code.includes("const labels")
            ? labels
            : code.includes("item.click()")
              ? {
                  kind: "done",
                  toast,
                  undo: dismissed,
                  gone: feedback !== "error",
                  dismissed,
                  current,
                }
              : true,
        );
      },
    } as unknown as XWebview);
    markXReady();
    const Explore = Route.options.component!;
    const capture: EngineBatch = {
      op: "GenericTimelineById",
      key: "news",
      cursor: null,
      top: null,
      bottom: null,
      posts: [],
      users: [],
      people: [],
      sections: [],
      communities: [],
      order: [],
      notifications: [],
      lists: [],
      homeTabs: null,
      viewer: null,
      exploreTabs: [
        { id: "for_you", label: "For you", timelineId: "for-you" },
        { id: "news", label: "News", timelineId: "news" },
      ],
      trends: [
        {
          name: "A news story",
          context: "News",
          url: "https://x.com/search?q=news",
          images: [
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          ],
          group: null,
        },
      ],
    };
    try {
      await using screen = await render(
        <>
          <EngineSync />
          <Suspense>
            <Explore />
          </Suspense>
          <Toasts />
        </>,
        {
          service: {
            "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: enabled }),
          },
        },
      );
      bridge.emitEngine(capture);
      await screen.getByRole("button", { name: "More", exact: true }).click();
      await expect
        .element(page.getByRole("menuitem", { name: labels[0], exact: true }))
        .toBeVisible();
      await page.getByRole("menuitem", { name: labels[0], exact: true }).click();
      if (!enabled) {
        await expect
          .element(screen.getByRole("status"))
          .toHaveTextContent("Session actions are off in Settings, X session.");
        expect(scripts.some((s) => s.includes("item.click()"))).toBe(false);
        await expect.element(screen.getByText("A news story", { exact: true })).toBeVisible();
        return;
      }
      if (!current || !dismissed) {
        if (toast !== null)
          await expect
            .element(screen.getByRole("status"))
            .toHaveTextContent(dismissed ? "ThanksUndo" : toast);
        await expect.element(screen.getByText("A news story", { exact: true })).toBeVisible();
        return;
      }
      await expect
        .element(screen.getByText("A news story", { exact: true }))
        .not.toBeInTheDocument();
      bridge.emitEngine(capture);
      await expect
        .element(screen.getByText("A news story", { exact: true }))
        .not.toBeInTheDocument();
      bridge.emitEngine({ ...capture, trends: [] });
      await screen.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.element(screen.getByText("A news story", { exact: true })).toBeVisible();
      expect(scripts.filter((s) => s.includes("item.click()")).length).toBe(1);
    } finally {
      registerXWebview(null);
      search.mockRestore();
    }
  },
);
