import { beforeEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

// Defined in vite.config.ts. Moves Playwright's mouse off the page. The command
// map is typed by vitest's browser context, which cannot be augmented through
// vite-plus's re-export, so the custom command is typed here.
const browserCommands = commands as unknown as { readonly resetPointer: () => Promise<void> };

// Playwright's mouse outlives each test and each file, so whatever the next test mounts
// under its last position starts hovered. Registered here rather than in render() so tests
// that mount without it are covered too. Before each test, not after: a timed-out test keeps
// running and can move the mouse after its own afterEach.
beforeEach(async () => {
  await browserCommands.resetPointer();
});
