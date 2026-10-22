import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/automate")({
  component: () => (
    <Placeholder title="Automate" detail="Rules with budgets, dry runs and a log. Not built yet." />
  ),
});
