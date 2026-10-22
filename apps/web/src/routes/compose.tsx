import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/compose")({
  component: () => (
    <Placeholder
      title="Compose"
      detail="Thread editor with preview, AI assist and a queue. Not built yet."
    />
  ),
});
