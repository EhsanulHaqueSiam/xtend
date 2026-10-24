import { createFileRoute } from "@tanstack/react-router";

import { DryRun } from "../components/automate/DryRun";
import { NeedsYou } from "../components/automate/NeedsYou";
import { Rules } from "../components/automate/Rules";
import { Runs } from "../components/automate/RunsLog";
import { useSection } from "../components/shell/sections";

/** Each section is its own page with its own header; the sidebar switches between them. */
function AutomateScreen() {
  const section = useSection("/automate");
  switch (section) {
    case "rules":
      return <Rules />;
    case "needs-you":
      return <NeedsYou />;
    case "dry-run":
      return <DryRun />;
    case "runs":
      return <Runs />;
  }
}

export const Route = createFileRoute("/automate")({ component: AutomateScreen });
