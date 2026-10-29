import { useAtomSet } from "@effect/atom-react";
import type { ReplyTone } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { saveSuggestedDraftAtom } from "../../state/library";
import { Candidates, ToneRow } from "../ui/assist-choice";
import { Cost } from "../ui/layout";
import { xPillSolid, xPillSm } from "../x";
import { InspectorGroup } from "./PostInspector";
import { AppLink, ErrorLine, errorMessage } from "./shared";

/**
 * A post of the user's own, written from the one in the inspector: a tone (or any), three
 * options, and the picked one sent to Compose as a suggested draft to edit there. Nothing is
 * filed until the user sends one.
 */
export function DraftChoice({
  title,
  source,
  write,
}: {
  readonly title: string;
  /** Where the kept draft came from, as Compose records it. */
  readonly source: string;
  readonly write: (tone: ReplyTone | undefined) => Promise<ReadonlyArray<string>>;
}) {
  const save = useAtomSet(saveSuggestedDraftAtom, { mode: "promise" });
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const [tone, setTone] = useState<ReplyTone | null | undefined>(undefined);
  const [options, setOptions] = useState<ReadonlyArray<string>>([]);
  const [picked, setPicked] = useState("");
  const [filed, setFiled] = useState(false);
  const [busy, setBusy] = useState<"write" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (which: "write" | "send", work: () => Promise<void>) => {
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

  const onTone = (next: ReplyTone | null) => {
    setTone(next);
    setFiled(false);
    void call("write", async () => {
      const list = await write(next ?? undefined);
      setOptions(list);
      setPicked(list[0] ?? "");
    });
  };

  return (
    <InspectorGroup title={title} aside={<Cost label={`3 options · ${assistQuote}`} />}>
      <div className="flex flex-col gap-2">
        <ToneRow
          tone={tone}
          first="Any tone"
          busy={busy === "write" ? tone : undefined}
          disabled={busy !== null}
          onTone={onTone}
        />
        <Candidates drafts={options} picked={picked} onPick={setPicked} />
        {picked === "" ? null : filed ? (
          <p className="text-xs text-muted-foreground">
            Filed as a suggested draft.{" "}
            <AppLink href="/compose?tab=automatic" className="text-foreground hover:underline">
              Open Compose
            </AppLink>
          </p>
        ) : (
          <div>
            <button
              type="button"
              className={cn(xPillSolid, xPillSm)}
              disabled={busy !== null}
              onClick={() =>
                void call("send", async () => {
                  await save({ text: picked, source });
                  setFiled(true);
                })
              }
            >
              Send to Compose
            </button>
          </div>
        )}
        {error !== null ? <ErrorLine className="px-0">{error}</ErrorLine> : null}
      </div>
    </InspectorGroup>
  );
}
