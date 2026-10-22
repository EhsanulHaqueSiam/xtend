import { useAtomValue } from "@effect/atom-react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { AppSidebar } from "../components/AppSidebar";
import { TooltipProvider } from "../components/ui/tooltip";
import { setDisplayZone } from "../lib/time";
import { settingsAtom } from "../state/settings";

/** Every timestamp the UI prints follows the account zone from Settings. */
function ZoneSync() {
  const settings = useAtomValue(settingsAtom);
  if (AsyncResult.isSuccess(settings)) setDisplayZone(settings.value.timeZone);
  return null;
}

export const Route = createRootRoute({
  component: () => (
    <TooltipProvider delay={300}>
      <ZoneSync />
      <AppSidebar>
        <Outlet />
      </AppSidebar>
    </TooltipProvider>
  ),
});
