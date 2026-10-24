import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { NewFollower } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { useRates, usd } from "../../state/costs";
import { addPersonAtom, newFollowersAtom, peopleAtom } from "../../state/leads";
import { settingsAtom } from "../../state/settings";
import { fmt } from "../analyze/ui";
import {
  type Column,
  ErrorLine,
  ListHead,
  ListRow,
  NoHandle,
  OpenOnX,
  pill,
  pillSolid,
  Props,
  RowText,
  RowTitle,
  Split,
  useSelection,
} from "../engage/triage";
import { PageHeader } from "../PageHeader";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
import { useAction } from "./ui";

/** A follower as the list shows it: in People once it was there or added here. */
type Row = NewFollower & { readonly listed: boolean };

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { label: "Score", className: "w-12", cell: (f) => f.score },
  {
    label: "Tier",
    className: "hidden w-24 @lg:block",
    cell: (f) => <span className="text-muted-foreground">{f.tier}</span>,
  },
  { label: "Followers", className: "w-18", cell: (f) => fmt(f.followers) },
  {
    label: "People",
    className: "hidden w-16 @xl:block",
    cell: (f) => (f.listed ? <span className="text-muted-foreground">added</span> : ""),
  },
];

type Checked = { readonly followers: ReadonlyArray<NewFollower>; readonly costUsd: number };

/** Followers gained since the last check. One followers page per check, paid up front. */
export function FollowersSection() {
  const rates = useRates();
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const check = useAtomSet(newFollowersAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<Checked | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  const button = (label: string) => (
    <button
      type="button"
      className={pill}
      disabled={busy || rates === null}
      onClick={() => void run(() => check().then(setResult))}
    >
      <TextMorph duration={250}>{busy ? "Checking…" : label}</TextMorph>
      {rates === null ? <Cost label="…" /> : <Cost usd={rates.followersPage} />}
    </button>
  );

  return (
    <>
      <PageHeader
        title="New followers"
        detail={
          result === null ? undefined : `${result.followers.length} new · ${usd(result.costUsd)}`
        }
        // Before the first check the button sits where the followers will be.
        actions={result === null ? undefined : button("Check again")}
      />
      {settings !== null && settings.handle === null ? (
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
    <Split
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
          <OpenOnX url={`https://x.com/${f.handle}`} />
        </div>
        {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
      </Section>
      <Section title="Numbers">
        <Props
          rows={[
            ["Score", f.score],
            ["Tier", f.tier],
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
