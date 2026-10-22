import { useAtomRefresh, useAtomSet } from "@effect/atom-react";
import type { NewFollower } from "@xtend/contracts";
import { useState } from "react";

import { addPersonAtom, newFollowersAtom, peopleAtom } from "../../state/leads";
import { useRates, usd } from "../../state/costs";
import { Empty, ErrorText, fmt } from "../analyze/ui";
import { Button } from "../ui/button";
import { useAction } from "./ui";

/** Followers gained since the last check. One followers page per check, paid up front. */
export function Followers() {
  const rates = useRates();
  const check = useAtomSet(newFollowersAtom, { mode: "promise" });
  const add = useAtomSet(addPersonAtom, { mode: "promise" });
  const refreshPeople = useAtomRefresh(peopleAtom(null));
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<{
    readonly followers: ReadonlyArray<NewFollower>;
    readonly costUsd: number;
  } | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  const addOne = (f: NewFollower) =>
    run(() =>
      add({
        handle: f.handle,
        name: f.name,
        userId: f.userId,
        followers: f.followers,
        bio: f.bio,
        source: "followers",
      }).then(() => {
        setAdded((s) => new Set(s).add(f.handle));
        refreshPeople();
      }),
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => check().then(setResult))}
        >
          {busy ? "Checking…" : `Check new followers (${usd(rates?.followersPage ?? 0)})`}
        </Button>
        {result !== null ? (
          <span className="font-mono text-2xs text-muted-foreground">
            {result.followers.length} new · cost {usd(result.costUsd)}
          </span>
        ) : null}
      </div>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {result === null ? (
        <Empty>Reads the latest followers page and shows who is new since the last check.</Empty>
      ) : result.followers.length === 0 ? (
        <Empty>No new followers since the last check.</Empty>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-2xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Follower</th>
              <th className="py-1 text-right font-normal">Followers</th>
              <th className="py-1 pl-3 text-left font-normal">Bio</th>
              <th className="py-1 text-right font-normal" />
            </tr>
          </thead>
          <tbody>
            {result.followers.map((f) => {
              const inPeople = f.inPeople || added.has(f.handle);
              return (
                <tr key={f.userId} className="border-t border-border hover:bg-accent/60">
                  <td className="max-w-xs truncate py-1 pr-2">
                    <a
                      href={`https://x.com/${f.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      @{f.handle}
                    </a>{" "}
                    <span className="text-muted-foreground">{f.name}</span>
                    {f.verified ? (
                      <span className="font-mono text-2xs text-muted-foreground"> ✓</span>
                    ) : null}
                  </td>
                  <td className="py-1 text-right font-mono text-2xs">{fmt(f.followers)}</td>
                  <td className="max-w-md truncate py-1 pl-3 text-muted-foreground">{f.bio}</td>
                  <td className="py-1 text-right">
                    {inPeople ? (
                      <span className="font-mono text-2xs text-muted-foreground">in people</span>
                    ) : (
                      <Button
                        size="micro"
                        variant="ghost-muted"
                        disabled={busy}
                        onClick={() => void addOne(f)}
                      >
                        Add
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
