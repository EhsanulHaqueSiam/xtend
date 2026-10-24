import { useAtomValue } from "@effect/atom-react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect } from "react";

import { AppShell } from "../components/shell/AppShell";
import { ShellHotkeys } from "../components/shell/ShellHotkeys";
import { ShellNotifications } from "../components/shell/ShellNotifications";
import { TooltipProvider } from "../components/ui/tooltip";
import { setDisplayZone } from "../lib/time";
import { settingsAtom } from "../state/settings";
import { connectionAtom } from "../state/shell";

/** Every timestamp the UI prints follows the account zone from Settings. */
function ZoneSync() {
  const settings = useAtomValue(settingsAtom);
  if (AsyncResult.isSuccess(settings)) setDisplayZone(settings.value.timeZone);
  return null;
}

const HEALTH_POLL_MS = 5_000;

/**
 * Suite screens grey out while the socket is down. The rpc socket layer does
 * not survive a failed token fetch, so once the service answers again the page
 * reloads to rebuild the client runtime.
 */
function Reconnecting({ children }: { readonly children: React.ReactNode }) {
  const connection = useAtomValue(connectionAtom);
  const down = connection === "disconnected";
  useEffect(() => {
    if (!down) return;
    const timer = setInterval(() => {
      fetch("/api/health")
        .then((r) => {
          if (r.ok) window.location.reload();
        })
        .catch(() => {});
    }, HEALTH_POLL_MS);
    return () => clearInterval(timer);
  }, [down]);
  return (
    <div className="relative flex h-full flex-col">
      {down ? (
        <div
          role="status"
          className="shrink-0 border-b border-border bg-background px-3 py-1.5 font-mono text-2xs text-warning-foreground"
        >
          Service unreachable, retrying
        </div>
      ) : null}
      <div className={down ? "min-h-0 flex-1 opacity-40 pointer-events-none" : "min-h-0 flex-1"}>
        {children}
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <TooltipProvider delay={300}>
      <ZoneSync />
      <ShellHotkeys />
      <ShellNotifications />
      <AppShell>
        <Reconnecting>
          <Outlet />
        </Reconnecting>
      </AppShell>
    </TooltipProvider>
  ),
});
