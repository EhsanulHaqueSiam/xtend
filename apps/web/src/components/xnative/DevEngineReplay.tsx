import { useAtomSet } from "@effect/atom-react";
import { useEffect } from "react";

import { engineAtom, engineReplayAtom, mergeBatch, updateEngine } from "../../state/engine";
import { parseFixture, shiftBatch, type FixtureMeta } from "./engineFixtures";

const FILES = import.meta.glob<string>("../../../test/fixtures/engine/*.ndjson", {
  query: "?raw",
  import: "default",
});
const LOADERS = new Map(
  Object.entries(FILES).map(([path, load]) => [path.slice(path.lastIndexOf("/") + 1, -7), load]),
);
interface XtendDev {
  /** Replays an engine fixture into the store; `paceMs` spaces its batches like X's own answers. */
  readonly replay: (name: string, options?: { readonly paceMs?: number }) => Promise<FixtureMeta>;
  readonly fixtures: () => ReadonlyArray<string>;
}
declare global {
  interface Window {
    xtendDev?: XtendDev;
  }
}

/**
 * Dev, in a browser with no desktop: recorded or made-up X engine batches (scripts/
 * engine-fixture.ts) replayed into the one store, so the native X screens draw without x.com.
 * `?engine=home,post` (or `all`) on any page replays those at load; `xtendDev.replay(name)` later.
 */
export function DevEngineReplay({ asked }: { readonly asked: string | null }) {
  const setEngine = useAtomSet(engineAtom);
  const setReplayed = useAtomSet(engineReplayAtom);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- installs window.xtendDev for DevTools and agents, and replays ?engine= once at load.
  useEffect(() => {
    const replay: XtendDev["replay"] = async (name, { paceMs = 0 } = {}) => {
      const load = LOADERS.get(name);
      if (load === undefined)
        throw new Error(`No engine fixture "${name}". Have: ${[...LOADERS.keys()].join(", ")}`);
      const { meta, batches } = parseFixture(await load());
      // Times as if X sent them just now, so ages read "2m" rather than the day it was made.
      const shift = Date.now() - Date.parse(meta.at);
      for (const batch of batches) {
        if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
        setEngine(updateEngine((s) => mergeBatch(s, shiftBatch(batch, shift))));
      }
      setReplayed((all) => (all.includes(name) ? all : [...all, name]));
      return meta;
    };
    window.xtendDev = { replay, fixtures: () => [...LOADERS.keys()] };
    const names = asked === "all" ? [...LOADERS.keys()] : (asked?.split(",") ?? []);
    void names
      .filter((n) => n !== "")
      .reduce((done, n) => done.then(() => replay(n)).then(() => {}), Promise.resolve());
    return () => void delete window.xtendDev;
  }, [asked, setEngine, setReplayed]);
  return null;
}
