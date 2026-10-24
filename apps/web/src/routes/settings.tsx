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
import { cn } from "../lib/utils";
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

function SettingsForm({ current }: { readonly current: SettingsShape }) {
  const update = useAtomSet(updateSettingsAtom, { mode: "promise" });
  const refreshSettings = useAtomRefresh(settingsAtom);
  const [draft, setDraft] = useState<SettingsUpdate>({});
  const [tregToken, setTregToken] = useState("");
  const dirty = Object.keys(draft).length > 0 || tregToken !== "";

  const save = async () => {
    await update({ ...draft, ...(tregToken === "" ? {} : { tregToken }) });
    setDraft({});
    setTregToken("");
    refreshSettings();
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
          hint="Paid calls stop before this month's spend would pass it."
        >
          <input
            className={settingsInput}
            type="number"
            min={0}
            step={1}
            defaultValue={current.monthlyBudgetUsd}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value >= 0)
                setDraft((d) => ({ ...d, monthlyBudgetUsd: value }));
            }}
          />
        </Field>
        <DailyJobsField
          checked={draft.dailyLibraryJobs ?? current.dailyLibraryJobs}
          onChange={(next) => setDraft((d) => ({ ...d, dailyLibraryJobs: next }))}
        />
      </Section>
      <Section title="Time and voice">
        <Field
          wide
          label="Time zone"
          hint="IANA name. Posting slots, the calendar and the best-time heatmap are all in this zone."
        >
          <input
            className={settingsInput}
            list="xtend-zones"
            defaultValue={current.timeZone}
            onChange={(e) => {
              const value = e.target.value.trim();
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
            label="Post media through X"
            hint="Off by default. When on, posts with media go through your X session instead of the API."
          >
            <Switch
              className="mt-1"
              label="Post media through the x.com session"
              checked={draft.sessionPostingEnabled ?? current.sessionPostingEnabled}
              onChange={(next) => setDraft((d) => ({ ...d, sessionPostingEnabled: next }))}
            />
          </Field>
          <XSkinField />
        </Section>
      ) : null}
      {dirty ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-6 py-3">
          <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>
          <Button size="sm" onClick={() => void save()}>
            Save
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
        <div className="grid grid-cols-3 gap-6 pb-4">
          <Stat label="This month" value={usd(value.monthUsd)} />
          <Stat label="Today" value={usd(value.todayUsd)} />
          <Stat label="Budget" value={usd(value.monthlyBudgetUsd)} />
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
  const add = async () => {
    await create({ label: label.trim(), handle: handle.trim() === "" ? null : handle.trim() });
    setLabel("");
    setHandle("");
    refresh();
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
                  onClick={() => void select(a.id).then(() => switchAccount(a.id))}
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

function SettingsScreen() {
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
