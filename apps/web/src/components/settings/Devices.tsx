import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Device, Pairing } from "@xtend/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { isElectron } from "../../env";
import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import {
  pairAtom,
  removeDeviceAtom,
  settingsDeviceIdAtom,
  useDevices,
  useSettingsDevice,
} from "../../state/devices";
import { useDesktopUpdate } from "../../state/update";
import { xSkinAtom } from "../../state/x";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { Select } from "../ui/select";

const ownId = () => window.desktopBridge?.device.id;

/** "MacBook Air (this device)" for the desktop showing it, the plain name otherwise. */
export const deviceName = (device: Device) =>
  device.id === ownId() ? `${device.name} (this device)` : device.name;

/**
 * Whether per-device rows need saying whose they are: more than one desktop, or a browser,
 * which is never one itself and so always edits another's.
 */
export function useDeviceScoped() {
  const devices = useDevices();
  return devices.length > 1 || (!isElectron && devices.length > 0);
}

/** "Settings for" in the header, as T3 Code scopes settings to a machine. */
export function DevicePicker() {
  const devices = useDevices();
  const device = useSettingsDevice();
  const pick = useAtomSet(settingsDeviceIdAtom);
  if (!useDeviceScoped() || device === null) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">Settings for</span>
      <Select
        compact
        label="Settings for"
        value={device.id}
        onChange={pick}
        options={devices.map((d) => ({ value: d.id, label: deviceName(d) }))}
      />
    </span>
  );
}

/** Each desktop on this service, with a way to edit its settings and to sign it out. */
export function DevicesList() {
  const devices = useDevices();
  const pick = useAtomSet(settingsDeviceIdAtom);
  const remove = useAtomSet(removeDeviceAtom, { mode: "promise" });
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (devices.length === 0)
    return (
      <p className="py-2.5 text-sm text-muted-foreground">No desktop has used this service yet.</p>
    );
  const signOut = async (id: string) => {
    setError(null);
    try {
      await remove(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setConfirm(null);
  };
  return (
    <>
      <dl>
        {devices.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0"
          >
            <dt className="min-w-0 truncate">
              {deviceName(d)}
              <span className="ml-2 font-mono text-2xs text-muted-foreground">
                {d.paired ? "paired" : "on this service's machine"} · seen {fmtWhen(d.lastSeenAt)}
              </span>
            </dt>
            <dd className="flex shrink-0 gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  pick(d.id);
                  void navigate({ href: "/settings?tab=x" });
                }}
              >
                Settings
              </Button>
              {/* Only a paired device has a token of its own to revoke. */}
              {d.paired && d.id !== ownId() ? (
                <Button
                  size="xs"
                  variant={confirm === d.id ? "default" : "outline"}
                  onClick={() => (confirm === d.id ? void signOut(d.id) : setConfirm(d.id))}
                  onBlur={() => setConfirm(null)}
                >
                  {confirm === d.id ? "Confirm sign out" : "Sign out"}
                </Button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {error !== null ? (
        <p role="alert" className="pt-2 text-xs text-error-foreground">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** A browser joins with the base-dir token instead; it holds no preferences of its own. */
export function BrowserHint() {
  return (
    <p className="pb-2.5 text-xs text-muted-foreground">
      A browser needs no pairing: open this service's URL with{" "}
      <span className="font-mono">?token=</span> followed by the token from{" "}
      <span className="font-mono">auth-token</span> in its data directory.
    </p>
  );
}

/** A single-use link another desktop joins this service with. */
export function AddDevice() {
  const pair = useAtomSet(pairAtom, { mode: "promise" });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setError(null);
    setCopied(false);
    try {
      setPairing(await pair());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex flex-col gap-2 py-2.5">
      {pairing === null ? null : pairing.link === null ? (
        <p className="text-sm text-muted-foreground">
          This service only listens on this machine, so no other device can reach it. Start it on an
          address they can, for instance a Tailscale one:{" "}
          <span className="font-mono text-xs">xtend service install --host &lt;tailnet ip&gt;</span>
        </p>
      ) : (
        <>
          <p className="rounded-(--control-radius) border border-border px-2.5 py-1.5 font-mono text-xs break-all">
            {pairing.link}
          </p>
          <p className="text-xs text-muted-foreground">
            Single use, until {fmtWhen(pairing.expiresAt)}. On the other desktop: Settings, Service,
            Join a service.
          </p>
        </>
      )}
      {error !== null ? (
        <p role="alert" className="text-xs text-error-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {pairing?.link != null ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(pairing.link!).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void make()}>
          {pairing === null ? "Add a device" : "New link"}
        </Button>
      </div>
    </div>
  );
}

/** Desktop only: become a client of another machine's service instead of running an empty one. */
export function JoinService() {
  const bridge = window.desktopBridge;
  const cleanX = useAtomValue(xSkinAtom);
  const update = useDesktopUpdate();
  const [link, setLink] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (bridge === undefined) return null;
  const join = async () => {
    setJoining(true);
    setError(
      await bridge.joinService(link.trim(), {
        cleanX,
        updateChannel: update?.channel ?? null,
      }),
    );
    setJoining(false);
  };
  return (
    <div className="flex flex-col gap-2 py-2.5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Pairing link from the other device</span>
        <input
          className={cn(inputClass, "font-mono text-xs")}
          placeholder="http://mac-mini:4820/pair#…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Your drafts, rules and spend then come from that service. What this device's own service
        holds stays here; Use local service gets back to it.
      </p>
      {error !== null ? (
        <p role="alert" className="text-xs text-error-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {bridge.remote !== null ? (
          <Button size="sm" variant="outline" onClick={() => bridge.setRemote(null)}>
            Use local service
          </Button>
        ) : null}
        <Button size="sm" disabled={joining || link.trim() === ""} onClick={() => void join()}>
          {joining ? "Joining…" : "Join and relaunch"}
        </Button>
      </div>
    </div>
  );
}
