import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/scores")({
  component: () => (
    <Placeholder title="Scores" detail="Your score, watchlist, bot check. Not built yet." />
  ),
});
