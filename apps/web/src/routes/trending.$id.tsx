import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Timeline } from "../components/xnative/Timeline";
import { XTabs, XTitle } from "../components/xnative/XColumn";
import { fmtWhen } from "../lib/time";
import { engineAtom } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/**
 * X's news story, drawn by Xtend from the engine on x.com/i/trending/<id>: its headline, when X
 * updated it, Grok's summary and X's caveat, then the posts of the tab picked. A tab is X's own
 * page (`?timeline=`), which the engine opens through X's router.
 */
function StoryScreen() {
  const { id } = Route.useParams();
  const { timeline } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const story = useAtomValue(engineAtom).stories.get(id);
  const tabs = story?.timelines ?? [];
  const tab = tabs.find((t) => t.timelineId === timeline) ?? tabs[0];
  // X's first tab is the page itself; another one names its timeline.
  const url = `https://x.com/i/trending/${id}${
    tab === undefined || tab === tabs[0] ? "" : `?timeline=${encodeURIComponent(tab.timelineId)}`
  }`;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this story's X page, on the tab picked.
  useEffect(() => void xGo(url), [url]);
  return (
    <Timeline
      surface={`explore:${tab?.timelineId ?? ""}`}
      header={<XTitle title="News" onBack={() => router.history.back()} />}
      top={
        story === undefined ? null : (
          <div data-x="story" className="border-b border-border">
            <div className="px-4 pt-3 pb-3">
              <h2 className="text-[23px] leading-7 font-extrabold">{story.title}</h2>
              {story.updatedAt === null ? null : (
                <p className="mt-1 text-[13px] text-[#71767b]">
                  Last updated {fmtWhen(story.updatedAt)}
                </p>
              )}
              {story.summary === "" ? null : (
                <p className="mt-3 text-[15px] leading-5 whitespace-pre-line">{story.summary}</p>
              )}
              {story.disclaimer === null ? null : (
                <p className="mt-3 text-[13px] text-[#71767b]">{story.disclaimer}</p>
              )}
            </div>
            {tabs.length > 1 && tab !== undefined ? (
              <XTabs
                label="Story"
                tabs={tabs.map((t) => ({ id: t.timelineId, label: t.label }))}
                value={tab.timelineId}
                onChange={(next) =>
                  void navigate({
                    to: "/trending/$id",
                    params: { id },
                    search: next === tabs[0]!.timelineId ? {} : { timeline: next },
                    replace: true,
                  })
                }
              />
            ) : null}
          </div>
        )
      }
      empty="Loading the story from X."
      onReopen={() => void xNavigate(url)}
    />
  );
}

export const Route = createFileRoute("/trending/$id")({
  validateSearch: (s: Record<string, unknown>): { timeline?: string } =>
    typeof s.timeline === "string" && s.timeline !== "" ? { timeline: s.timeline } : {},
  component: StoryScreen,
});
