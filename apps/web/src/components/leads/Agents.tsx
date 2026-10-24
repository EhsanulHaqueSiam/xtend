import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AgentSuggestion, SignalAgent, SignalAgentInput } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { useRates, usd } from "../../state/costs";
import {
  agentsAtom,
  listsAtom,
  peopleAtom,
  runAgentAtom,
  suggestAgentsAtom,
  upsertAgentAtom,
} from "../../state/leads";
import { errorText } from "../analyze/ui";
import { ago, ErrorLine, pill, pillSolid } from "../engage/triage";
import { PageHeader } from "../PageHeader";
import { Field, inputClass } from "../ui/field";
import { Cost, Empty, PageBody, Section } from "../ui/layout";
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
import { xAction } from "../x";
import { useAction } from "./ui";

const blank: SignalAgentInput = {
  name: "",
  query: "",
  minFollowers: 0,
  intervalMinutes: 30,
  enabled: true,
  scoringPrompt: "",
  lang: null,
  excludeBots: false,
  notifyMinScore: null,
  listId: null,
};

const COLUMNS: ReadonlyArray<Column<SignalAgent>> = [
  {
    label: "Every",
    className: "w-16",
    cell: (a) => (a.enabled ? `${a.intervalMinutes}m` : "paused"),
  },
  { label: "Found", className: "hidden w-14 @lg:block", cell: (a) => a.lastRun?.found ?? "–" },
  { label: "New", className: "hidden w-12 @lg:block", cell: (a) => a.lastRun?.inserted ?? "–" },
  {
    label: "Spent",
    className: "hidden w-18 @xl:block",
    cell: (a) => (a.lastRun === null ? "–" : usd(a.lastRun.costUsd)),
  },
  {
    label: "Last run",
    className: "w-16",
    cell: (a) =>
      a.lastRun === null ? (
        <span className="text-muted-foreground">never</span>
      ) : a.lastRun.error !== null ? (
        <span className="text-error-foreground">failed</span>
      ) : (
        ago(a.lastRun.at)
      ),
  },
];

/** Signal agents: saved searches the service runs on a schedule and files into people. */
export function AgentsSection() {
  const rates = useRates();
  const result = useAtomValue(agentsAtom);
  const agents = AsyncResult.getOrElse(result, () => []);
  const suggest = useAtomSet(suggestAgentsAtom, { mode: "promise" });
  const suggesting = useAction();
  const [suggestions, setSuggestions] = useState<ReadonlyArray<AgentSuggestion>>([]);
  // A new agent's form takes the detail column until it is saved or dropped.
  const [draft, setDraft] = useState<SignalAgentInput | null>(null);
  const lists = AsyncResult.getOrElse(useAtomValue(listsAtom), () => []);
  const listName = (id: number) => lists.find((l) => l.id === id)?.name ?? `list ${id}`;
  const { selected, select } = useSelection(agents.map((a) => a.id));
  const current = agents.find((a) => a.id === selected) ?? null;
  const running = agents.filter((a) => a.enabled).length;

  return (
    <>
      <PageHeader
        title="Agents"
        detail={
          AsyncResult.isSuccess(result) && agents.length > 0
            ? `${running} of ${agents.length} running`
            : undefined
        }
        actions={
          <>
            <button
              type="button"
              className={pill}
              disabled={suggesting.busy}
              onClick={() => void suggesting.run(() => suggest().then(setSuggestions))}
            >
              <TextMorph duration={250}>
                {suggesting.busy ? "Thinking…" : "Suggest with AI"}
              </TextMorph>
            </button>
            <button type="button" className={pillSolid} onClick={() => setDraft(blank)}>
              New agent
            </button>
          </>
        }
      />
      {AsyncResult.match(result, {
        onInitial: () => (
          <PageBody>
            <Empty>Loading agents…</Empty>
          </PageBody>
        ),
        onFailure: (f) => (
          <PageBody>
            <ErrorLine>{errorText(f.cause)}</ErrorLine>
          </PageBody>
        ),
        onSuccess: () => (
          <DetailSplit
            detailKey={draft !== null ? "new" : selected}
            list={
              <>
                {suggesting.error !== null ? <ErrorLine>{suggesting.error}</ErrorLine> : null}
                {suggestions.length > 0 ? (
                  <Section
                    title="Suggested agents"
                    aside={
                      <button type="button" className={xAction} onClick={() => setSuggestions([])}>
                        Dismiss
                      </button>
                    }
                  >
                    <ul className="border-t border-border">
                      {suggestions.map((s) => (
                        <li
                          key={s.name}
                          className="flex items-center gap-3 border-b border-border py-1.5 text-[13px]"
                        >
                          <span className="shrink-0 font-medium">{s.name}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                            {s.query}
                          </span>
                          <button
                            type="button"
                            className={xAction}
                            onClick={() => setDraft({ ...blank, ...s })}
                          >
                            Use
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}
                {agents.length === 0 ? (
                  <Empty
                    action={
                      draft === null ? (
                        <button type="button" className={pill} onClick={() => setDraft(blank)}>
                          New agent
                        </button>
                      ) : undefined
                    }
                  >
                    No agents yet. Each run is one search
                    {rates === null ? "" : ` (${usd(rates.searchPage)})`}.
                  </Empty>
                ) : (
                  <>
                    <ListHead label="Agent" columns={COLUMNS} />
                    {agents.map((a) => (
                      <ListRow
                        key={a.id}
                        selected={draft === null && a.id === selected}
                        onSelect={() => {
                          select(a.id);
                          setDraft(null);
                        }}
                        muted={!a.enabled}
                        item={a}
                        columns={COLUMNS}
                      >
                        <RowTitle
                          name={a.name}
                          meta={a.listId === null ? "" : `into ${listName(a.listId)}`}
                        />
                        <RowText>
                          <span className="font-mono text-xs">{a.query}</span>
                        </RowText>
                      </ListRow>
                    ))}
                  </>
                )}
              </>
            }
            detail={
              draft !== null ? (
                <AgentForm
                  key={JSON.stringify(draft)}
                  title="New agent"
                  initial={draft}
                  onSaved={(id) => {
                    setDraft(null);
                    select(id);
                  }}
                  onCancel={() => setDraft(null)}
                />
              ) : current === null ? null : (
                <AgentPanel key={current.id} agent={current} />
              )
            }
          />
        ),
      })}
    </>
  );
}

/** The selected agent: run it, pause it, its last run, and its settings in place. */
function AgentPanel({ agent }: { readonly agent: SignalAgent }) {
  const rates = useRates();
  const refresh = useAtomRefresh(agentsAtom);
  const refreshPeople = useAtomRefresh(peopleAtom(null));
  const runAgent = useAtomSet(runAgentAtom, { mode: "promise" });
  const upsert = useAtomSet(upsertAgentAtom, { mode: "promise" });
  const running = useAction();
  const toggling = useAction();
  const last = agent.lastRun;
  return (
    <>
      <Section>
        <p className="truncate text-sm font-semibold">{agent.name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {agent.enabled ? `every ${agent.intervalMinutes} min` : "paused"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={pill}
            disabled={running.busy || rates === null}
            onClick={() =>
              void running.run(() =>
                runAgent(agent.id).then(() => {
                  refresh();
                  refreshPeople();
                }),
              )
            }
          >
            <TextMorph duration={250}>{running.busy ? "Running…" : "Run now"}</TextMorph>
            {rates === null ? <Cost label="…" /> : <Cost usd={rates.searchPage} />}
          </button>
          <button
            type="button"
            className={pill}
            disabled={toggling.busy}
            onClick={() =>
              void toggling.run(() => upsert({ ...agent, enabled: !agent.enabled }).then(refresh))
            }
          >
            <TextMorph duration={250}>{agent.enabled ? "Pause" : "Resume"}</TextMorph>
          </button>
        </div>
        {(running.error ?? toggling.error) !== null ? (
          <p className="mt-2 text-xs text-error-foreground">{running.error ?? toggling.error}</p>
        ) : null}
      </Section>
      <Section title="Last run">
        {last === null ? (
          <p className="text-[13px] text-muted-foreground">Never run.</p>
        ) : (
          <>
            <Props
              rows={[
                ["When", fmtWhen(last.at)],
                ["Found", last.found],
                ["New people", last.inserted],
                ["Spent", usd(last.costUsd)],
              ]}
            />
            {last.error !== null ? (
              <p className="mt-2 text-xs break-words text-error-foreground">{last.error}</p>
            ) : null}
          </>
        )}
      </Section>
      <AgentForm key={agent.id} title="Settings" initial={agent} onSaved={() => undefined} />
    </>
  );
}

/** An agent's settings as a property list; Save writes them, Revert drops the edits. */
function AgentForm({
  title,
  initial,
  onSaved,
  onCancel,
}: {
  readonly title: string;
  readonly initial: SignalAgentInput;
  readonly onSaved: (id: number) => void;
  readonly onCancel?: () => void;
}) {
  const rates = useRates();
  const refresh = useAtomRefresh(agentsAtom);
  const upsert = useAtomSet(upsertAgentAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [a, setA] = useState(initial);
  const lists = AsyncResult.getOrElse(useAtomValue(listsAtom), () => []);
  const valid = a.name.trim() !== "" && a.query.trim() !== "" && a.intervalMinutes >= 1;
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  // A new agent (blank or suggested) saves as soon as it is valid; a saved one once it changed.
  const canSave = valid && (initial.id === undefined || dirty);
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  return (
    <Section title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid)
            void run(() =>
              upsert(a).then((saved) => {
                refresh();
                onSaved(saved.id);
              }),
            );
        }}
      >
        <Field label="Name">
          <input
            className={inputClass}
            placeholder="Typefully switchers"
            value={a.name}
            onChange={(e) => setA({ ...a, name: e.target.value })}
          />
        </Field>
        <Field label="Search">
          <textarea
            className={cn(inputClass, "min-h-14 resize-y font-mono text-xs leading-relaxed")}
            placeholder='"typefully alternative" OR "tweet hunter"'
            value={a.query}
            onChange={(e) => setA({ ...a, query: e.target.value })}
          />
        </Field>
        <Field label="Every">
          <span className="flex items-center gap-2">
            <input
              className={cn(inputClass, "w-16")}
              inputMode="numeric"
              value={a.intervalMinutes}
              onChange={(e) => setA({ ...a, intervalMinutes: num(e.target.value) })}
            />
            <span className="text-[13px] text-muted-foreground">min</span>
          </span>
        </Field>
        <Field label="Min followers">
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="any"
            value={a.minFollowers || ""}
            onChange={(e) => setA({ ...a, minFollowers: num(e.target.value) })}
          />
        </Field>
        <Field label="Language">
          <input
            className={cn(inputClass, "w-16")}
            placeholder="any"
            maxLength={2}
            value={a.lang ?? ""}
            onChange={(e) =>
              setA({
                ...a,
                lang: e.target.value.trim() === "" ? null : e.target.value.trim().toLowerCase(),
              })
            }
          />
        </Field>
        <Field label="Drop bots">
          <span className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5 cursor-pointer accent-foreground"
              checked={a.excludeBots}
              onChange={(e) => setA({ ...a, excludeBots: e.target.checked })}
            />
            <span className="text-[13px] text-muted-foreground">per new author</span>
            {rates === null ? <Cost label="…" /> : <Cost usd={rates.scraperProfile} />}
          </span>
        </Field>
        <Field label="Notify at">
          <input
            className={cn(inputClass, "w-16")}
            inputMode="numeric"
            placeholder="off"
            value={a.notifyMinScore ?? ""}
            onChange={(e) =>
              setA({
                ...a,
                notifyMinScore: e.target.value === "" ? null : Math.min(100, num(e.target.value)),
              })
            }
          />
        </Field>
        <Field label="Into list">
          <select
            className={cn(inputClass, "bg-background")}
            value={a.listId ?? ""}
            onChange={(e) =>
              setA({ ...a, listId: e.target.value === "" ? null : Number(e.target.value) })
            }
          >
            <option value="">none</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scoring">
          <textarea
            className={cn(inputClass, "min-h-16 resize-y leading-relaxed")}
            placeholder="Optional: what makes a match worth your time"
            value={a.scoringPrompt}
            onChange={(e) => setA({ ...a, scoringPrompt: e.target.value })}
          />
        </Field>
        <div className="mt-3 flex items-center gap-1.5">
          <button type="submit" className={pillSolid} disabled={busy || !canSave}>
            {busy ? "Saving…" : "Save"}
          </button>
          {onCancel !== undefined ? (
            <button type="button" className={xAction} onClick={onCancel}>
              Cancel
            </button>
          ) : dirty ? (
            <button type="button" className={xAction} onClick={() => setA(initial)}>
              Revert
            </button>
          ) : null}
          <span className="ml-auto flex items-baseline gap-1.5 text-xs text-muted-foreground">
            per run
            {rates === null ? <Cost label="…" /> : <Cost usd={rates.searchPage} />}
          </span>
        </div>
        {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
      </form>
    </Section>
  );
}
