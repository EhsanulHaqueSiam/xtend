import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { ReactNode } from "react";

import { nextSlotLabel } from "../../lib/glance";
import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { analyzeDataAtom } from "../../state/analyze";
import { pendingAtom } from "../../state/automate";
import { usd } from "../../state/costs";
import { draftsAtom } from "../../state/compose";
import { inboxItemsAtom } from "../../state/engage";
import { picksAtom } from "../../state/library";
import { slotsAtom } from "../../state/plan";
import { settingsAtom } from "../../state/settings";
import { spendLiveAtom } from "../../state/shell";
import { fmt, pct } from "../analyze/ui";
import { draftTitle } from "../compose/DraftsList";
import { ago } from "../engage/triage";
import { PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Button } from "../ui/button";
import { PageBody, Section, Stat, statRow } from "../ui/layout";

const or = <A, B>(result: AsyncResult.AsyncResult<A, unknown>, fallback: B): A | B =>
  AsyncResult.getOrElse(result, () => fallback);

/** One line in a Today group; the whole row opens the item in the tool that owns it. */
function Row({
  href,
  title,
  meta,
  aside,
}: {
  readonly href: string;
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly aside?: ReactNode;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <a
      href={router.history.createHref(href)}
      className="flex items-center gap-3 border-t border-border py-2.5 outline-hidden transition-colors duration-150 first:border-t-0 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate({ href });
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      {aside === undefined ? null : (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
          {aside}
        </span>
      )}
    </a>
  );
}

/** What a group shows with nothing in it: one quiet line, no sketch; the page is a summary. */
const Quiet = ({ children }: { readonly children: ReactNode }) => (
  <p className="py-2 text-[13px] text-muted-foreground">{children}</p>
);

/**
 * The day at a glance, from free reads only: what waits on you, what goes out
 * next, who talked to you, what to learn from, and how the week went. Every row
 * opens its tool; nothing here acts or spends.
 */
export function Today() {
  const navigate = useNavigate();
  const drafts = or(useAtomValue(draftsAtom), []);
  const pending = or(useAtomValue(pendingAtom), []).filter((p) => p.status === "pending");
  const inbox = or(useAtomValue(inboxItemsAtom), null);
  const picks = or(useAtomValue(picksAtom), null);
  const slots = or(useAtomValue(slotsAtom), []);
  const settings = or(useAtomValue(settingsAtom), null);
  const spend = or(useAtomValue(spendLiveAtom), null);
  const analyze = or(useAtomValue(analyzeDataAtom), null);
  const zone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const failed = drafts.filter((d) => d.status === "failed");
  const queued = drafts
    .filter((d) => d.status === "queued")
    .toSorted((a, b) => (a.scheduledAt ?? "~").localeCompare(b.scheduledAt ?? "~"));
  const open = inbox?.items.filter((m) => !m.handled) ?? [];
  const week = analyze?.windows.find((w) => w.days === 7);
  const followers = analyze?.snapshots.at(-1)?.followers ?? null;
  const nextSlot = nextSlotLabel(slots, zone, new Date());
  const waiting = pending.length + failed.length;
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Today"
        actions={
          <Button size="sm" onClick={() => void navigate({ href: "/compose?new=1" })}>
            New draft
          </Button>
        }
      />
      <PageBody className="@container">
        <Section>
          <div className={cn(statRow, "grid-cols-2 gap-y-4 @3xl:grid-cols-4")}>
            <Stat label="Views, 7 days" value={fmt(week?.views)} />
            <Stat
              label="Engagement, 7 days"
              value={week === undefined || week.views === 0 ? "–" : pct(week.engagementRate)}
            />
            <Stat label="Followers" value={fmt(followers)} />
            <Stat
              label={spend === null ? "Spend" : `Spend of ${usd(spend.monthlyBudgetUsd)}`}
              value={spend === null ? "–" : usd(spend.monthUsd)}
            />
          </div>
        </Section>
        <div className="mx-6 grid gap-x-3 @4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <Section
              className="mx-0"
              title="Needs you"
              description={waiting === 0 ? undefined : `${waiting} waiting`}
            >
              {waiting === 0 ? <Quiet>Nothing waits on you.</Quiet> : null}
              {failed.map((d) => (
                <Row
                  key={d.id}
                  href={`/compose?draft=${d.id}`}
                  title={
                    <>
                      <span className="text-error-foreground">Failed </span>
                      {draftTitle(d)}
                    </>
                  }
                  meta={d.error ?? "Did not post"}
                />
              ))}
              {pending.map((p) => (
                <Row
                  key={p.id}
                  href={sectionHref("/automate", "needs-you")}
                  title={p.description}
                  meta={`Rule ${p.ruleName} · approve in Automate`}
                  aside={usd(p.costUsd)}
                />
              ))}
            </Section>
            <Section
              className="mx-0"
              title="Inbox"
              description={open.length === 0 ? undefined : `${open.length} open`}
            >
              {open.length === 0 ? <Quiet>All handled.</Quiet> : null}
              {open.slice(0, 5).map((m) => (
                <Row
                  key={m.post.postId}
                  href={sectionHref("/engage", "inbox")}
                  title={
                    <>
                      <span className="font-medium">{m.post.author.name}</span>{" "}
                      <span className="text-muted-foreground">@{m.post.author.handle}</span>
                    </>
                  }
                  meta={m.post.text}
                  aside={ago(m.post.createdAt)}
                />
              ))}
            </Section>
          </div>
          <div>
            <Section className="mx-0" title="Next up">
              {queued.length === 0 ? (
                <Quiet>
                  Nothing queued.{nextSlot === null ? "" : ` Next open slot ${nextSlot}.`}
                </Quiet>
              ) : null}
              {queued.slice(0, 4).map((d) => (
                <Row
                  key={d.id}
                  href={`/compose?draft=${d.id}`}
                  title={draftTitle(d)}
                  meta={d.scheduledAt === null ? "Next free slot" : fmtWhen(d.scheduledAt)}
                />
              ))}
            </Section>
            <Section className="mx-0" title="Picks today">
              {picks === null || picks.picks.length === 0 ? (
                <Quiet>None fetched today.</Quiet>
              ) : null}
              {picks?.picks.slice(0, 3).map((p) => (
                <Row
                  key={p.post.postId}
                  href={sectionHref("/library", "picks")}
                  title={p.post.text}
                  meta={`@${p.post.author.handle} · ${p.keyword}`}
                  aside={fmt(p.post.metrics.views)}
                />
              ))}
            </Section>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
