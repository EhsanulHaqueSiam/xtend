import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { PageHeader } from "../components/PageHeader";
import { isElectron } from "../env";
import { serverInfoAtom } from "../state/observations";

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs">{children}</dd>
    </div>
  );
}

function Settings() {
  const info = useAtomValue(serverInfoAtom);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="mx-auto w-full max-w-2xl px-4 py-4">
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
            <Row label="Data directory">
              {AsyncResult.getOrElse(
                AsyncResult.map(info, (v) => v.baseDir),
                () => "–",
              )}
            </Row>
          </dl>
        </section>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings")({ component: Settings });
