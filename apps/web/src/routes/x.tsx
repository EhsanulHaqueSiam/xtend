import { createFileRoute, redirect } from "@tanstack/react-router";

import { HomeCompanion } from "../components/shell/HomeCompanion";
import { isElectron } from "../env";

/**
 * X's own pages. The shell draws x.com over the main area on this route; the
 * route itself only fills the companion column beside it. A browser has no
 * x.com session and goes home.
 */
export const Route = createFileRoute("/x")({
  beforeLoad: () => {
    if (!isElectron) throw redirect({ to: "/" });
  },
  component: HomeCompanion,
});
