import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { NewFollower } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { useQuoteLabel, usd } from "../../state/costs";
import { addPersonAtom, newFollowersAtom, peopleAtom } from "../../state/leads";
import { settingsAtom } from "../../state/settings";
import { errorText, fmt } from "./ui";
import { ErrorLine, pill, pillSolid } from "../engage/triage";
import { PageHeader } from "../PageHeader";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import { NoHandle } from "../ui/no-handle";
import {
  type Column,
  DetailSplit,
  ListHead,
  ListRow,
  Props,
  RowText,
  RowTitle,
  useSelection,
} from "../ui/split";
import { OpenOnX, profileUrl } from "../ui/x-link";
import { TierText, useAction } from "../leads/ui";

/** A follower as the list shows it: in People once it was there or added here. */
type Row = NewFollower & { readonly listed: boolean };

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { label: "Score", className: "w-12", cell: (f) => f.score },
  {
    label: "Tier",
    className: "hidden w-24 @lg:block",
    cell: (f) => (
      <span className="text-muted-foreground">
        <TierText tier={f.tier} />
      </span>
    ),
  },
  { label: "Followers", className: "w-18", cell: (f) => fmt(f.followers) },
  {
    label: "People",
    className: "hidden w-16 @xl:block",
    cell: (f) => (f.listed ? <span className="text-muted-foreground">added</span> : ""),
  },
];

type Checked = { readonly followers: ReadonlyArray<NewFollower>; readonly costUsd: number };

/** The check reads the own handle's newest followers page; one under 10 minutes old serves free. */
function CheckButton({
  handle,
  label,
  busy,
  onClick,
}: {
  readonly handle: string;
  readonly label: string;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  const quote = useQuoteLabel({ kind: "followersPage", handle });
  return (
    <button type="button" className={pill} disabled={busy || quote === "…"} onClick={onClick}>
      <TextMorph duration={250}>{busy ? "Checking…" : label}</TextMorph>
      <Cost label={quote} />
    </button>
  );
}

/** Followers gained since the last check. One followers page per check, priced up front. */
export function FollowersSection() {
  const settingsResult = useAtomValue(settingsAtom);
  const settings = AsyncResult.getOrElse(settingsResult, () => null);
  const check = useAtomSet(newFollowersAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<Checked | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  // The quote is for the own handle's page, so there is no button until the handle is known.
  const handle = settings?.handle ?? null;
  const button = (label: string) =>
    handle === null ? undefined : (
      <CheckButton
        handle={handle}
        label={label}
        busy={busy}
        onClick={() => void run(() => check().then(setResult))}
      />
    );

  return (
    <>
      <PageHeader
        title="Audience"
        detail={
          result === null ? undefined : `${result.followers.length} new · ${usd(result.costUsd)}`
        }
        // Before the first check the button sits where the followers will be.
        actions={result === null ? undefined : button("Check again")}
      />
      {AsyncResult.isFailure(settingsResult) ? (
        // The check needs the handle from settings; without them there is nothing to price.
        <PageBody>
          <ErrorLine>{errorText(settingsResult.cause)}</ErrorLine>
        </PageBody>
      ) : settings !== null && settings.handle === null ? (
        <PageBody>
          <NoHandle subject="New followers need" />
        </PageBody>
      ) : result === null ? (
        <PageBody>
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          <Empty action={button("Check new followers")}>
            Reads your latest followers page and shows who is new since the last check.
          </Empty>
        </PageBody>
      ) : result.followers.length === 0 ? (
        <PageBody>
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          <Empty>No new followers since the last check.</Empty>
        </PageBody>
      ) : (
        <FollowerList
          followers={result.followers}
          added={added}
          onAdded={(handle) => setAdded((s) => new Set(s).add(handle))}
          error={error}
        />
      )}
    </>
  );
}

function FollowerList({
  followers,
  added,
  onAdded,
  error,
}: {
  readonly followers: ReadonlyArray<NewFollower>;
  readonly added: ReadonlySet<string>;
  readonly onAdded: (handle: string) => void;
  readonly error: string | null;
}) {
  const { selected, select } = useSelection(followers.map((f) => f.userId));
  const current = followers.find((f) => f.userId === selected) ?? null;
  return (
    <DetailSplit
      detailKey={selected}
      list={
        <>
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          <ListHead label="Follower" columns={COLUMNS} />
          {followers.map((f) => (
            <ListRow
              key={f.userId}
              selected={f.userId === selected}
              onSelect={() => select(f.userId)}
              item={{ ...f, listed: f.inPeople || added.has(f.handle) }}
              columns={COLUMNS}
            >
              <RowTitle
                name={`@${f.handle}`}
                meta={`${f.name}${f.verified ? " · verified" : ""}`}
              />
              {f.bio !== "" ? <RowText>{f.bio}</RowText> : null}
            </ListRow>
          ))}
        </>
      }
      detail={
        current === null ? null : (
          <FollowerDetail
            key={current.userId}
            follower={current}
            inPeople={current.inPeople || added.has(current.handle)}
            onAdded={() => onAdded(current.handle)}
          />
        )
      }
    />
  );
}

function FollowerDetail({
  follower: f,
  inPeople,
  onAdded,
}: {
  readonly follower: NewFollower;
  readonly inPeople: boolean;
  readonly onAdded: () => void;
}) {
  const add = useAtomSet(addPersonAtom, { mode: "promise" });
  const refreshPeople = useAtomRefresh(peopleAtom(null));
  const { busy, error, run } = useAction();
  return (
    <>
      <Section>
        <p className="truncate text-sm font-semibold">@{f.handle}</p>
        <p className="truncate text-[12.5px] text-muted-foreground">{f.name}</p>
        {f.bio !== "" ? (
          <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{f.bio}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={pillSolid}
            disabled={busy || inPeople}
            onClick={() =>
              void run(() =>
                add({
                  handle: f.handle,
                  name: f.name,
                  userId: f.userId,
                  followers: f.followers,
                  bio: f.bio,
                  source: "followers",
                }).then(() => {
                  onAdded();
                  refreshPeople();
                }),
              )
            }
          >
            <TextMorph duration={250}>{inPeople ? "In people" : "Add to people"}</TextMorph>
          </button>
          <OpenOnX href={profileUrl(f.handle)} />
        </div>
        {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
      </Section>
      <Section title="Numbers">
        <Props
          rows={[
            ["Score", f.score],
            ["Tier", <TierText key="tier" tier={f.tier} />],
            ["Followers", fmt(f.followers)],
            ["Following", fmt(f.following)],
            ["Verified", f.verified ? "yes" : "no"],
            [
              "Joined",
              f.createdAt === null
                ? "–"
                : new Date(f.createdAt).toLocaleDateString("en", {
                    month: "short",
                    year: "numeric",
                  }),
            ],
          ]}
        />
      </Section>
    </>
  );
}
