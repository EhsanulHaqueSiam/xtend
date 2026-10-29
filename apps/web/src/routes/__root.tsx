import { useAtomValue } from "@effect/atom-react";
import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef } from "react";

import { AccountSync } from "../components/shell/AccountSync";
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
 * Service configuration stays reachable while suite actions pause. A failed
 * token fetch stops the rpc socket layer, so the page reloads once the service
 * answers again to rebuild the client runtime.
 */
export function Reconnecting({ children }: { readonly children: React.ReactNode }) {
  const connection = useAtomValue(connectionAtom);
  const location = useLocation();
  const navigate = useNavigate();
  const serviceSettings =
    location.pathname === "/settings" &&
    new URLSearchParams(location.searchStr).get("tab") === "service";
  const down = connection === "disconnected";
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (down) notice.current?.focus();
  }, [down]);
  useEffect(() => {
    if (!down || serviceSettings) return;
    let active = true;
    const timer = setInterval(() => {
      fetch("/api/health")
        .then((r) => {
          if (active && r.ok) window.location.reload();
        })
        .catch(() => {});
    }, HEALTH_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [down, serviceSettings]);
  return (
    <div className="relative flex h-full flex-col">
      {down ? (
        <div
          ref={notice}
          tabIndex={-1}
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-1.5 font-mono text-2xs text-warning-foreground"
        >
          Service unreachable, retrying
          <button
            type="button"
            className="cursor-pointer text-foreground underline"
            onClick={() => void navigate({ href: "/settings?tab=service" })}
          >
            Service settings
          </button>
        </div>
      ) : null}
      <div
        inert={down && !serviceSettings}
        className={
          down && !serviceSettings
            ? "min-h-0 flex-1 opacity-40 pointer-events-none"
            : "min-h-0 flex-1"
        }
      >
        {children}
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <TooltipProvider delay={300}>
      <ZoneSync />
      <AccountSync />
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
