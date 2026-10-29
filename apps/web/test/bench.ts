import { useAtomRefresh } from "@effect/atom-react";
import type * as Atom from "effect/reactivity/Atom";
import type { ReactNode } from "react";

import { render, type RenderOptions } from "./render";

/**
 * Helpers for the render benchmarks (`src/**\/*.browser.bench.tsx`), which only
 * `vp test bench` runs. Numbers come from React's development build, as every browser test
 * uses: compare them with each other and over time, not with production. Each bench asserts
 * only a ceiling about ten times the median measured on an Apple M4 (noted beside it), which
 * catches a pathological regression and nothing finer.
 *
 * Bench functions must be `async` functions: tinybench calls any other function once, without
 * awaiting it, to learn whether it returns a promise, and that stray run overlaps the next one.
 */

/** A fixed sample count rather than a time budget, so a slower screen takes longer instead of measuring less. */
export const SAMPLES = { iterations: 30, time: 0, warmupIterations: 5, warmupTime: 0 };

/** The desktop window the app is built for; the test default is phone-sized and hides columns. */
export const DESKTOP = { width: 1440, height: 900 } as const;

/**
 * Resolves once `done()` holds, checked after every DOM change under `root`, then forces style
 * and layout: a long list costs as much there as in React, and the user waits for both.
 */
export const settled = (root: Node, done: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      observer.disconnect();
      clearTimeout(timer);
      document.body.getBoundingClientRect();
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (done()) finish();
    });
    // A wrong fixture would otherwise hang until the test timeout without saying why.
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("the screen never reached the state the bench waits for"));
    }, 5_000);
    if (done()) return finish();
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });

/**
 * A bench function timing one mount, from render until `done(container)`. The unmount after
 * each sample is left out through tinybench's `overriddenDuration`.
 */
export const timeMount =
  (ui: ReactNode, options: RenderOptions, done: (container: HTMLElement) => boolean) =>
  async () => {
    const start = performance.now();
    await using screen = await render(ui, options);
    await settled(screen.container, () => done(screen.container));
    return { overriddenDuration: performance.now() - start };
  };

/**
 * AGENTS.md rule 4: an animation that never ends repaints every frame. CSS animations and
 * script-driven ones both list here; transitions always end.
 */
export const endlessAnimations = () =>
  document
    .getAnimations()
    .filter((a) => a.effect?.getTiming().iterations === Infinity)
    .map((a) => (a instanceof CSSAnimation ? a.animationName : a.id));

/**
 * Mounted beside a screen, hands the bench `atom`'s refresh: the call the screen itself makes
 * after a write, so the bench can change one row and time the refetch and re-render.
 */
export function Refresh({
  atom,
  bind,
}: {
  readonly atom: Atom.Atom<unknown>;
  readonly bind: (refresh: () => void) => void;
}) {
  bind(useAtomRefresh(atom));
  return null;
}
