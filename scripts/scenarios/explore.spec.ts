// What `pnpm explore` checks while Bombadil clicks, types and navigates through the seeded web app
// at random. Every export is a property or an action generator; Bombadil bundles this file itself.
import { always, next, now } from "@antithesishq/bombadil";
import { isAction } from "@antithesishq/bombadil/actions";
import {
  type Fingerprint,
  actions,
  extract,
  registerCustomAction,
} from "@antithesishq/bombadil/browser";
import { defaultActions } from "@antithesishq/bombadil/browser/defaults";

// No uncaught exceptions, unhandled rejections, console errors or HTTP 4xx/5xx.
export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults";

/** "View on X" and links to x.com open a tab on X itself: outside the app, and it stalls the run. */
const opensX = ({ href, accessibleName, textContent }: Fingerprint) =>
  href?.startsWith("https://x.com") === true ||
  /\bon X\b/.test(accessibleName ?? textContent ?? "");

// Bombadil cannot answer a native dialog: an open `window.confirm` (the delete prompts) stalls every
// step after it. So each page load first swaps it for "OK", which still explores the deletes.
const confirmAccepted = extract((state) => "xtendConfirmAccepted" in state.window);
const acceptConfirms = registerCustomAction("acceptConfirms", async (_document, window) => {
  window.confirm = () => true;
  Object.assign(window, { xtendConfirmAccepted: true });
});
export const firstAcceptConfirms = actions(() =>
  confirmAccepted.current ? [] : [acceptConfirms()],
);

export const explore = defaultActions
  .filter(
    (action) =>
      !(isAction(action, "Click") && opensX(action.Click.fingerprint)) &&
      !(isAction(action, "DoubleClick") && opensX(action.DoubleClick.fingerprint)),
  )
  .when(confirmAccepted);

const text = extract((state) => state.document.body.innerText);

/** A value rendered without formatting: a missing field, a bad number, an object. */
export const noBrokenText = always(
  () => !/\bundefined\b|\bNaN\b|\[object Object\]|\bInfinity\b/.test(text.current),
);

/** This month's spend from the sidebar's `$12.34 / $50`, or null while it loads. */
const spent = extract((state) => {
  const match = /\$(\d+\.\d{2}) \/ \$\d+/.exec(state.document.body.innerText);
  return match === null ? null : Number(match[1]);
});

/** Money spent stays spent: no click, reload or navigation lowers the meter. */
export const spendNeverDrops = always(
  now(() => {
    const before = spent.current;
    return next(() => before === null || spent.current === null || spent.current >= before);
  }),
);
