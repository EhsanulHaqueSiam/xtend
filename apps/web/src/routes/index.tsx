import { createFileRoute } from "@tanstack/react-router";

import { isElectron } from "../env";
import { SessionViewSlot } from "../components/SessionViewSlot";
import { SeenFeed } from "../components/SeenFeed";

/**
 * Home is x.com itself. The desktop draws the session view over this slot; a
 * plain browser cannot embed x.com, so it shows what the session observed.
 */
function Home() {
  return isElectron ? <SessionViewSlot /> : <SeenFeed />;
}

export const Route = createFileRoute("/")({ component: Home });
