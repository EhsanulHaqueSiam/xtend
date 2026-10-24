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
import { Cost, Empty, PageBody } from "../ui/layout";
import { ErrorBar, errorText, when } from "./ui";

/**
 * Paid: the profile and up to 100 own posts, which every Analyze section reads.
 * Its failure shows under the page header, wherever the button was pressed.
 */
export function RefreshPosts() {
  const refresh = useAtomSet(refreshAnalyzeAtom, { mode: "promise" });
  const state = useAtomValue(refreshAnalyzeAtom);
  const refreshData = useAtomRefresh(analyzeDataAtom);
  const quote = useQuoteLabel({ kind: "analyzeRefresh" });
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={state.waiting}
      // A failure lands in the atom, which the page header reads.
      onClick={() => void refresh().then(refreshData, () => {})}
    >
      <TextMorph duration={250}>{state.waiting ? "Refreshing" : "Refresh posts"}</TextMorph>
      <Cost label={quote} />
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
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/analyze", section)}
        tabs={tabs}
        detail={
          detail ??
          (data === null || data.handle === null
            ? undefined
            : data.fetchedAt === null
              ? "not refreshed yet"
              : `${data.posts.length} posts · ${when(data.fetchedAt)}`)
        }
        actions={
          hasHandle ? (
            <>
              {actions}
              <RefreshPosts />
            </>
          ) : undefined
        }
      />
      <ErrorBar>
        {AsyncResult.isFailure(refreshState) ? errorText(refreshState.cause) : null}
      </ErrorBar>
      <PageBody className="@container">{children}</PageBody>
    </div>
  );
}
