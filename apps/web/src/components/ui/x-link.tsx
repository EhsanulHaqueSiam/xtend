import { useAtomSet } from "@effect/atom-react";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { xNavigate, xPanelOpenAtom } from "../../state/x";
import { Cost } from "./layout";
import { xPill, xPillSm } from "../x";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

export const profileUrl = (handle: string) => `https://x.com/${handle}`;
export const searchUrl = (query: string, mode: "top" | "latest") =>
  `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query${mode === "latest" ? "&f=live" : ""}`;

/**
 * Opens an x.com post or profile. On the desktop it loads in the X panel beside
 * the tool, so the user stays where they are; in a browser, a new tab.
 */
export function useOpenOnX() {
  const setPanel = useAtomSet(xPanelOpenAtom);
  return (url: string) => {
    if (!isElectron) return void window.open(url, "_blank", "noreferrer");
    xNavigate(url);
    setPanel(true);
  };
}

/** A link to an x.com page that opens like `useOpenOnX`. A modified click keeps the browser's own behaviour. */
export function XLink({
  href,
  label,
  className,
  children,
}: {
  readonly href: string;
  /** Names an icon-only link. */
  readonly label?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const open = useOpenOnX();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            className={className}
            onClick={(event) => {
              if (
                !isElectron ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.button !== 0
              )
                return;
              event.preventDefault();
              open(href);
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** "Open on X" as a small pill, for a detail column's action row. */
export function OpenOnX({
  href,
  label = "Open on X",
}: {
  readonly href: string;
  readonly label?: string;
}) {
  return (
    <XLink href={href} className={cn(xPill, xPillSm)}>
      {label}
      <ArrowUpRight className="size-3.5 text-muted-foreground" />
    </XLink>
  );
}

/**
 * The free twin of a paid fetch: the x.com page whose visit the session observes
 * into the same screen. Desktop only, since a browser tab observes nothing.
 */
export function FreeOnX({ href, label }: { readonly href: string; readonly label: string }) {
  if (!isElectron) return null;
  return (
    <XLink href={href} className={cn(xPill, xPillSm)}>
      {label}
      <Cost label="free" />
    </XLink>
  );
}
