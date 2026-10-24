import { createFileRoute, redirect } from "@tanstack/react-router";

import { isElectron } from "../env";

/**
 * X's own pages. The shell draws x.com over the main area on this route, so
 * the route itself renders nothing; a browser has no x.com session and goes home.
 */
export const Route = createFileRoute("/x")({
  beforeLoad: () => {
    if (!isElectron) throw redirect({ to: "/" });
  },
  component: () => null,
});
