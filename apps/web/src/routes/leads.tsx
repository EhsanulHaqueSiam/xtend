import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/leads")({
  component: () => (
    <Placeholder title="Leads" detail="Lists, signal agents, people. Not built yet." />
  ),
});
