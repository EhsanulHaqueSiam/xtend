import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/library")({
  component: () => (
    <Placeholder
      title="Library"
      detail="Viral posts, daily picks, collections, swipe file. Not built yet."
    />
  ),
});
