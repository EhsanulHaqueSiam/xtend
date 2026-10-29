import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AnalyzeData } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { ReactNode } from "react";
import { TextMorph } from "torph/react";

import { analyzeDataAtom, refreshAnalyzeAtom } from "../../state/analyze";
import { useQuoteLabel } from "../../state/costs";
import { PageHeader } from "../PageHeader";
import { sectionLabel, useSection } from "../shell/sections";
import { Button } from "../ui/button";
import { Cost, Empty, Freshness, PageBody } from "../ui/layout";
import { FreeOnX, profileUrl } from "../ui/x-link";
import { ErrorBar, errorText, when } from "./ui";

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Paid: the profile and up to 100 own posts, which every Analyze section reads.
 * Its failure shows under the page header, wherever the button was pressed.
 */
export function RefreshPosts({ stale = false }: { readonly stale?: boolean }) {
  const refresh = useAtomSet(refreshAnalyzeAtom, { mode: "promise" });
  const state = useAtomValue(refreshAnalyzeAtom);
  const refreshData = useAtomRefresh(analyzeDataAtom);
  const quote = useQuoteLabel({ kind: "analyzeRefresh" });
  return (
    <Button
      size="sm"
      variant={stale ? "default" : "outline"}
      // Paid: off until the quote says what it costs.
      disabled={state.waiting || quote === "…"}
      // A failure lands in the atom, which the page header reads.
      onClick={() => void refresh().then(refreshData, () => {})}
    >
      <TextMorph duration={250}>{state.waiting ? "Refreshing" : "Refresh posts"}</TextMorph>
      <Cost label={quote} tone={stale ? "solid" : undefined} />
    </Button>
  );
}

/** Before the first refresh there is nothing to lay out: one line and the refresh. */
export function NotLoaded() {
  return (
    <Empty action={<RefreshPosts />}>
      No posts loaded yet. Refresh reads your profile and up to 100 posts.
    </Empty>
  );
}

/**
 * The frame of every Analyze section: its name, what the loaded posts are, the
 * refresh, and a scrolling body that is a size container for its tables.
 */
export function AnalyzePage({
  data,
  detail,
  tabs,
  actions,
  children,
}: {
  /** null until the service answers. */
  readonly data: AnalyzeData | null;
  /** Replaces the default "N posts · when" fact. */
  readonly detail?: ReactNode;
  readonly tabs?: ReactNode;
  /** The section's own actions, left of the refresh. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const section = useSection("/analyze");
  const refreshState = useAtomValue(refreshAnalyzeAtom);
  const hasHandle = data !== null && data.handle !== null;
  // A day without a fetch is the one state that asks for a paid refresh.
  const stale =
    data?.fetchedAt !== null &&
    data?.fetchedAt !== undefined &&
    Date.now() - new Date(data.fetchedAt).getTime() > STALE_MS;
  return (
    // The container sits above PageBody: on PageBody it would contain the section counter.
    <div className="@container flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/analyze", section)}
        tabs={tabs}
        detail={
          detail ??
          (data === null || data.handle === null ? undefined : (
            <Freshness
              state={
                refreshState.waiting
                  ? "refreshing"
                  : data.fetchedAt === null || stale
                    ? "stale"
                    : "fresh"
              }
            >
              {refreshState.waiting
                ? "refreshing"
                : data.fetchedAt === null
                  ? "not fetched yet"
                  : `fetched ${when(data.fetchedAt)} · ${data.posts.length} posts`}
            </Freshness>
          ))
        }
        actions={
          hasHandle ? (
            <>
              {actions}
              <FreeOnX href={profileUrl(data.handle)} label="Profile on X" />
              <RefreshPosts stale={data.fetchedAt === null || stale} />
            </>
          ) : undefined
        }
      />
      <ErrorBar>
        {AsyncResult.isFailure(refreshState) ? errorText(refreshState.cause) : null}
      </ErrorBar>
      <PageBody>{children}</PageBody>
    </div>
  );
}
