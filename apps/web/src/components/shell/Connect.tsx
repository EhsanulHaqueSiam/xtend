import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { forgetService, savedService } from "../../rpc/client";
import { connect, type Outcome } from "../../rpc/connect";
import { Button } from "../ui/button";
import { inputClass } from "../ui/field";
import { XtendMark } from "../ui/logo";

const DOCS = "https://github.com/EhsanulHaqueSiam/xtend/blob/main/docs/user/remote-service.md";

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="rounded bg-code px-1 py-px font-mono text-[11.5px] text-foreground">
    {children}
  </code>
);

const DocLink = ({
  anchor,
  children,
}: {
  readonly anchor: string;
  readonly children: ReactNode;
}) => (
  <a className="text-foreground" href={`${DOCS}#${anchor}`} target="_blank" rel="noreferrer">
    {children}
  </a>
);

/** What went wrong, in the words the field it sits under needs. */
function ProblemText({ outcome }: { readonly outcome: Extract<Outcome, { ok: false }> }) {
  const p = outcome.problem;
  switch (p.kind) {
    case "address":
      return <>Not an address. It looks like https://mini.tail1a2b3.ts.net</>;
    case "https":
      return (
        <>
          This page is https, so the browser blocks an http service. Serve it over https on that
          machine: <Code>tailscale serve --bg {p.port}</Code>, then use its ts.net address.
        </>
      );
    case "unreachable":
      return (
        <>
          No answer after 8 s. Is this device on your tailnet, and is the service running? On that
          machine: <Code>xtend service status</Code>
        </>
      );
    case "origin":
      return (
        <>
          The service answered but does not allow this page. Start it with{" "}
          <Code>--allow-origin {p.page}</Code>
        </>
      );
    case "credential":
      return <>{p.message}</>;
  }
}

/**
 * The hosted web app's first screen: no service served this page, so it asks where the user's
 * own service is and for a pairing link or token, then remembers it for this browser.
 */
export function Connect({ secure = window.location.protocol === "https:" }) {
  const [address, setAddress] = useState(() => savedService()?.url ?? "");
  const [credential, setCredential] = useState("");
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (outcome?.ok === true)
    return (
      <Screen
        title="Connected"
        lead="Remembered on this browser. Disconnect anytime from Settings, Service."
      >
        <dl className="border-t border-border text-[12.5px]">
          <Kv label="Service">
            <span className="font-mono">{new URL(outcome.origin).host}</span>
          </Kv>
          <Kv label="Status">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" /> online, {outcome.ms} ms
            </span>
          </Kv>
          <Kv label="Version">
            <span className="font-mono">{outcome.version}</span>
          </Kv>
        </dl>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => window.location.reload()}>
            Open Xtend
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              forgetService();
              setOutcome(null);
            }}
          >
            Change
          </Button>
        </div>
        <p className="pt-3 text-xs text-muted-foreground">
          No x.com panel in a browser: Home shows what your desktop saw. Every tool works.
        </p>
      </Screen>
    );

  const failed = outcome?.ok === false ? outcome : null;
  const addressError = failed?.field === "address" ? failed : null;
  const credentialError = failed?.field === "credential" ? failed : null;
  const run = async () => {
    setChecking(true);
    setOutcome(await connect({ address, credential, secure }));
    setChecking(false);
  };
  const httpAddress = addressError?.problem.kind === "https" ? addressError.problem.address : null;

  return (
    <Screen
      title="Connect your service"
      lead="This page is the app. Your data lives in the service on your own machine."
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="mb-3.5 block">
          <span className="mb-1 flex text-xs font-semibold">Service address</span>
          <input
            className={cn(
              inputClass,
              "font-mono text-[12.5px]",
              addressError !== null && "border-error",
              credentialError !== null && "border-success/50",
            )}
            aria-label="Service address"
            placeholder="https://mini.tail1a2b3.ts.net"
            autoComplete="url"
            aria-invalid={addressError !== null}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          {addressError !== null ? (
            <span role="alert" className="mt-1.5 block text-xs text-error-foreground">
              <ProblemText outcome={addressError} />
            </span>
          ) : credentialError?.version !== undefined ? (
            <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" /> Service found,{" "}
              {credentialError.version}
            </span>
          ) : null}
        </label>
        <label className="mb-3.5 block">
          <span className="mb-1 flex justify-between text-xs font-semibold">
            Pairing link or token
            <DocLink anchor="use-the-hosted-web-app">
              <span className="font-normal text-muted-foreground">Where is it?</span>
            </DocLink>
          </span>
          <input
            type="password"
            className={cn(
              inputClass,
              "font-mono text-[12.5px]",
              credentialError !== null && "border-error",
            )}
            aria-label="Pairing link or token"
            placeholder="https://…/pair#code"
            autoComplete="off"
            aria-invalid={credentialError !== null}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
          />
          {credentialError !== null ? (
            <span role="alert" className="mt-1.5 block text-xs text-error-foreground">
              <ProblemText outcome={credentialError} />
            </span>
          ) : null}
        </label>
        {checking ? (
          <div
            role="status"
            className="mb-3.5 flex items-center gap-2 border-y border-border py-2.5 text-[12.5px]"
          >
            <span className="size-1.5 rounded-full ring-[1.5px] ring-muted-foreground ring-inset" />
            Reaching the service
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">/api/health</span>
          </div>
        ) : null}
        <Button
          type="submit"
          className="self-start"
          disabled={checking || address.trim() === "" || credential.trim() === ""}
        >
          {checking
            ? "Connecting"
            : addressError?.problem.kind === "unreachable"
              ? "Try again"
              : "Connect"}
        </Button>
      </form>
      <p className="pt-3 text-xs text-muted-foreground">
        {httpAddress !== null ? (
          <>
            On the same network? Open{" "}
            <span className="font-mono text-foreground">{httpAddress}</span> directly instead.
          </>
        ) : addressError?.problem.kind === "unreachable" ? (
          <DocLink anchor="run-the-service-elsewhere">
            Reaching a service from another device
          </DocLink>
        ) : (
          <>
            No service yet?{" "}
            <DocLink anchor="run-the-service-elsewhere">Run it on a Mac mini or a server</DocLink>
          </>
        )}
      </p>
    </Screen>
  );
}

function Kv({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Screen({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col px-4 py-7 text-sm">
      <div className="flex items-center gap-2 text-[15px] font-bold">
        <XtendMark className="size-5" />
        Xtend
      </div>
      <h1 className="mt-5.5 mb-1 text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mb-4.5 text-[13px] text-secondary-label">{lead}</p>
      {children}
    </main>
  );
}
