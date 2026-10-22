import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SignalAgent, SignalAgentInput } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import {
  agentsAtom,
  peopleAtom,
  runAgentAtom,
  suggestAgentsAtom,
  upsertAgentAtom,
} from "../../state/leads";
import { useRates, usd } from "../../state/costs";
import { Empty, ErrorText, errorText, inputClass, Section } from "../analyze/ui";
import { Button } from "../ui/button";
import { ago, useAction } from "./ui";

const blank: SignalAgentInput = {
  name: "",
  query: "",
  minFollowers: 0,
  intervalMinutes: 30,
  enabled: true,
  scoringPrompt: "",
};

/** Signal agents: saved searches the service runs on a schedule and files into people. */
export function Agents() {
  const rates = useRates();
  const agents = useAtomValue(agentsAtom);
  const [editing, setEditing] = useState<SignalAgentInput | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {editing !== null ? (
        <AgentForm initial={editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="flex gap-1.5">
          <Button size="xs" variant="outline" onClick={() => setEditing(blank)}>
            New agent
          </Button>
          <Suggest onPick={setEditing} />
        </div>
      )}
      {AsyncResult.match(agents, {
        onInitial: () => <Empty>Loading agents…</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            <Empty>No agents yet. Each run is one search ({usd(rates?.searchPage ?? 0)}).</Empty>
          ) : (
            value.map((a) => <AgentCard key={a.id} agent={a} onEdit={() => setEditing(a)} />)
          ),
      })}
    </div>
  );
}

function AgentCard({
  agent,
  onEdit,
}: {
  readonly agent: SignalAgent;
  readonly onEdit: () => void;
}) {
  const rates = useRates();
  const refresh = useAtomRefresh(agentsAtom);
  const refreshPeople = useAtomRefresh(peopleAtom(null));
  const runAgent = useAtomSet(runAgentAtom, { mode: "promise" });
  const upsert = useAtomSet(upsertAgentAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const last = agent.lastRun;
  return (
    <Section
      title={agent.name}
      actions={
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs text-muted-foreground">
            {agent.enabled ? `every ${agent.intervalMinutes} min` : "paused"}
          </span>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy}
            onClick={() =>
              void run(() =>
                runAgent(agent.id).then(() => {
                  refresh();
                  refreshPeople();
                }),
              )
            }
          >
            {busy ? "Running…" : `Run now (${usd(rates?.searchPage ?? 0)})`}
          </Button>
          <Button size="xs" variant="ghost-muted" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy}
            onClick={() =>
              void run(() => upsert({ ...agent, enabled: !agent.enabled }).then(refresh))
            }
          >
            {agent.enabled ? "Pause" : "Resume"}
          </Button>
        </div>
      }
    >
      <p className="text-xs">
        search <span className="font-mono">{agent.query}</span>
        {agent.minFollowers > 0 ? ` · min followers ${agent.minFollowers}` : ""}
        {agent.scoringPrompt !== "" ? " · scored by AI" : ""}
      </p>
      <p className="pt-1 font-mono text-2xs text-muted-foreground">
        {last === null
          ? "never run"
          : last.error !== null
            ? `last run ${ago(last.at)} ago · failed: ${last.error}`
            : `last run ${ago(last.at)} ago · ${last.found} found · ${last.inserted} new · ${usd(last.costUsd)}`}
      </p>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
    </Section>
  );
}

function AgentForm({
  initial,
  onDone,
}: {
  readonly initial: SignalAgentInput;
  readonly onDone: () => void;
}) {
  const rates = useRates();
  const refresh = useAtomRefresh(agentsAtom);
  const upsert = useAtomSet(upsertAgentAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [a, setA] = useState(initial);
  const valid = a.name.trim() !== "" && a.query.trim() !== "" && a.intervalMinutes >= 1;
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  return (
    <Section title={initial.id === undefined ? "New agent" : `Edit ${initial.name}`}>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid)
            void run(() =>
              upsert(a).then(() => {
                refresh();
                onDone();
              }),
            );
        }}
      >
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            placeholder="Name"
            value={a.name}
            onChange={(e) => setA({ ...a, name: e.target.value })}
          />
          <input
            className={inputClass + " w-28"}
            placeholder="min followers"
            inputMode="numeric"
            value={a.minFollowers || ""}
            onChange={(e) => setA({ ...a, minFollowers: num(e.target.value) })}
          />
          <label className="flex shrink-0 items-center gap-1 font-mono text-2xs text-muted-foreground">
            every
            <input
              className={inputClass + " w-14"}
              inputMode="numeric"
              value={a.intervalMinutes}
              onChange={(e) => setA({ ...a, intervalMinutes: num(e.target.value) })}
            />
            min
          </label>
        </div>
        <input
          className={inputClass}
          placeholder='Search: "typefully alternative" OR "tweet hunter"'
          value={a.query}
          onChange={(e) => setA({ ...a, query: e.target.value })}
        />
        <textarea
          className={inputClass}
          rows={2}
          placeholder="Scoring prompt (optional): what makes a match worth your time"
          value={a.scoringPrompt}
          onChange={(e) => setA({ ...a, scoringPrompt: e.target.value })}
        />
        <div className="flex items-center gap-1.5">
          <Button size="xs" type="submit" disabled={busy || !valid}>
            Save
          </Button>
          <Button size="xs" variant="ghost-muted" onClick={onDone}>
            Cancel
          </Button>
          <span className="font-mono text-2xs text-muted-foreground">
            {usd(rates?.searchPage ?? 0)} per run
          </span>
        </div>
        {error !== null ? <ErrorText>{error}</ErrorText> : null}
      </form>
    </Section>
  );
}

/** AI proposes agents from the voice profile and keywords; picking one opens it in the form. */
function Suggest({ onPick }: { readonly onPick: (a: SignalAgentInput) => void }) {
  const suggest = useAtomSet(suggestAgentsAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [items, setItems] = useState<
    ReadonlyArray<{ name: string; query: string; scoringPrompt: string }>
  >([]);
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => void run(() => suggest().then(setItems))}
      >
        {busy ? "Thinking…" : "Suggest with AI"}
      </Button>
      {items.map((s) => (
        <Button
          key={s.name}
          size="xs"
          variant="ghost-muted"
          onClick={() => onPick({ ...blank, ...s })}
        >
          {s.name}
        </Button>
      ))}
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
