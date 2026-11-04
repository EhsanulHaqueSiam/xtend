import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import type { EngineJoinRequest, EngineReportCase } from "@xtend/contracts";
import { useEffect, useRef } from "react";

import { CaseRow, queuePage, RequestRow } from "../components/xnative/CommunityQueues";
import { CommunityToolList, useAdminPage } from "../components/xnative/CommunityTools";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XEmpty, XRows } from "../components/xnative/XRows";
import { engineAtom, forgetQueues, moderates, roleIn, updateEngine } from "../state/engine";
import { xGo, xNavigate, xScrollMore } from "../state/x";

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
 * A Community's queues from X's own pages for them, each row's buttons X's own, rows virtualized
 * and paged by X. Review all is both, newest first; a press or a next page moves the engine to
 * that queue's page first. Anyone but its mods gets X's not-found page, in X and in Xtend.
 */
function QueueScreen({ id, queue }: { readonly id: string; readonly queue: Queue }) {
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const admin = engine.communityAdmin.get(id);
  const takesRequests = admin?.requests !== null;
  const requests = engine.joinRequests.get(id);
  const cases = engine.reportCases.get(id);
  const requestsPage = queuePage(id, "member_requests");
  const reportedPage = queuePage(id, "reported_tweets");
  const setEngine = useAtomSet(engineAtom);
  const loadFirst = useAdminPage(
    queue === "reported_tweets" || (queue === "review" && !takesRequests)
      ? reportedPage
      : requestsPage,
  );
  // Review all reads X's Reported posts once X has listed the requests (or takes none); after a
  // reload, afresh, so X lists both anew.
  const listed = requests !== undefined || !takesRequests;
  const afresh = useRef(false);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) on to X's second queue page once the first answered.
  useEffect(() => {
    if (queue !== "review" || !listed) return;
    const url = `https://x.com${reportedPage}`;
    void (afresh.current ? xNavigate(url) : xGo(url));
    afresh.current = false;
  }, [queue, listed, reportedPage]);
  /** ⌘R: X's pages in full again, the queues forgotten until X lists them anew. */
  const reload = () => {
    setEngine(updateEngine((s) => forgetQueues(s, id)));
    afresh.current = queue === "review" && takesRequests;
    loadFirst();
  };
  const more = (kind: "request" | "post") => engine.queueMore.get(`${kind}:${id}`) === true;
  const paged =
    queue === "member_requests"
      ? more("request")
      : queue === "reported_tweets"
        ? more("post")
        : more("request") || more("post");
  /**
   * Review all's next page, from the queue whose loaded rows end newest: its next ones may come
   * before the other's last. The engine moves to that queue's page and scrolls it, as X pages.
   */
  const loadMore = async (signal: AbortSignal) => {
    const tail = (list: ReadonlyArray<{ readonly at: string | null }> | undefined) =>
      Date.parse(list?.at(-1)?.at ?? "") || 0;
    const page =
      more("request") && (!more("post") || tail(requests) >= tail(cases))
        ? requestsPage
        : reportedPage;
    await xGo(`https://x.com${page}`);
    return signal.aborted ? null : xScrollMore(signal);
  };
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
        <XRows
          waitKey={`${id}:${queue}`}
          items={shown}
          rowKey={(item) =>
            item.kind === "request" ? `r${item.request.userId}` : `c${item.kase.postId}`
          }
          row={(item) =>
            item.kind === "request" ? (
              <RequestRow communityId={id} request={item.request} />
            ) : (
              <CaseRow communityId={id} kase={item.kase} />
            )
          }
          empty={`Loading ${QUEUES[queue]} from X.`}
          onReopen={reload}
          paged={paged}
          more={queue === "review" ? loadMore : xScrollMore}
        />
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
