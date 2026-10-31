import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { DryRun } from "../components/automate/DryRun";
import { NeedsYou } from "../components/automate/NeedsYou";
import { Rules } from "../components/automate/Rules";
import { Runs } from "../components/automate/RunsLog";
import { HeaderTabs } from "../components/PageHeader";
import { useSection } from "../components/shell/sections";

const RULE_VIEWS = [
  { id: "rules", label: "Rules" },
  { id: "dry-run", label: "Dry run" },
] as const;

/** The rules, or what they would do: Dry run reads stored data only and fires nothing. */
function RulesScreen() {
  const [view, setView] = useState<(typeof RULE_VIEWS)[number]["id"]>("rules");
  const tabs = <HeaderTabs label="View" tabs={RULE_VIEWS} value={view} onChange={setView} />;
  return view === "rules" ? <Rules tabs={tabs} /> : <DryRun tabs={tabs} />;
}

/** Each section is its own page with its own header; the sidebar switches between them. */
function AutomateScreen() {
  const section = useSection("/automate");
  switch (section) {
    case "rules":
      return <RulesScreen />;
    case "needs-you":
      return <NeedsYou />;
    case "runs":
      return <Runs />;
  }
}

export const Route = createFileRoute("/automate")({ component: AutomateScreen });
