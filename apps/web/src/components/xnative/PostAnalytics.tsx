import { useAtomValue } from "@effect/atom-react";

import { cn } from "../../lib/utils";
import { engineAtom } from "../../state/engine";
import { useOpenPost } from "./Timeline";
import { QuoteBox } from "./XPostView";
import { XEmpty } from "./XRows";

/** X's Post Analytics numbers, by X's metric name, in X's order and words. */
const METRICS = [
  ["Impressions", "Impressions"],
  ["Engagements", "Engagements"],
  ["DetailExpands", "Detail expands"],
  ["ProfileVisits", "Profile visits"],
  ["LinkClicks", "Link clicks"],
] as const;

/**
 * One of the user's own posts and X's Post Analytics for it, as X's page draws them: the post,
 * then Impressions large beside the other numbers.
 */
export function PostAnalytics({
  postId,
  onReopen,
}: {
  readonly postId: string;
  readonly onReopen: () => void;
}) {
  const engine = useAtomValue(engineAtom);
  const openPost = useOpenPost();
  const post = engine.posts.get(postId);
  const counted = engine.analytics.get(postId);
  return (
    <>
      {post === undefined ? null : (
        <div className="px-4 pt-3">
          <QuoteBox quoted={post} onOpen={openPost} />
        </div>
      )}
      {counted === undefined ? (
        <XEmpty key={postId} empty="Loading the post's analytics from X." onReopen={onReopen} />
      ) : (
        <dl data-x="analytics" className="grid grid-cols-3 gap-x-4 gap-y-5 px-4 py-4">
          {METRICS.map(([metric, label], i) => (
            <div key={metric} className={cn(i === 0 && "row-span-2")}>
              <dt className="text-[13px] text-[#71767b]">{label}</dt>
              <dd
                className={cn(
                  "font-bold tabular-nums",
                  i === 0 ? "text-[31px] leading-9" : "text-[20px] leading-7",
                )}
              >
                {(counted[metric] ?? 0).toLocaleString("en")}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
