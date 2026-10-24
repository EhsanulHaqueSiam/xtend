import { createFileRoute, redirect } from "@tanstack/react-router";

import { SeenFeed } from "../components/SeenFeed";
import { isElectron } from "../env";

/** On the desktop home is x.com itself; in a browser it is what the session observed. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (isElectron) throw redirect({ to: "/x" });
  },
  component: SeenFeed,
});
