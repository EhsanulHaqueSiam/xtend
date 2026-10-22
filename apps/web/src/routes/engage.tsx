import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/engage")({
  component: () => (
    <Placeholder title="Engage" detail="Reply targets, mentions and inbox. Not built yet." />
  ),
});
