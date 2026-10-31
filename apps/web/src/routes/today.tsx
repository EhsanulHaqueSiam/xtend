import { createFileRoute } from "@tanstack/react-router";

import { Today } from "../components/today/Today";

export const Route = createFileRoute("/today")({ component: Today });
