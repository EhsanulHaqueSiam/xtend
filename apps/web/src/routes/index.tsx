import { createFileRoute } from "@tanstack/react-router";

import { SeenFeed } from "../components/SeenFeed";

/** Home is what the x.com session observed; in the desktop, x.com itself is the window around this view. */
export const Route = createFileRoute("/")({ component: SeenFeed });
