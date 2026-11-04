import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { CommunityToolList, useAdminPage } from "../components/xnative/CommunityTools";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XEmpty } from "../components/xnative/XRows";
import { engineAtom, moderates, roleIn } from "../state/engine";

/**
 * X's Admin tools for a Community, drawn by Xtend from the engine on x.com/i/communities/<id>/tools:
 * X's list of tools, with what waits on its moderators. X sends anyone else Home, and Xtend follows.
 */
function CommunityToolsScreen() {
  const { id } = Route.useParams();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const reload = useAdminPage(`/i/communities/${id}/tools`);
  const role = roleIn(engine, id);
  return (
    <XColumn
      header={
        <XTitle
          title={role === "Moderator" ? "Moderator tools" : "Admin tools"}
          detail={engine.communities.get(id)?.name}
          onBack={() => router.history.back()}
        />
      }
      refresh={{ surfaces: [], load: reload }}
    >
      {!moderates(role) ? (
        <XEmpty empty="Loading the Community's Admin tools from X." onReopen={reload} />
      ) : (
        <CommunityToolList communityId={id} />
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/communities/$id_/tools")({
  component: CommunityToolsScreen,
});
