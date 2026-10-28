import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  AccountList,
  ServerInfo,
  Settings as SettingsShape,
  SettingsUpdate,
} from "@xtend/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Field, inputClass } from "../components/ui/field";
import { PageBody, Section, Stat } from "../components/ui/layout";
import { Switch } from "../components/ui/switch";
import type { Reachability, ServiceMode } from "../desktopBridge";
import { isElectron } from "../env";
import { cn, NOT_A_HANDLE, parseHandle } from "../lib/utils";
import {
  accountsAtom,
  createAccountAtom,
  selectAccountAtom,
  switchAccount,
} from "../state/accounts";
import { serverInfoAtom } from "../state/observations";
import { useQuoteLabel } from "../state/costs";
import { settingsAtom, spendAtom, updateSettingsAtom } from "../state/settings";
import { xSkinAtom } from "../state/x";

const usd = (n: number) => `$${n.toFixed(2)}`;

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border py-2.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-xs">{children}</dd>
    </div>
  );
}

// Settings reads as a list of values, so its fields are mono.
const settingsInput = cn(inputClass, "font-mono text-xs");

/** What the service accepts too: Intl knows the zone. A typo would come back as a bare "update failed". */
const isTimeZone = (zone: string) => {
  try {
    // Throws a RangeError for a zone Intl does not know.
    return Boolean(new Intl.DateTimeFormat("en", { timeZone: zone }));
  } catch {
    return false;
  }
};

/** Where assist can run for free. The model names are each provider's cheap, capable default. */
const ASSIST_PRESETS = [
  { label: "Xtend", baseUrl: null, model: "" },
  { label: "Local (Ollama)", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-5-5" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
] as const;

function SettingsForm({ current }: { readonly current: SettingsShape }) {
  const update = useAtomSet(updateSettingsAtom, { mode: "promise" });
  const refreshSettings = useAtomRefresh(settingsAtom);
  // The meter shows the budget, and today and this month are days in the saved time zone.
  const refreshSpend = useAtomRefresh(spendAtom);
  const [draft, setDraft] = useState<SettingsUpdate>({});
  const [tregToken, setTregToken] = useState("");
  const [assistKey, setAssistKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetInvalid, setBudgetInvalid] = useState(false);
  const [zoneInvalid, setZoneInvalid] = useState(false);
  const dirty = Object.keys(draft).length > 0 || tregToken !== "" || assistKey !== "";
  const invalid = budgetInvalid || zoneInvalid;
  const assistBaseUrl =
    draft.assistBaseUrl === undefined ? current.assistBaseUrl : draft.assistBaseUrl;

  const save = async () => {
    setError(null);
    const handle = draft.handle == null ? draft.handle : parseHandle(draft.handle);
    if (handle === null && draft.handle != null) return setError(NOT_A_HANDLE);
    setSaving(true);
    try {
      await update({
        ...draft,
        ...(handle === undefined ? {} : { handle }),
        ...(tregToken === "" ? {} : { tregToken }),
        ...(assistKey === "" ? {} : { assistKey }),
      });
      setDraft({});
      setTregToken("");
      setAssistKey("");
      refreshSettings();
      refreshSpend();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Section title="X account">
        <Field
          wide
          label="Handle"
          hint="Taken from your X session when empty. Scores, analytics and mentions are about it."
        >
          <input
            className={settingsInput}
            placeholder="handle without @"
            defaultValue={current.handle ?? ""}
            onChange={(e) => {
              const value = e.target.value.trim();
              setDraft((d) => ({ ...d, handle: value === "" ? null : value }));
            }}
          />
        </Field>
      </Section>
      <Section title="treg and budget">
        <Field
          wide
          label="treg token"
          hint={
            current.tregTokenSet
              ? "A token is stored. Paste a new one to replace it."
              : "Not set. Falls back to XTEND_TREG_TOKEN or the treg CLI login on this machine."
          }
        >
          <input
            className={settingsInput}
            type="password"
            placeholder="treg token"
            value={tregToken}
            onChange={(e) => setTregToken(e.target.value)}
          />
        </Field>
        <Field
          wide
          label="Monthly budget (USD)"
          hint={
            budgetInvalid
              ? "Enter an amount of 0 or more."
              : "Paid calls stop before this month's spend would pass it."
          }
        >
          <input
            className={settingsInput}
            type="number"
            min={0}
            step={1}
            aria-invalid={budgetInvalid}
            defaultValue={current.monthlyBudgetUsd}
            onChange={(e) => {
              // NaN while empty or half typed ("-"); Number("") would have saved a $0 budget.
              const value = e.target.valueAsNumber;
              const valid = Number.isFinite(value) && value >= 0;
              setBudgetInvalid(!valid);
              if (valid) setDraft((d) => ({ ...d, monthlyBudgetUsd: value }));
            }}
          />
        </Field>
        <DailyJobsField
          checked={draft.dailyLibraryJobs ?? current.dailyLibraryJobs}
          onChange={(next) => setDraft((d) => ({ ...d, dailyLibraryJobs: next }))}
        />
      </Section>
      <Section
        title="AI assist"
        description="free with your own model; otherwise metered through Xtend"
      >
        <Field
          wide
          label="Model"
          hint={
            assistBaseUrl === null
              ? "Xtend's model, billed per call against the budget. Pick a preset to make assist free."
              : "Your endpoint answers every assist for nothing through Xtend; the provider bills you directly, a local model costs nothing at all."
          }
        >
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ASSIST_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="xs"
                aria-label={preset.label}
                aria-pressed={assistBaseUrl === preset.baseUrl}
                className="aria-pressed:border-foreground"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    assistBaseUrl: preset.baseUrl,
                    assistModel: preset.model,
                  }))
                }
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </Field>
        {assistBaseUrl === null ? null : (
          <>
            <Field wide label="Endpoint" hint="OpenAI-compatible, ending in /v1.">
              <input
                className={settingsInput}
                value={assistBaseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, assistBaseUrl: e.target.value }))}
              />
            </Field>
            <Field
              wide
              label="Model name"
              hint="As the provider names it; for Ollama, a model you pulled."
            >
              <input
                className={settingsInput}
                value={draft.assistModel ?? current.assistModel}
                onChange={(e) => setDraft((d) => ({ ...d, assistModel: e.target.value }))}
              />
            </Field>
            <Field
              wide
              label="API key"
              hint={
                current.assistKeySet
                  ? "A key is stored. Paste a new one to replace it. A local model needs none."
                  : "Needed at a provider; a local model needs none. Stored encrypted, never leaves this machine."
              }
            >
              <input
                className={settingsInput}
                type="password"
                placeholder="API key"
                value={assistKey}
                onChange={(e) => setAssistKey(e.target.value)}
              />
            </Field>
          </>
        )}
      </Section>
      <Section title="Time and voice">
        <Field
          wide
          label="Time zone"
          hint={
            zoneInvalid
              ? "Not a time zone. Pick one from the list."
              : "IANA name. Posting slots, the calendar and the best-time heatmap are all in this zone."
          }
        >
          <input
            className={settingsInput}
            list="xtend-zones"
            aria-invalid={zoneInvalid}
            defaultValue={current.timeZone}
            onChange={(e) => {
              const value = e.target.value.trim();
              const valid = value === "" || isTimeZone(value);
              setZoneInvalid(!valid);
              if (valid)
                setDraft((d) => ({ ...d, timeZone: value === "" ? current.timeZone : value }));
            }}
          />
          <datalist id="xtend-zones">
            {Intl.supportedValuesOf("timeZone").map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field
          wide
          label="Voice notes"
          hint="One paragraph on what you post about and how you sound. The assistant writes in this voice."
        >
          <textarea
            className={settingsInput}
            rows={3}
            defaultValue={current.voiceNotes}
            onChange={(e) => setDraft((d) => ({ ...d, voiceNotes: e.target.value }))}
          />
        </Field>
        <Field
          wide
          label="Keywords"
          hint="Comma separated. Library, Engage and Leads search these by default."
        >
          <input
            className={settingsInput}
            defaultValue={current.keywords.join(", ")}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                keywords: e.target.value
                  .split(",")
                  .map((k) => k.trim())
                  .filter((k) => k !== ""),
              }))
            }
          />
        </Field>
      </Section>
      {isElectron ? (
        <Section title="Desktop">
          <Field
            wide
            label="Act through X for what I click"
            hint="On by default. Replies you click and posts with media go through your own X session, one at a time at a human pace, free. Off: replies go through the API at the listed price. Rules never use your session."
          >
            <Switch
              className="mt-1"
              label="Act through my X session for what I click"
              checked={draft.sessionPostingEnabled ?? current.sessionPostingEnabled}
              onChange={(next) => setDraft((d) => ({ ...d, sessionPostingEnabled: next }))}
            />
          </Field>
          <XSkinField />
        </Section>
      ) : null}
      {/* A field left invalid is an unsaved change too; the bar stays to say it cannot save. */}
      {dirty || invalid ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-6 py-3">
          {error !== null ? (
            <p role="alert" className="mr-auto text-xs text-error-foreground">
              {error}
            </p>
          ) : (
            <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button size="sm" disabled={!dirty || saving || invalid} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** The Library's morning jobs spend with nobody clicking, so they are off until turned on here. */
function DailyJobsField({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}) {
  const searches = useQuoteLabel({ kind: "picksFetch" });
  const call = useQuoteLabel({ kind: "assist" });
  return (
    <Field
      wide
      label="Daily Library jobs"
      hint={`Each morning: picks for your keywords (${searches} in searches), hook detection and three ready posts (${call} per model call).`}
    >
      <Switch className="mt-1" label="Daily Library jobs" checked={checked} onChange={onChange} />
    </Field>
  );
}

/** The CSS skin over x.com, applied at once; it is a desktop preference, not a service setting. */
function XSkinField() {
  const skin = useAtomValue(xSkinAtom);
  const setSkin = useAtomSet(xSkinAtom);
  return (
    <Field
      wide
      label="Clean X"
      hint="Hide X's own sidebar, right column and Grok prompts inside Xtend."
    >
      <Switch className="mt-1" label="Clean X" checked={skin} onChange={setSkin} />
    </Field>
  );
}

function SpendMeter() {
  const spend = useAtomValue(spendAtom);
  return AsyncResult.match(spend, {
    onInitial: () => null,
    onFailure: () => null,
    onSuccess: ({ value }) => (
      <Section title="Spend">
        <div className="grid grid-cols-3 gap-6 pb-3">
          <Stat label="This month" value={usd(value.monthUsd)} />
          <Stat label="Today" value={usd(value.todayUsd)} />
          <Stat label="Budget" value={usd(value.monthlyBudgetUsd)} />
        </div>
        <div
          role="meter"
          aria-label="Spent of this month's budget"
          aria-valuemin={0}
          aria-valuemax={value.monthlyBudgetUsd}
          aria-valuenow={value.monthUsd}
          className="mb-4 h-1 overflow-hidden rounded-full bg-white/10"
        >
          <div
            className="h-full bg-foreground"
            style={{
              width: `${value.monthlyBudgetUsd <= 0 ? 0 : Math.min(100, (value.monthUsd / value.monthlyBudgetUsd) * 100)}%`,
            }}
          />
        </div>
        {value.byPurpose.length > 0 ? (
          <dl>
            {value.byPurpose.slice(0, 8).map((p) => (
              <Row key={p.purpose} label={p.purpose}>
                {usd(p.costUsd)}
              </Row>
            ))}
          </dl>
        ) : null}
      </Section>
    ),
  });
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** The desktop knows how it found its service; a browser infers it from where the page came from. */
const modeLabel = (info: ServerInfo): string => {
  const bridge = window.desktopBridge;
  const mode: ServiceMode =
    bridge?.serviceMode ??
    (info.supervisor !== "none"
      ? info.supervisor
      : LOCAL_HOSTS.has(window.location.hostname)
        ? "none"
        : "remote");
  return mode === "remote" && info.supervisor !== "none" ? `remote (${info.supervisor})` : mode;
};

/** Desktop only: point this window at a service on another machine. */
function RemoteService() {
  const bridge = window.desktopBridge;
  const [url, setUrl] = useState(bridge?.remote?.url ?? "");
  const [token, setToken] = useState(bridge?.remote?.token ?? "");
  const [result, setResult] = useState<Reachability | null>(null);
  const [checking, setChecking] = useState(false);
  if (bridge === undefined)
    return (
      <p className="text-xs text-muted-foreground">
        From another browser, open this service's URL with{" "}
        <span className="font-mono">?token=</span>
        followed by the token from <span className="font-mono">auth-token</span> in its data
        directory.
      </p>
    );
  const check = async () => {
    setChecking(true);
    setResult(await bridge.checkRemote({ url: url.trim(), token: token.trim() }));
    setChecking(false);
  };
  const ok = result !== null && result.health && result.auth;
  return (
    <>
      <Field
        wide
        label="Service URL"
        hint="http://<tailnet ip or host>:4820 of a service started with --host."
      >
        <input
          className={settingsInput}
          placeholder="http://mac-mini:4820"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setResult(null);
          }}
        />
      </Field>
      <Field wide label="Service token" hint="auth-token from that machine's data directory.">
        <input
          className={settingsInput}
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setResult(null);
          }}
        />
      </Field>
      {result !== null ? (
        <p
          className={`font-mono text-2xs ${ok ? "text-success-foreground" : "text-error-foreground"}`}
          role="status"
        >
          {ok
            ? `reachable, xtend ${result.version}, token accepted`
            : (result.error ?? "unreachable")}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-3">
        {bridge.remote !== null ? (
          <Button size="sm" variant="outline" onClick={() => bridge.setRemote(null)}>
            Use local service
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={checking || url.trim() === ""}
          onClick={() => void check()}
        >
          {checking ? "Checking…" : "Check"}
        </Button>
        <Button
          size="sm"
          disabled={!ok}
          onClick={() => bridge.setRemote({ url: url.trim(), token: token.trim() })}
        >
          Connect and relaunch
        </Button>
      </div>
    </>
  );
}

function AccountRows({ list }: { readonly list: AccountList }) {
  const select = useAtomSet(selectAccountAtom, { mode: "promise" });
  const create = useAtomSet(createAccountAtom, { mode: "promise" });
  const refresh = useAtomRefresh(accountsAtom);
  const [label, setLabel] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const add = () => {
    const parsed = handle.trim() === "" ? null : parseHandle(handle);
    if (parsed === null && handle.trim() !== "") return setError(NOT_A_HANDLE);
    return attempt(async () => {
      await create({ label: label.trim(), handle: parsed });
      setLabel("");
      setHandle("");
      refresh();
    });
  };
  return (
    <>
      <dl>
        {list.accounts.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-6 border-b border-border py-2 text-sm"
          >
            <dt className="min-w-0 truncate">
              {a.label}
              {a.handle !== null ? (
                <span className="ml-2 font-mono text-xs text-muted-foreground">@{a.handle}</span>
              ) : null}
            </dt>
            <dd className="shrink-0">
              {a.id === list.currentId ? (
                <span className="font-mono text-2xs text-muted-foreground">current</span>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void attempt(() => select(a.id).then(() => switchAccount(a.id)))}
                >
                  Switch
                </Button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex max-w-xl items-end gap-2 pt-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">New account label</span>
          <input
            className={settingsInput}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Handle</span>
          <input
            className={settingsInput}
            placeholder="optional"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
        </label>
        <Button size="sm" disabled={label.trim() === ""} onClick={() => void add()}>
          Add
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="pt-2 text-xs text-error-foreground">
          {error}
        </p>
      ) : null}
    </>
  );
}

function Accounts() {
  const accounts = useAtomValue(accountsAtom);
  return AsyncResult.match(accounts, {
    onInitial: () => null,
    onFailure: () => (
      <p className="py-2.5 text-sm text-error-foreground">Could not load accounts.</p>
    ),
    onSuccess: ({ value }) => <AccountRows list={value} />,
  });
}

export function SettingsScreen() {
  const info = useAtomValue(serverInfoAtom);
  const settings = useAtomValue(settingsAtom);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <PageBody>
        <div className="max-w-4xl">
          {AsyncResult.match(settings, {
            onInitial: () => <p className="px-6 py-5 text-sm text-muted-foreground">Loading…</p>,
            onFailure: () => (
              <p className="px-6 py-5 text-sm text-error-foreground">Could not load settings.</p>
            ),
            onSuccess: ({ value }) => <SettingsForm current={value} />,
          })}
          <SpendMeter />
          <Section title="Service">
            <dl>
              <Row label="Client">{isElectron ? "desktop" : "browser"}</Row>
              <Row label="Service">
                {AsyncResult.match(info, {
                  onInitial: () => "connecting…",
                  onFailure: () => <span className="text-error-foreground">unreachable</span>,
                  onSuccess: ({ value }) => `${value.name} ${value.version}`,
                })}
              </Row>
              <Row label="Mode">
                {AsyncResult.getOrElse(AsyncResult.map(info, modeLabel), () => "–")}
              </Row>
              <Row label="Data directory">
                {AsyncResult.getOrElse(
                  AsyncResult.map(info, (v) => v.baseDir),
                  () => "–",
                )}
              </Row>
            </dl>
          </Section>
          <Section title="Accounts">
            <Accounts />
          </Section>
          <Section title="Remote service">
            <RemoteService />
          </Section>
        </div>
      </PageBody>
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsScreen });
