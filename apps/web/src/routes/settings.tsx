import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  type AccountList,
  type ServerInfo,
  type Settings as SettingsShape,
  type SettingsUpdate,
  X_SKIN_DEFAULTS,
  X_SKIN_TOGGLES,
} from "@xtend/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { createContext, useContext, useState, type ReactNode } from "react";

import { PageHeader } from "../components/PageHeader";
import { sectionLabel, type SectionId, useSection } from "../components/shell/sections";
import { Button } from "../components/ui/button";
import { Field, inputClass } from "../components/ui/field";
import { Empty, PageBody, Section, Stat, table } from "../components/ui/layout";
import { Select } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import type { Reachability, ServiceMode } from "../desktopBridge";
import { isElectron } from "../env";
import { fmtWhen } from "../lib/time";
import { cn, NOT_A_HANDLE, parseHandle } from "../lib/utils";
import {
  accountsAtom,
  createAccountAtom,
  selectAccountAtom,
  switchAccount,
} from "../state/accounts";
import { serverInfoAtom } from "../state/observations";
import { usd as price, useQuoteLabel } from "../state/costs";
import { settingsAtom, updateSettingsAtom } from "../state/settings";
import { spendLiveAtom } from "../state/shell";
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

type Page = SectionId<"/settings">;

/** The search field's text; while non-empty every page renders and only matching rows show. */
const SearchContext = createContext("");
/** The page a row belongs to, for its crumb in search results. */
const PageContext = createContext<Page | null>(null);

/** A page's groups: only the open page renders, or all of them while searching. */
function Page({ id, children }: { readonly id: Page; readonly children: ReactNode }) {
  const open = useSection("/settings");
  const searching = useContext(SearchContext) !== "";
  if (!searching && open !== id) return null;
  return <PageContext value={id}>{children}</PageContext>;
}

/** A settings row: a Field that search can find by its label or hint, with its page as a crumb. */
function SField({
  label,
  hint,
  wide = true,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  const query = useContext(SearchContext).trim().toLowerCase();
  const page = useContext(PageContext);
  if (query !== "" && !`${label} ${hint ?? ""}`.toLowerCase().includes(query)) return null;
  return (
    <div data-row="">
      {query !== "" && page !== null ? (
        <p className="pt-3 font-mono text-2xs text-muted-foreground">
          {sectionLabel("/settings", page)}
        </p>
      ) : null}
      <Field label={label} wide={wide} {...(hint === undefined ? {} : { hint })}>
        {children}
      </Field>
    </div>
  );
}

/** The shipped values per page; a page without an entry has nothing to restore. */
const DEFAULTS: Partial<Record<Page, SettingsUpdate>> = {
  money: { monthlyBudgetUsd: 50 },
  writing: {
    assistProvider: "claude",
    assistBaseUrl: null,
    assistModel: "",
    assistBinaryPath: "",
    assistKey: null,
    voiceNotes: "",
    keywords: [],
    dailyLibraryJobs: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  x: { sessionPostingEnabled: true },
  pool: { poolSharing: true },
};

/** Restore defaults for the open page, asking first; the X page also resets Clean X. */
function RestoreDefaults({ onRestored }: { readonly onRestored: () => void }) {
  const page = useSection("/settings");
  const update = useAtomSet(updateSettingsAtom, { mode: "promise" });
  const setSkin = useAtomSet(xSkinAtom);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaults = DEFAULTS[page];
  if (defaults === undefined) return null;
  const restore = async () => {
    setError(null);
    try {
      await update(defaults);
      if (page === "x") setSkin(X_SKIN_DEFAULTS);
      setConfirm(false);
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      {error !== null ? (
        <span role="alert" className="text-xs text-error-foreground">
          {error}
        </span>
      ) : null}
      <Button
        size="sm"
        variant={confirm ? "default" : "ghost"}
        onClick={() => (confirm ? void restore() : setConfirm(true))}
        onBlur={() => setConfirm(false)}
      >
        {confirm ? "Confirm restore" : "Restore defaults"}
      </Button>
    </>
  );
}

/** "UTC+06:00" now; longOffset spells zero as a bare "GMT". */
const utcOffset = (zone: string) => {
  const name =
    new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts()
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");
};

/** Every zone Intl knows as "Dhaka (UTC+06:00)", by city so typing a city jumps to it. */
const zoneOptions = (current: string) =>
  [...new Set([current, ...Intl.supportedValuesOf("timeZone")])]
    .map((zone) => ({
      value: zone,
      label: `${zone.split("/").at(-1)?.replaceAll("_", " ") ?? zone} (${utcOffset(zone)})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

/** What answers assist, as T3 Code picks a provider: the two logins first, any other model after. */
const ASSIST_PROVIDERS = [
  {
    id: "claude",
    label: "Claude",
    hint: "The Claude login on the machine running the service, as T3 Code uses it. Free through Xtend; your plan's limits apply.",
    models: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "codex",
    label: "Codex",
    hint: "The Codex login on the machine running the service, ChatGPT or its own key. Free through Xtend; your plan's limits apply.",
    models: [],
  },
  {
    id: "endpoint",
    label: "Other model",
    hint: "Any OpenAI-compatible endpoint. The provider bills you directly; a local model costs nothing.",
    models: [],
  },
] as const;

/** Endpoints for "Other model". The model names are each provider's cheap, capable default. */
const ASSIST_PRESETS = [
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
  const refreshSpend = useAtomRefresh(spendLiveAtom);
  const [draft, setDraft] = useState<SettingsUpdate>({});
  const [tregToken, setTregToken] = useState("");
  const [assistKey, setAssistKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetInvalid, setBudgetInvalid] = useState(false);
  const dirty = Object.keys(draft).length > 0 || tregToken !== "" || assistKey !== "";
  const invalid = budgetInvalid;
  const assistBaseUrl =
    draft.assistBaseUrl === undefined ? current.assistBaseUrl : draft.assistBaseUrl;
  const assistProvider =
    ASSIST_PROVIDERS.find((p) => p.id === (draft.assistProvider ?? current.assistProvider)) ??
    ASSIST_PROVIDERS[0];

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
    // Locked while a save is out: its success clears the draft, which would drop edits made meanwhile.
    <fieldset disabled={saving} className="contents">
      <Page id="account">
        <Section title="X account">
          <SField
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
          </SField>
        </Section>
      </Page>
      <Page id="money">
        <Section title="treg and budget">
          <SField
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
          </SField>
          <SField
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
          </SField>
        </Section>
      </Page>
      <Page id="writing">
        <Section title="AI assist" description="runs on your own logins, free through Xtend">
          <SField wide label="Runs on" hint={assistProvider.hint}>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ASSIST_PROVIDERS.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  size="xs"
                  aria-label={p.label}
                  aria-pressed={assistProvider.id === p.id}
                  className="aria-pressed:border-foreground"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      assistProvider: p.id,
                      // A model name and a command belong to one provider; an endpoint starts on the local preset.
                      assistModel: p.id === "endpoint" && assistBaseUrl === null ? "llama3.1" : "",
                      assistBinaryPath: "",
                      ...(p.id === "endpoint" && assistBaseUrl === null
                        ? { assistBaseUrl: ASSIST_PRESETS[0].baseUrl }
                        : {}),
                    }))
                  }
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </SField>
          {assistProvider.id === "endpoint" ? null : (
            <SField
              wide
              label="Model"
              hint={`Empty uses the ${assistProvider.label} CLI's own default.`}
            >
              <input
                className={settingsInput}
                list={`xtend-${assistProvider.id}-models`}
                placeholder="default"
                value={draft.assistModel ?? current.assistModel}
                onChange={(e) => setDraft((d) => ({ ...d, assistModel: e.target.value.trim() }))}
              />
              <datalist id={`xtend-${assistProvider.id}-models`}>
                {assistProvider.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </SField>
          )}
          {assistProvider.id === "endpoint" ? null : (
            <SField
              wide
              label="Command"
              hint={`Empty runs ${assistProvider.id} from your shell's PATH. Set a path or a wrapper, as in T3 Code.`}
            >
              <input
                className={settingsInput}
                placeholder={assistProvider.id}
                value={draft.assistBinaryPath ?? current.assistBinaryPath}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assistBinaryPath: e.target.value.trim() }))
                }
              />
            </SField>
          )}
        </Section>
        {assistProvider.id !== "endpoint" ? null : (
          <Section title="Other model">
            <SField
              wide
              label="Preset"
              hint="Fills the endpoint and a sensible model; edit either below."
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
            </SField>
            <SField wide label="Endpoint" hint="OpenAI-compatible, ending in /v1.">
              <input
                className={settingsInput}
                value={assistBaseUrl ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, assistBaseUrl: e.target.value }))}
              />
            </SField>
            <SField
              wide
              label="Model name"
              hint="As the provider names it; for Ollama, a model you pulled."
            >
              <input
                className={settingsInput}
                value={draft.assistModel ?? current.assistModel}
                onChange={(e) => setDraft((d) => ({ ...d, assistModel: e.target.value }))}
              />
            </SField>
            <SField
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
            </SField>
          </Section>
        )}
        <Section title="Time and voice">
          <SField
            wide
            label="Time zone"
            hint="Posting slots, the calendar and the best-time heatmap are all in this zone."
          >
            <Select
              label="Time zone"
              className="font-mono text-xs"
              value={draft.timeZone ?? current.timeZone}
              onChange={(timeZone) => setDraft((d) => ({ ...d, timeZone }))}
              options={zoneOptions(current.timeZone)}
            />
          </SField>
          <SField
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
          </SField>
          <SField
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
          </SField>
          <DailyJobsField
            checked={draft.dailyLibraryJobs ?? current.dailyLibraryJobs}
            onChange={(next) => setDraft((d) => ({ ...d, dailyLibraryJobs: next }))}
          />
        </Section>
      </Page>
      <Page id="x">
        {isElectron ? (
          <Section title="Desktop">
            <SField
              wide
              label="Act through X for what I click"
              hint="On by default. Posts and replies you click go through your own X session, one at a time at a human pace, free. Off: they go through the API at the listed price. Scheduled posts and rules never use your session."
            >
              <Switch
                className="mt-1"
                label="Act through my X session for what I click"
                checked={draft.sessionPostingEnabled ?? current.sessionPostingEnabled}
                onChange={(next) => setDraft((d) => ({ ...d, sessionPostingEnabled: next }))}
              />
            </SField>
          </Section>
        ) : null}
        {isElectron ? (
          <CleanX />
        ) : (
          <Section title="Desktop">
            <p className="py-2 text-sm text-muted-foreground">
              Session posting and Clean X apply in the desktop app, where your X session lives.
            </p>
          </Section>
        )}
      </Page>
      <Page id="pool">
        <Section
          title="Pool"
          description="Trends from everyone's X. Library · Trends reads it free either way."
        >
          <SField
            wide
            label="Share what you see with the pool"
            hint="Leaves this machine: public posts with their text, author handle, name, follower count and the numbers you saw, plus a random install id. Never: ads, reposts, DMs, lists, bookmarks, your handle or which account saw what."
          >
            <Switch
              className="mt-1"
              label="Share what you see with the pool"
              checked={draft.poolSharing ?? current.poolSharing}
              onChange={(next) => setDraft((d) => ({ ...d, poolSharing: next }))}
            />
          </SField>
        </Section>
      </Page>
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
    </fieldset>
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
  return (
    <SField
      wide
      label="Daily Library jobs"
      hint={`Each morning: picks for your keywords (${searches} in searches), hook detection and three ready posts, written on your login.`}
    >
      <Switch className="mt-1" label="Daily Library jobs" checked={checked} onChange={onChange} />
    </SField>
  );
}

/** The CSS over x.com, one switch per rule set, applied at once; a desktop preference, not a service setting. */
function CleanX() {
  const skin = useAtomValue(xSkinAtom);
  const setSkin = useAtomSet(xSkinAtom);
  return (
    <Section
      title="Clean X"
      description="Hides parts of x.com inside Xtend with CSS only. X itself runs untouched."
    >
      {X_SKIN_TOGGLES.map((t) => (
        <SField key={t.id} wide label={t.label}>
          <Switch
            className="mt-1"
            label={t.label}
            checked={skin.includes(t.id)}
            onChange={(on) =>
              setSkin(
                X_SKIN_TOGGLES.map((x) => x.id).filter((id) =>
                  id === t.id ? on : skin.includes(id),
                ),
              )
            }
          />
        </SField>
      ))}
    </Section>
  );
}

const AREAS: Record<string, string> = {
  compose: "Compose",
  plan: "Plan",
  analyze: "Analyze",
  scores: "Scores",
  library: "Library",
  engage: "Engage",
  leads: "Leads",
  automate: "Automation",
};

/** "compose.postNow" reads as "Compose: post now"; a rule's own name stays as typed. */
const purposeLabel = (purpose: string) => {
  const [area = "", ...rest] = purpose.split(".");
  const name = AREAS[area];
  if (name === undefined || rest.length === 0) return name ?? purpose;
  const what =
    area === "automate"
      ? rest.join(".")
      : rest
          .join(" ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .toLowerCase();
  return `${name}: ${what}`;
};

function SpendMeter() {
  const spend = useAtomValue(spendLiveAtom);
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
          <>
            <h3 className="pt-3 pb-2 text-xs font-medium text-muted-foreground">
              This month by purpose
            </h3>
            <dl>
              {value.byPurpose.slice(0, 8).map((p) => (
                <Row key={p.purpose} label={purposeLabel(p.purpose)}>
                  {price(p.costUsd)}
                </Row>
              ))}
            </dl>
          </>
        ) : null}
        <h3 className="pt-6 pb-2 text-xs font-medium text-muted-foreground">Recent calls</h3>
        {value.recent.length === 0 ? (
          <Empty>Nothing spent yet. Every paid call lands here with what asked for it.</Empty>
        ) : (
          <table className={table.root}>
            <thead>
              <tr>
                <th className={cn(table.th, "w-40 pl-0!")}>When</th>
                <th className={table.th}>For</th>
                <th className={cn(table.th, "w-24 pr-0! text-right")}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {value.recent.map((r) => (
                <tr key={`${r.at} ${r.purpose} ${r.endpoint}`}>
                  <td
                    className={cn(
                      table.td,
                      "h-8 pl-0! font-mono text-xs whitespace-nowrap text-muted-foreground",
                    )}
                  >
                    {fmtWhen(r.at)}
                  </td>
                  <td className={cn(table.td, "h-8 max-w-0 truncate")} title={r.endpoint}>
                    {purposeLabel(r.purpose)}
                  </td>
                  <td className={cn(table.td, table.num, "h-8 pr-0!")}>{price(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
  const [checked, setChecked] = useState<{
    readonly url: string;
    readonly token: string;
    readonly result: Reachability;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const config = { url: url.trim(), token: token.trim() };
  // A check answers for the URL and token it tested; once either is edited it says nothing.
  const result =
    checked !== null && checked.url === config.url && checked.token === config.token
      ? checked.result
      : null;
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
    const tested = config;
    setChecked({ ...tested, result: await bridge.checkRemote(tested) });
    setChecking(false);
  };
  const ok = result !== null && result.health && result.auth;
  return (
    <>
      <SField
        wide
        label="Service URL"
        hint="http://<tailnet ip or host>:4820 of a service started with --host."
      >
        <input
          className={settingsInput}
          placeholder="http://mac-mini:4820"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </SField>
      <SField wide label="Service token" hint="auth-token from that machine's data directory.">
        <input
          className={settingsInput}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </SField>
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
        <Button size="sm" disabled={!ok} onClick={() => bridge.setRemote(config)}>
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
  const refreshSettings = useAtomRefresh(settingsAtom);
  const refreshSpend = useAtomRefresh(spendLiveAtom);
  const page = useSection("/settings");
  const [query, setQuery] = useState("");
  // The form's inputs are uncontrolled, so restored values show by remounting it.
  const [formKey, setFormKey] = useState(0);
  const searching = query.trim() !== "";
  return (
    <SearchContext value={query}>
      <div className="flex h-full flex-col">
        <PageHeader
          title={searching ? "Search" : sectionLabel("/settings", page)}
          actions={
            <>
              <input
                type="search"
                aria-label="Search settings"
                placeholder="Search settings"
                className={cn(settingsInput, "h-7 w-48")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching ? null : (
                <RestoreDefaults
                  onRestored={() => {
                    setFormKey((k) => k + 1);
                    refreshSettings();
                    refreshSpend();
                  }}
                />
              )}
            </>
          }
        />
        <PageBody>
          {/* While searching, a group with no matching row hides itself. */}
          <div className={cn("max-w-4xl", searching && "[&_section:not(:has([data-row]))]:hidden")}>
            {AsyncResult.match(settings, {
              onInitial: () => <p className="px-6 py-5 text-sm text-muted-foreground">Loading…</p>,
              onFailure: () => (
                <p className="px-6 py-5 text-sm text-error-foreground">Could not load settings.</p>
              ),
              onSuccess: ({ value }) => <SettingsForm key={formKey} current={value} />,
            })}
            <Page id="money">
              <SpendMeter />
            </Page>
            <Page id="service">
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
              <Section title="Remote service">
                <RemoteService />
              </Section>
            </Page>
            <Page id="account">
              <Section title="Accounts">
                <Accounts />
              </Section>
            </Page>
          </div>
        </PageBody>
      </div>
    </SearchContext>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsScreen });
