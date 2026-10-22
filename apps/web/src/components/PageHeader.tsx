import type { ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";

/** T3 Code's workspace top bar: 52px, glass over the content, title left, actions right. */
export function PageHeader({
  title,
  detail,
  actions,
}: {
  readonly title: string;
  readonly detail?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "surface-glass sticky top-0 z-10 flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 border-b border-border px-4",
        isElectron && "drag-region",
      )}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
        {detail !== undefined ? (
          <span className="truncate text-2xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="no-drag flex items-center gap-1.5">{actions}</div>
      ) : null}
    </header>
  );
}
