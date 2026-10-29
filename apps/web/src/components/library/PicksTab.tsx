import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Pick, StaffPick, XPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useQuoteLabel, useRates } from "../../state/costs";
import { settingsAtom } from "../../state/settings";
import {
  fetchPicksAtom,
  fetchStaffPicksAtom,
  generateReadyAtom,
  pickDraftAtom,
  pickWhyAtom,
  picksAtom,
  staffPicksAtom,
} from "../../state/library";
import { PageHeader } from "../PageHeader";
import { TREND_COUNTRIES } from "../scores/Trending";
import { Cost, Empty, Section } from "../ui/layout";
import { DetailSplit } from "../ui/split";
import { profileUrl, XLink } from "../ui/x-link";
import { xPill, xPillSm } from "../x";
import {
  FormatTabs,
  SearchXField,
  SortMenu,
  formatCounts,
  matchesFormat,
  sortItems,
  type FormatFilter,
  type SortKey,
} from "./controls";
import { PostGrid } from "./PostCard";
import { DraftChoice } from "./DraftChoice";
import { InspectorGroup, PostInspector } from "./PostInspector";
import { RemixButton, SaveButton, useSavedIds } from "./SaveButton";
import { AppLink, ErrorLine, causeMessage, errorMessage } from "./shared";

const button = cn(xPill, xPillSm);

/** A staff pick whose text has arrived. */
type FetchedStaffPick = StaffPick & { readonly post: XPost };
const isFetched = (p: StaffPick): p is FetchedStaffPick => p.post !== null;

/** The paid runs behind the day's picks: the keyword fetch and the three ready posts. */
function useRuns() {
  const refresh = useAtomRefresh(picksAtom);
  const fetch = useAtomSet(fetchPicksAtom, { mode: "promise" });
  const generate = useAtomSet(generateReadyAtom, { mode: "promise" });
  const picksQuote = useQuoteLabel({ kind: "picksFetch" });
  const trendingQuote = useQuoteLabel({ kind: "trending", country: TREND_COUNTRIES[0] });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const [busy, setBusy] = useState<"picks" | "ready" | null>(null);
  const [notice, setNotice] = useState<{ readonly text: string; readonly error: boolean } | null>(
    null,
  );

  const call = async (which: "picks" | "ready", work: () => Promise<string | null>) => {
    setBusy(which);
    setNotice(null);
    try {
      const text = await work();
      setNotice(text === null ? null : { text, error: false });
    } catch (e) {
      setNotice({ text: errorMessage(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const fetchButton = (pending: number, disabled: boolean) => (
    <button
      type="button"
      className={button}
      disabled={busy !== null || disabled}
      onClick={() =>
        void call("picks", async () => {
          await fetch();
          refresh();
          return null;
        })
      }
    >
      {busy === "picks" ? "Fetching" : `Fetch ${pending} keyword${pending === 1 ? "" : "s"}`}
      <Cost label={picksQuote} />
    </button>
  );
  const readyButton = (
    <button
      type="button"
      className={button}
      disabled={busy !== null}
      title="Three posts for today in your voice, from your for-you topics and the picks. Filed as suggested drafts."
      onClick={() =>
        void call("ready", async () => {
          const posts = await generate(TREND_COUNTRIES[0]);
          return `${posts.length} suggested drafts in Compose: ${posts.map((p) => `${p.basis} (voice ${p.voiceMatch})`).join(", ")}.`;
        })
      }
    >
      {busy === "ready" ? "Writing" : "Write 3 ready posts"}
      {/* One model call writes all three; country trends are read only before any topic exists. */}
      <Cost label={`${trendingQuote} + ${assistQuote}`} />
    </button>
  );
  return { fetchButton, readyButton, notice };
}

/** The selected pick: why it works and a ready-to-post version, both model calls. */
function PickInspector({
  pick,
  saved,
  onClose,
}: {
  readonly pick: Pick;
  readonly saved: boolean;
  readonly onClose: () => void;
}) {
  const why = useAtomSet(pickWhyAtom(pick.post.postId), { mode: "promise" });
  const draft = useAtomSet(pickDraftAtom(pick.post.postId), { mode: "promise" });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const [whyText, setWhyText] = useState(pick.whyItWorks);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"why" | null>(null);

  const call = async (which: "why", work: () => Promise<void>) => {
    setBusy(which);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PostInspector post={pick.post} facts={[["Keyword", pick.keyword]]} onClose={onClose}>
      <InspectorGroup title="Act">
        <div className="flex flex-wrap items-center gap-1.5">
          <SaveButton post={pick.post} saved={saved} />
          <RemixButton post={pick.post} />
        </div>
      </InspectorGroup>
      <InspectorGroup
        title="Why it works"
        aside={whyText === null ? <Cost label={assistQuote} /> : undefined}
      >
        {whyText !== null ? (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/80">
            {whyText}
          </p>
        ) : (
          <button
            type="button"
            className={button}
            disabled={busy !== null}
            onClick={() => void call("why", async () => setWhyText(await why()))}
          >
            {busy === "why" ? "Explaining" : "Explain it"}
          </button>
        )}
      </InspectorGroup>
      <DraftChoice
        title="Ready to post"
        source={`pick:${pick.post.postId}`}
        write={(tone) => draft(tone).then((options) => options.map((o) => o.join("\n\n")))}
      />
      {error !== null ? <ErrorLine className="px-5 pt-3 pb-0">{error}</ErrorLine> : null}
    </PostInspector>
  );
}

/** The curated evergreen posts; text arrives with one `from:handle` search per author. */
function StaffPicks({
  picks,
  shown,
  selected,
  onSelect,
}: {
  readonly picks: ReadonlyArray<StaffPick>;
  readonly shown: ReadonlyArray<FetchedStaffPick>;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
}) {
  const refresh = useAtomRefresh(staffPicksAtom);
  const fetch = useAtomSet(fetchStaffPicksAtom, { mode: "promise" });
  const rates = useRates();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unfetched = picks.filter((p) => p.post === null);
  const authors = new Set(unfetched.map((p) => p.handle)).size;
  if (picks.length === 0) return null;
  return (
    <Section
      title="Staff picks"
      className="border-t"
      aside={
        authors > 0 ? (
          <button
            type="button"
            className={button}
            disabled={busy || rates === null}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await fetch();
                refresh();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Fetching" : `Fetch text for ${authors} authors`}
            {rates === null ? <Cost label="…" /> : <Cost usd={rates.searchPage * authors} />}
          </button>
        ) : undefined
      }
    >
      {error !== null ? <ErrorLine className="px-0">{error}</ErrorLine> : null}
      {shown.length > 0 ? (
        <PostGrid
          className="px-0 py-0"
          items={shown.map((p) => ({ key: `staff:${p.postId}`, post: p.post, tag: p.topic }))}
          selected={selected}
          onSelect={onSelect}
        />
      ) : null}
      {unfetched.length > 0 ? (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{unfetched.length} posts wait for their text, by</span>
          {[...new Set(unfetched.map((p) => p.handle))].map((handle) => (
            <XLink
              key={handle}
              href={profileUrl(handle)}
              className="font-mono text-2xs transition-colors duration-150 hover:text-foreground"
            >
              @{handle}
            </XLink>
          ))}
        </p>
      ) : null}
    </Section>
  );
}

/** Today's top posts for the user's keywords, and the staff picks under them. */

/** Today's picks are in; the morning run is named only when it is turned on in Settings. */
function FetchedLabel() {
  const daily = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(settingsAtom), (v) => v.dailyLibraryJobs),
    () => false,
  );
  return (
    <span className="font-mono text-2xs text-muted-foreground">
      {daily ? "fetched · daily 08:00" : "fetched today"}
    </span>
  );
}
export function PicksTab() {
  const state = useAtomValue(picksAtom);
  const staff = useAtomValue(staffPicksAtom);
  const saved = useSavedIds();
  const runs = useRuns();
  const [format, setFormat] = useState<FormatFilter>("all");
  const [sort, setSort] = useState<SortKey>("views");
  const [selected, setSelected] = useState<string | null>(null);

  const value = AsyncResult.getOrElse(state, () => null);
  const picks = value?.picks ?? [];
  const staffPicks = AsyncResult.getOrElse(staff, (): ReadonlyArray<StaffPick> => []);
  const fetchedStaff = staffPicks.filter(isFetched);
  const shownPicks = sortItems(
    picks.filter((p) => matchesFormat(p.post, format)),
    (p) => p.post,
    sort,
  );
  const shownStaff = sortItems(
    fetchedStaff.filter((p) => matchesFormat(p.post, format)),
    (p) => p.post,
    sort,
  );

  const close = () => setSelected(null);
  const pick = picks.find((p) => `pick:${p.post.postId}` === selected);
  const staffPick = fetchedStaff.find((p) => `staff:${p.postId}` === selected);
  const detail =
    pick !== undefined ? (
      <PickInspector
        key={pick.post.postId}
        pick={pick}
        saved={saved.has(pick.post.postId)}
        onClose={close}
      />
    ) : staffPick !== undefined ? (
      <PostInspector post={staffPick.post} facts={[["Topic", staffPick.topic]]} onClose={close}>
        <InspectorGroup title="Act">
          <div className="flex flex-wrap items-center gap-1.5">
            <SaveButton post={staffPick.post} saved={saved.has(staffPick.postId)} />
            <RemixButton post={staffPick.post} />
          </div>
        </InspectorGroup>
      </PostInspector>
    ) : null;

  return (
    <>
      <PageHeader
        title="Picks"
        tabs={
          <FormatTabs
            value={format}
            onChange={setFormat}
            counts={formatCounts([...picks.map((p) => p.post), ...fetchedStaff.map((p) => p.post)])}
          />
        }
        actions={
          <>
            <SortMenu value={sort} onChange={setSort} />
            <SearchXField />
          </>
        }
      />
      <DetailSplit
        closable
        label="Selected post"
        detailKey={selected}
        detail={detail}
        list={
          <>
            {AsyncResult.match(state, {
              onInitial: () => <Empty>Loading picks</Empty>,
              onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
              onSuccess: ({ value: day }) =>
                day.picks.length === 0 ? (
                  day.keywords.length === 0 ? (
                    <Empty
                      action={
                        <AppLink href="/settings" className={button}>
                          Set keywords
                        </AppLink>
                      }
                    >
                      Picks are the top posts of the week for your keywords.
                    </Empty>
                  ) : (
                    <Empty
                      action={
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {day.pending.length > 0
                            ? runs.fetchButton(day.pending.length, false)
                            : null}
                          {runs.readyButton}
                        </div>
                      }
                    >
                      No picks yet today for {day.keywords.join(", ")}.
                    </Empty>
                  )
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pt-4">
                      <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        <span className="font-mono text-2xs tabular-nums">{day.day}</span>
                        <span className="px-2 text-white/20">/</span>
                        {day.keywords.length === 0 ? (
                          <AppLink href="/settings" className="hover:text-foreground">
                            no keywords set
                          </AppLink>
                        ) : (
                          <span className="text-foreground/80">{day.keywords.join(", ")}</span>
                        )}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {runs.readyButton}
                        {day.pending.length > 0 ? (
                          runs.fetchButton(day.pending.length, false)
                        ) : day.keywords.length > 0 ? (
                          <FetchedLabel />
                        ) : null}
                      </div>
                    </div>
                    {shownPicks.length === 0 ? (
                      <Empty>No {format === "link" ? "link" : format} picks today.</Empty>
                    ) : (
                      <PostGrid
                        items={shownPicks.map((p) => ({
                          key: `pick:${p.post.postId}`,
                          post: p.post,
                          tag: p.keyword,
                        }))}
                        selected={selected}
                        onSelect={setSelected}
                      />
                    )}
                  </>
                ),
            })}
            {runs.notice !== null ? (
              <p
                className={cn(
                  "px-6 pb-4 text-xs",
                  runs.notice.error ? "text-error-foreground" : "text-muted-foreground",
                )}
              >
                {runs.notice.text}
              </p>
            ) : null}
            <StaffPicks
              picks={staffPicks}
              shown={shownStaff}
              selected={selected}
              onSelect={setSelected}
            />
          </>
        }
      />
    </>
  );
}
