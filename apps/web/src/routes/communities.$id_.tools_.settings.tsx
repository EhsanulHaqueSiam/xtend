import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import {
  CommunityToolList,
  onXControl,
  onXPage,
  useAdminPage,
  useOnX,
} from "../components/xnative/CommunityTools";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XEmpty } from "../components/xnative/XRows";
import { engineAtom, roleIn } from "../state/engine";

const SECTION = "px-4 pt-4 pb-1 text-[20px] leading-6 font-extrabold";

/**
 * X's General settings for a Community, from the engine on its /tools/settings, X's Admin tools in
 * the rail. Each setting opens X's own edit over the main area; back here, X's page loads again so
 * X's fetch shows what was saved. Admins only: X sends anyone else Home, and Xtend follows.
 */
function CommunitySettingsScreen() {
  const { id } = Route.useParams();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const onX = useOnX();
  const path = `/i/communities/${id}/tools/settings`;
  const reload = useAdminPage(path);
  const role = roleIn(engine, id);
  const community = engine.communities.get(id);
  const admin = engine.communityAdmin.get(id);
  const edit = (label: string, slug: string) => () =>
    void onX(label, onXPage(`${path}/${slug}`), reload);
  const nsfw = admin?.nsfw ?? false;
  const row = (label: string, slug: string, value?: string | null) => (
    <button
      key={slug}
      type="button"
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={edit(label, slug)}
    >
      <span className="min-w-0 flex-1 leading-5">
        <span className="block">{label}</span>
        {value === undefined || value === null || value === "" ? null : (
          <span className="block truncate text-[13px] text-[#71767b]">{value}</span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-[#71767b]" />
    </button>
  );
  return (
    <XColumn
      header={
        <XTitle title="Settings" detail={community?.name} onBack={() => router.history.back()} />
      }
      rail={
        role === null ? undefined : <CommunityToolList communityId={id} current="settings" rail />
      }
      refresh={{ surfaces: [], load: reload }}
    >
      {role !== "Admin" || community === undefined ? (
        <XEmpty empty="Loading the Community's settings from X." onReopen={reload} />
      ) : (
        <div data-x="community-settings">
          {community.bannerUrl === null ? (
            <div className="aspect-[3/1] bg-[#333639]" />
          ) : (
            <img src={community.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" />
          )}
          <h2 className={SECTION}>Community information</h2>
          {row("Name", "name", community.name)}
          {row("Purpose", "purpose", community.description)}
          {row("Approval question", "question", admin?.question)}
          {row("Topic", "topic", community.topic)}
          {row("Search tags", "searchtags", admin?.searchTags?.join(", "))}
          {row("Pinned hashtags", "hashtags")}
          <div className="mt-2 border-t border-border" />
          <h2 className={SECTION}>Membership</h2>
          {row(
            "Membership type",
            "membership",
            community.joinPolicy === null
              ? null
              : community.joinPolicy === "Open"
                ? "Open"
                : "Restricted",
          )}
          {/* X saves it at the press and loads its page again, which shows what X kept. */}
          <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 leading-5">
              <span className="block">Adult Content (NSFW)</span>
              <span className="mt-1 block text-[13px] text-[#71767b]">
                You must enable this setting if your community contains adult-sensitive content.
                Omitting this will result in automatic filtering of all adult-sensitive content
                within your community.
              </span>
            </span>
            <input
              type="checkbox"
              checked={nsfw}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[#1d9bf0]"
              onChange={() =>
                void onX("Adult Content (NSFW)", onXControl(path, "Adult Content (NSFW)", nsfw))
              }
            />
          </label>
          {admin?.deletable !== true ? null : (
            <>
              <div className="mt-2 border-t border-border" />
              <button
                type="button"
                className="w-full cursor-pointer px-4 py-3 text-left text-[15px] text-[#f4212e] transition-colors duration-150 hover:bg-[#f4212e]/10"
                onClick={() => void onX("Delete Community", onXControl(path, "Delete Community"))}
              >
                Delete Community
              </button>
            </>
          )}
        </div>
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/communities/$id_/tools_/settings")({
  component: CommunitySettingsScreen,
});
