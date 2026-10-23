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
import type { Reachability, ServiceMode } from "../desktopBridge";
import { isElectron } from "../env";
import {
  accountsAtom,
  createAccountAtom,
  selectAccountAtom,
  switchAccount,
} from "../state/accounts";
import { serverInfoAtom } from "../state/observations";
import { settingsAtom, spendAtom, updateSettingsAtom } from "../state/settings";

const usd = (n: number) => `$${n.toFixed(2)}`;

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-xs">{children}</dd>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint !== undefined ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-hidden placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

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
    <section className="rounded-lg border border-border bg-card px-4">
      <Field
        label="X handle"
        hint="The account treg is connected to. Scores, analytics and mentions are about this handle."
      >
        <input
          className={inputClass}
          placeholder="handle without @"
          defaultValue={current.handle ?? ""}
          onChange={(e) => {
            const value = e.target.value.trim();
            setDraft((d) => ({ ...d, handle: value === "" ? null : value }));
          }}
        />
      </Field>
      <Field
        label="treg token"
        hint={
          current.tregTokenSet
            ? "A token is stored. Paste a new one to replace it."
            : "Not set. Falls back to XTEND_TREG_TOKEN or the treg CLI login on this machine."
        }
      >
        <input
          className={inputClass}
          type="password"
          placeholder="treg token"
          value={tregToken}
          onChange={(e) => setTregToken(e.target.value)}
        />
      </Field>
      <Field
        label="Monthly budget (USD)"
        hint="Paid calls stop when this month's spend would pass it."
      >
        <input
          className={inputClass}
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
      <Field
        label="Time zone"
        hint="IANA name. Posting slots, the calendar and the best-time heatmap are all in this zone."
      >
        <input
          className={inputClass}
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
        label="Voice notes"
        hint="One paragraph on what you post about and how you sound. The assistant writes in this voice."
      >
        <textarea
          className={inputClass}
          rows={3}
          defaultValue={current.voiceNotes}
          onChange={(e) => setDraft((d) => ({ ...d, voiceNotes: e.target.value }))}
        />
      </Field>
      <Field
        label="Keywords"
        hint="Comma separated. Library, Engage and Leads search these by default."
      >
        <input
          className={inputClass}
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
      {isElectron ? (
        <label className="flex items-center justify-between gap-6 py-2.5 text-sm">
          <span className="text-muted-foreground">Post media through the x.com session</span>
          <input
            type="checkbox"
            defaultChecked={current.sessionPostingEnabled}
            onChange={(e) => setDraft((d) => ({ ...d, sessionPostingEnabled: e.target.checked }))}
          />
        </label>
      ) : null}
      <div className="flex justify-end py-3">
        <Button size="sm" disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </section>
  );
}

function SpendMeter() {
  const spend = useAtomValue(spendAtom);
  return AsyncResult.match(spend, {
    onInitial: () => null,
    onFailure: () => null,
    onSuccess: ({ value }) => (
      <section className="rounded-lg border border-border bg-card px-4">
        <dl className="divide-y divide-border">
          <Row label="This month">
            {usd(value.monthUsd)} of {usd(value.monthlyBudgetUsd)}
          </Row>
          <Row label="Today">{usd(value.todayUsd)}</Row>
          {value.byPurpose.slice(0, 8).map((p) => (
            <Row key={p.purpose} label={p.purpose}>
              {usd(p.costUsd)}
            </Row>
          ))}
        </dl>
      </section>
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
      <p className="py-2.5 text-2xs text-muted-foreground">
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
        label="Service URL"
        hint="http://<tailnet ip or host>:4820 of a service started with --host."
      >
        <input
          className={inputClass}
          placeholder="http://mac-mini:4820"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setResult(null);
          }}
        />
      </Field>
      <Field label="Service token" hint="auth-token from that machine's data directory.">
        <input
          className={inputClass}
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
      <div className="flex justify-end gap-2 py-3">
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
      <dl className="divide-y divide-border">
        {list.accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-6 py-2 text-sm">
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
      <div className="flex items-end gap-2 py-2.5">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">New account label</span>
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Handle</span>
          <input
            className={inputClass}
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-4">
        {AsyncResult.match(settings, {
          onInitial: () => <p className="text-sm text-muted-foreground">Loading…</p>,
          onFailure: () => (
            <p className="text-sm text-error-foreground">Could not load settings.</p>
          ),
          onSuccess: ({ value }) => <SettingsForm current={value} />,
        })}
        <SpendMeter />
        <section className="rounded-lg border border-border bg-card px-4">
          <dl className="divide-y divide-border">
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
        </section>
        <section className="rounded-lg border border-border bg-card px-4">
          <h2 className="pt-3 text-sm font-medium">Accounts</h2>
          <Accounts />
        </section>
        <section className="rounded-lg border border-border bg-card px-4">
          <h2 className="pt-3 text-sm font-medium">Connect to a remote service</h2>
          <RemoteService />
        </section>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: SettingsScreen });
