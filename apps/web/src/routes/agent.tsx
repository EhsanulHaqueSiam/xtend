import { createFileRoute } from "@tanstack/react-router";

import { AgentView } from "../components/agent/AgentView";

export const Route = createFileRoute("/agent")({ component: AgentView });
