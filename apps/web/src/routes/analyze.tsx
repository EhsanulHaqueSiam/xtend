import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/analyze")({
  component: () => (
    <Placeholder
      title="Analyze"
      detail="Overview, posts, audience, best time, competitors. Not built yet."
    />
  ),
});
