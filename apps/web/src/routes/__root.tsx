import { createRootRoute, Outlet } from "@tanstack/react-router";

import { AppSidebar } from "../components/AppSidebar";
import { TooltipProvider } from "../components/ui/tooltip";

export const Route = createRootRoute({
  component: () => (
    <TooltipProvider delay={300}>
      <AppSidebar>
        <Outlet />
      </AppSidebar>
    </TooltipProvider>
  ),
});
