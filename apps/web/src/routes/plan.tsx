import { createFileRoute } from "@tanstack/react-router";

import { Placeholder } from "../components/Placeholder";

export const Route = createFileRoute("/plan")({
  component: () => <Placeholder title="Plan" detail="Queue, slots and calendar. Not built yet." />,
});
