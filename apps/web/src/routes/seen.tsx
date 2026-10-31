import { createFileRoute, redirect } from "@tanstack/react-router";

/** Seen lives in Library now; old links and the palette's Seen land there. */
export const Route = createFileRoute("/seen")({
  beforeLoad: () => {
    throw redirect({ to: "/library", search: { tab: "seen", q: undefined }, replace: true });
  },
});
