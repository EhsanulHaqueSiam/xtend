import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck } from "lucide-react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { engagersAtom } from "../../state/analyze";
import { errorText, fmt, insetTable, Note } from "../analyze/ui";
import { Button } from "../ui/button";
import { Section } from "../ui/layout";
import { profileUrl, XLink } from "../ui/x-link";

/** The accounts the session showed most, by reach: who fills your feed, from what Seen holds. Free. */
export function Authors() {
  const result = useAtomValue(engagersAtom);
  const t = insetTable;
  return (
    <Section title="Accounts you see most">
      {AsyncResult.match(result, {
        onInitial: () => <Note>Loading.</Note>,
        onFailure: (f) => <p className="text-xs text-error-foreground">{errorText(f.cause)}</p>,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            isElectron ? (
              <Note
                action={
                  <Button size="sm" variant="outline" render={<Link to="/x" />}>
                    Open X
                  </Button>
                }
              >
                Nothing seen yet. Accounts land here as you browse X.
              </Note>
            ) : (
              <Note>Nothing seen yet. Browse X in the desktop app.</Note>
            )
          ) : (
            <table className={t.root}>
              <thead>
                <tr>
                  <th className={t.th}>Account</th>
                  {/* The session rarely sees follower counts; a column of dashes says nothing. */}
                  {value.some((e) => e.followers !== null) ? (
                    <th className={cn(t.th, "text-right")}>Followers</th>
                  ) : null}
                  <th className={cn(t.th, "text-right")}>Seen</th>
                </tr>
              </thead>
              <tbody>
                {value.map((e) => (
                  <tr key={e.handle} className={t.row}>
                    <td className={cn(t.td, "max-w-0")}>
                      <XLink
                        href={profileUrl(e.handle)}
                        className="flex min-w-0 items-center gap-1.5 hover:underline"
                      >
                        <span className="truncate font-medium">{e.name}</span>
                        {e.verified ? (
                          <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          @{e.handle}
                        </span>
                      </XLink>
                    </td>
                    {value.some((v) => v.followers !== null) ? (
                      <td className={cn(t.td, t.num)}>{fmt(e.followers)}</td>
                    ) : null}
                    <td className={cn(t.td, t.num, "text-muted-foreground")}>{e.seen}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ),
      })}
    </Section>
  );
}
