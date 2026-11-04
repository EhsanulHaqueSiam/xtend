import type { EngineBatch, EngineCommunityAdmin } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { AdminToolsButton, CommunityToolList } from "./CommunityTools";
import { EngineSync } from "./EngineSync";

/** X's Admin tools answer for Community 20, as the desktop's capture sends it. */
const tools = (admin: Omit<EngineCommunityAdmin, "communityId">): EngineBatch => ({
  op: "CommunityToolsScreenContainerQuery",
  key: "community:20",
  cursor: null,
  top: null,
  bottom: null,
  posts: [],
  users: [],
  people: [],
  sections: [],
  order: [],
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
  homeTabs: null,
  exploreTabs: null,
  viewer: null,
  communityAdmin: [{ communityId: "20", ...admin }],
});

it("lists X's Admin tools by X's role rules, with requests and Spotlight only where X offers them", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/i/communities/20/tools",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(null)),
  } as unknown as XWebview);
  markXReady();
  try {
    await using screen = await render(
      <>
        <EngineSync />
        <AdminToolsButton communityId="20" />
        <CommunityToolList communityId="20" />
      </>,
      {
        service: {
          "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        },
      },
    );
    const rows = () =>
      [...screen.container.querySelectorAll('[data-x="community-tools"] button')].map(
        (b) => b.querySelector("span span")?.textContent,
      );
    bridge.emitEngine(
      tools({
        role: "Admin",
        reported: 2,
        requests: 3,
        spotlight: "/i/flow/convert_to_professional",
      }),
    );
    // X's gear counts what waits on the mods: requests and reported posts.
    await expect.element(screen.getByRole("link", { name: "Admin tools" })).toHaveTextContent("5");
    expect(rows()).toEqual([
      "Reported posts",
      "Member requests",
      "Moderation log",
      "General settings",
      "Spam settings",
      "Members",
      "Rules",
      "Analytics",
      "Community list",
      "Spotlight your Community",
      "Support and resources",
    ]);

    // A moderator of an Open Community, offered no Spotlight: no admin rows, and X's Leave.
    bridge.emitEngine(tools({ role: "Moderator", reported: 0, requests: null, spotlight: null }));
    await expect.element(screen.getByRole("link", { name: "Moderator tools" })).toBeVisible();
    expect(rows()).toEqual([
      "Reported posts",
      "Moderation log",
      "Members",
      "Rules",
      "Analytics",
      "Support and resources",
      "Leave moderation team",
    ]);
    // A tool Xtend does not draw opens X's own page for it.
    await screen.getByRole("button", { name: /^Rules/ }).click();
    await expect
      .poll(() => scripts.some((s) => s.includes('"/i/communities/20/tools/rules"')))
      .toBe(true);

    // A member has no gear.
    bridge.emitEngine(tools({ role: "Member" }));
    await expect
      .element(screen.getByRole("link", { name: "Moderator tools" }))
      .not.toBeInTheDocument();
  } finally {
    registerXWebview(null);
  }
});
