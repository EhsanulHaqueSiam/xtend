import { useEffect, useState } from "react";

import type { UpdateState } from "../desktopBridge";

/** The desktop's own update as main reports it; null in a browser or before the first answer. */
export function useDesktopUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) return;
    let live = true;
    // The push can beat the first answer; whichever came last wins.
    const off = bridge.onUpdate((next) => {
      live = false;
      setState(next);
    });
    void bridge.getUpdate().then((first) => {
      if (live) setState(first);
    });
    return off;
  }, []);
  return state;
}
