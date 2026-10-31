import { createFileRoute, redirect } from "@tanstack/react-router";

import { Today } from "../components/today/Today";
import { isElectron } from "../env";

/** On the desktop home is x.com itself; in a browser it is the day at a glance. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (isElectron) throw redirect({ to: "/home", search: { feed: "following" } });
  },
  component: Today,
});
