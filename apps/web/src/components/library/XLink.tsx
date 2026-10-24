import { useAtomSet } from "@effect/atom-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { xNavigate, xPanelOpenAtom } from "../../state/x";

/**
 * A link to an x.com page. On the desktop it loads in the X panel beside the
 * tool, so the user stays where they are; in a browser it opens a new tab.
 * A modified click keeps the browser's own behaviour.
 */
export function XLink({
  href,
  label,
  className,
  children,
}: {
  readonly href: string;
  readonly label?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const openPanel = useAtomSet(xPanelOpenAtom);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={className}
      onClick={(event) => {
        if (!isElectron || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
          return;
        event.preventDefault();
        xNavigate(href);
        openPanel(true);
      }}
    >
      {children}
    </a>
  );
}

export const profileUrl = (handle: string) => `https://x.com/${handle}`;

/**
 * A link to another screen by href, so it holds whatever that screen's search
 * params become (`/compose?tab=automatic`) without importing its route types.
 */
export function AppLink({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <a
      href={router.history.createHref(href)}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate({ href });
      }}
    >
      {children}
    </a>
  );
}
