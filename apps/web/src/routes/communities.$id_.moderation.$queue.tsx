import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import type { EngineJoinRequest, EngineReportCase } from "@xtend/contracts";
import { useEffect } from "react";

import { CaseRow, queuePage, RequestRow } from "../components/xnative/CommunityQueues";
import { CommunityToolList, useAdminPage } from "../components/xnative/CommunityTools";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XEmpty } from "../components/xnative/XRows";
import { engineAtom, moderates, roleIn } from "../state/engine";
import { xGo } from "../state/x";

const QUEUES = {
  member_requests: "Member requests",
  reported_tweets: "Reported posts",
  review: "Review all",
} as const;
type Queue = keyof typeof QUEUES;

const Message = ({ title, text }: { readonly title: string; readonly text: string }) => (
  <div className="px-8 py-10">
    <p className="text-[31px] leading-9 font-extrabold">{title}</p>
    <p className="mt-2 text-[15px] text-[#71767b]">{text}</p>
  </div>
);

type Item =
  | { readonly kind: "request"; readonly at: string | null; readonly request: EngineJoinRequest }
  | { readonly kind: "case"; readonly at: string | null; readonly kase: EngineReportCase };

/**
 * A Community's queues, drawn by Xtend from the engine on X's own pages for them: Member requests
 * and Reported posts, each row's buttons X's own, X's Admin tools in the rail. Review all is both
 * in one list, newest first: the engine reads each of X's pages, and a press moves it to the row's
 * own page first. X shows anyone but its mods its not-found page; so does Xtend.
 */
function QueueScreen({ id, queue }: { readonly id: string; readonly queue: Queue }) {
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const admin = engine.communityAdmin.get(id);
  const takesRequests = admin?.requests !== null;
  const requests = engine.joinRequests.get(id);
  const cases = engine.reportCases.get(id);
  const reload = useAdminPage(
    queue === "reported_tweets" || (queue === "review" && !takesRequests)
      ? queuePage(id, "reported_tweets")
      : queuePage(id, "member_requests"),
  );
  // Review all reads X's Reported posts once X has listed the requests (or takes none).
  const listed = requests !== undefined || !takesRequests;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) on to X's second queue page once the first answered.
  useEffect(() => {
    if (queue === "review" && listed) void xGo(`https://x.com${queuePage(id, "reported_tweets")}`);
  }, [queue, listed, id]);
  const role = roleIn(engine, id);
  const items: ReadonlyArray<Item> = [
    ...(queue === "reported_tweets" || !takesRequests ? [] : (requests ?? [])).map((request) => ({
      kind: "request" as const,
      at: request.at,
      request,
    })),
    ...(queue === "member_requests" ? [] : (cases ?? [])).map((kase) => ({
      kind: "case" as const,
      at: kase.at,
      kase,
    })),
  ];
  // Newest first across both of X's lists; each list keeps X's own order.
  const shown =
    queue === "review"
      ? [...items].sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0)
      : items;
  const answered =
    queue === "member_requests"
      ? requests !== undefined
      : queue === "reported_tweets"
        ? cases !== undefined
        : listed && cases !== undefined;
  return (
    <XColumn
      header={
        <XTitle
          title={QUEUES[queue]}
          detail={engine.communities.get(id)?.name}
          onBack={() => router.history.back()}
        />
      }
      rail={
        moderates(role) ? <CommunityToolList communityId={id} current={queue} rail /> : undefined
      }
      refresh={{ surfaces: [], load: reload }}
    >
      {role !== null && !moderates(role) ? (
        <Message title="Hmm...this page doesn’t exist." text="Try searching for something else." />
      ) : shown.length > 0 ? (
        shown.map((item) =>
          item.kind === "request" ? (
            <RequestRow key={`r${item.request.userId}`} communityId={id} request={item.request} />
          ) : (
            <CaseRow key={`c${item.kase.postId}`} communityId={id} kase={item.kase} />
          ),
        )
      ) : !answered ? (
        <XEmpty empty={`Loading ${QUEUES[queue]} from X.`} onReopen={reload} />
      ) : queue === "member_requests" ? (
        <Message
          title="No new membership requests"
          text="You’re all caught up. When new requests come in, you’ll see them here."
        />
      ) : (
        <Message
          title="Nothing to review right now"
          text="Moderators have taken care of all reported posts."
        />
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/communities/$id_/moderation/$queue")({
  params: {
    parse: ({ id, queue }) => {
      if (!(queue in QUEUES)) throw notFound();
      return { id, queue: queue as Queue };
    },
    stringify: ({ id, queue }) => ({ id, queue }),
  },
  // One screen per queue: each moves the engine to its own X page as it opens.
  component: function Queue() {
    const { id, queue } = Route.useParams();
    return <QueueScreen key={`${id}:${queue}`} id={id} queue={queue} />;
  },
});
