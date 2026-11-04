import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EngineJoinRequest, EngineReportCase, EngineUser } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Check, EyeOff } from "lucide-react";
import { useState } from "react";

import { decide, decisionKey, engineAtom, requestState, updateEngine } from "../../state/engine";
import { leadAtom } from "../../state/leads";
import { reportAtom } from "../../state/scores";
import { xOverAtom, xPressRow } from "../../state/x";
import { fmt } from "../analyze/ui";
import { StageText } from "../leads/ui";
import { xtendRoute } from "./RichText";
import { useXPress } from "./useXPress";
import { Avatar, XPostView } from "./XPostView";

/** X's two queue pages for a Community, where each row's buttons are X's own. */
export const queuePage = (communityId: string, queue: "member_requests" | "reported_tweets") =>
  `/i/communities/${communityId}/moderation/${queue}`;

const OUTLINED =
  "h-8 flex-1 cursor-pointer rounded-full border border-white/[0.35] px-4 text-[14px] font-bold transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-60";

/**
 * Presses X's own button in one row of a queue for the user's click, one press at a time; X's
 * flow (Hide's and Ban's rule picker) shows over the main area. When X draws its decision in the
 * row's place, Xtend keeps it (`decided`).
 */
function useRowPress() {
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const setEngine = useAtomSet(engineAtom);
  const [pending, setPending] = useState(false);
  const press = async (
    row: { readonly page: string; readonly within: string; readonly key: string },
    label: string,
    decision: string,
  ) => {
    if (pending) return;
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    setPending(true);
    try {
      const done = await xPressRow(
        row.page,
        row.within,
        label,
        (href) => xtendRoute(href) !== null,
        setOver,
      );
      if (done === false)
        return setToast({
          text: `X is not showing ${label} on this row now. Try again in a moment.`,
        });
      if (done?.gone) setEngine(updateEngine((s) => decide(s, row.key, decision)));
    } finally {
      setPending(false);
    }
  };
  return { pending, press };
}

/** How long they have been on X: "since 2019", or "3 weeks old" for a new account. */
const age = (joinedAt: string | null, now: number) => {
  if (joinedAt === null) return null;
  const days = (now - Date.parse(joinedAt)) / 86_400_000;
  if (!Number.isFinite(days)) return null;
  return days >= 365
    ? `since ${new Date(joinedAt).getUTCFullYear()}`
    : days >= 60
      ? `${Math.floor(days / 30)} months old`
      : `${Math.max(1, Math.floor(days / 7))} weeks old`;
};

/**
 * Xtend's line under a person in a queue, from what the account already holds: their Scores
 * score or Leads score, followers, account age and Leads stage. Free: stored, nothing fetched.
 */
function XtendLine({ user }: { readonly user: EngineUser }) {
  const lead = AsyncResult.getOrElse(useAtomValue(leadAtom(user.handle)), () => null);
  const report = AsyncResult.getOrElse(useAtomValue(reportAtom(user.handle)), () => null);
  const [now] = useState(() => Date.now());
  const score = report?.latest?.score ?? lead?.score ?? null;
  const parts = [
    score === null ? null : `score ${Math.round(score)}`,
    user.followers === null ? null : `${fmt(user.followers)} followers`,
    age(user.joinedAt, now),
  ].filter((p) => p !== null);
  return (
    <p data-x="xtend-line" className="mt-1 font-mono text-[12px] text-[#71767b]">
      {parts.join(" · ")}
      {lead === null ? null : (
        <>
          {parts.length > 0 ? " · " : null}Lead · <StageText stage={lead.stage} />
        </>
      )}
    </p>
  );
}

/** X's line in a decided row's place: what X says after its Approve, Deny, Keep or Hide. */
function Decided({ icon, text }: { readonly icon: "check" | "hidden"; readonly text: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-[15px]">
      {icon === "check" ? (
        <Check className="size-5 text-[#71767b]" />
      ) : (
        <EyeOff className="size-5 text-[#71767b]" />
      )}
      {text}
    </div>
  );
}

/**
 * A request to join as X's Member requests draws it: the person, X's line on how you follow each
 * other, X's warning for someone blocked or muted, their answer, Xtend's line, then X's Approve
 * and Deny, each X's own button. Once X decided, X's words in its place.
 */
export function RequestRow({
  communityId,
  request,
}: {
  readonly communityId: string;
  readonly request: EngineJoinRequest;
}) {
  const engine = useAtomValue(engineAtom);
  const { pending, press } = useRowPress();
  const user = engine.users.get(request.userId);
  if (user === undefined) return null;
  const state = requestState(engine, communityId, request);
  if (state === "Approved")
    return (
      <Decided
        icon="check"
        text={`@${user.handle} was approved and is now a member of your Community`}
      />
    );
  if (state === "Denied")
    return (
      <Decided icon="hidden" text={`@${user.handle} was denied and can’t join your Community`} />
    );
  if (state !== "Pending") return null;
  const row = {
    page: queuePage(communityId, "member_requests"),
    within: `a[href="/${user.handle}"]`,
    key: decisionKey({ communityId, userId: request.userId }),
  };
  const context =
    user.youFollow && user.followsYou
      ? "You follow each other"
      : user.youFollow
        ? "Following"
        : user.followsYou
          ? "Follows you"
          : null;
  return (
    <div data-x="join-request" className="flex gap-3 border-b border-border px-4 py-3">
      <Avatar url={user.avatarUrl} size={40} />
      <div className="min-w-0 flex-1 text-[15px] leading-5">
        {context === null ? null : <p className="text-[13px] text-[#71767b]">{context}</p>}
        <p className="truncate">
          <b className="font-bold">{user.name}</b>{" "}
          <span className="text-[#71767b]">
            @{user.handle}
            {request.at === null
              ? null
              : ` · ${new Date(request.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          </span>
        </p>
        {user.bio === "" ? null : <p className="mt-0.5">{user.bio}</p>}
        <XtendLine user={user} />
        {request.blocking || request.muting ? (
          <p className="mt-3 text-[#f4212e]">
            {request.blocking
              ? "You’ve blocked this person. If their membership is approved, you’ll need to unblock them to see their posts."
              : "You’ve muted this person. If their membership is approved, you’ll need to unmute them to see their posts."}
          </p>
        ) : null}
        {request.answer === null ? null : (
          <p className="mt-2 border-l-2 border-white/[0.18] pl-3">{request.answer}</p>
        )}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled={pending}
            className={OUTLINED}
            onClick={() => void press(row, "Approve", "Approved")}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            className={`${OUTLINED} text-[#f4212e]`}
            onClick={() => void press(row, "Deny", "Denied")}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

/** X's line over a reported post: who reported it, X itself among them. */
const reportedBy = (c: EngineReportCase) => {
  const members = c.byX ? Math.max(0, c.reports - 1) : c.reports;
  const people = `${fmt(members)} member${members === 1 ? "" : "s"}`;
  return c.byX
    ? members > 0
      ? `Reported by @X and ${people}`
      : "Reported by @X"
    : `Reported by ${people}`;
};

/**
 * A reported post as X's Reported posts draws it: who reported it and the rule each named, the
 * post, then X's Keep, Hide and Ban. Keep is X's write at the press; Hide and Ban open X's own
 * rule picker over the main area. Once X decided, X's words in its place.
 */
export function CaseRow({
  communityId,
  kase,
}: {
  readonly communityId: string;
  readonly kase: EngineReportCase;
}) {
  const engine = useAtomValue(engineAtom);
  const { pending, press } = useRowPress();
  const post = engine.posts.get(kase.postId);
  if (post === undefined) return null;
  const decision = engine.decided.get(decisionKey(kase.postId));
  const handle = post.author.handle;
  if (decision === "Kept") return <Decided icon="check" text={`You kept @${handle}’s post`} />;
  if (decision === "Hidden") return <Decided icon="hidden" text={`You hid @${handle}’s post`} />;
  // X takes a banned author's post off the queue.
  if (decision === "Banned") return null;
  const row = {
    page: queuePage(communityId, "reported_tweets"),
    // The post's own timestamp link; a post quoting it links to it with none.
    within: `a[href$="/status/${kase.postId}"] time`,
    key: decisionKey(kase.postId),
  };
  return (
    <div data-x="report-case" className="border-b border-border">
      <div className="px-4 pt-3 text-[13px] text-[#71767b]">
        <span className="text-[#1d9bf0]">{reportedBy(kase)}</span>
        {kase.rules.length === 0 ? null : ` · ${[...new Set(kase.rules)].join(", ")}`}
      </div>
      <XPostView
        post={post}
        quoted={post.quotedId === null ? undefined : engine.posts.get(post.quotedId)}
      />
      <div className="flex gap-3 px-4 pb-3">
        {(
          [
            ["Keep", "Kept"],
            ["Hide", "Hidden"],
            ["Ban", "Banned"],
          ] as const
        ).map(([label, decided]) => (
          <button
            key={label}
            type="button"
            disabled={pending}
            className={OUTLINED}
            onClick={() => void press(row, label, decided)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
