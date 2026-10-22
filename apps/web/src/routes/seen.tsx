import { createFileRoute } from "@tanstack/react-router";

import { SeenFeed } from "../components/SeenFeed";

export const Route = createFileRoute("/seen")({ component: SeenFeed });
