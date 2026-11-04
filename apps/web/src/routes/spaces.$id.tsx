import { createFileRoute } from "@tanstack/react-router";

import { SpaceRecording } from "../components/xnative/SpaceRecording";

/** A Space's recording, read like a thread, with X's player (`components/xnative/SpaceRecording`). */
function SpaceScreen() {
  const { id } = Route.useParams();
  return <SpaceRecording spaceId={id} />;
}

export const Route = createFileRoute("/spaces/$id")({ component: SpaceScreen });
